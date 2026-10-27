import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import * as bcrypt from "bcrypt";
import { Prisma, User } from "../../../generated/prisma/client";
import {
  AuditAction,
  PeopleType,
  UserType,
} from "../../../generated/prisma/enums";
import {
  isSuperAdmin,
  resolveCompanyScope,
} from "../../common/authorization/company-scope";
import { AuthenticatedUser } from "../../common/interfaces/authenticated-user.interface";
import { PaginatedResult } from "../../common/interfaces/paginated-result.interface";
import { isUniqueConstraintViolation } from "../../prisma/prisma-errors";
import { PrismaService } from "../../prisma/prisma.service";
import { AuditService } from "../audit/audit.service";
import { CompanyService } from "../company/company.service";
import { CreateUserDto } from "./dto/create-user.dto";
import { FindUsersQueryDto } from "./dto/find-users-query.dto";
import { ResetPasswordDto } from "./dto/reset-password.dto";
import { UpdateUserDto } from "./dto/update-user.dto";

export type PublicUser = Omit<User, "password">;

const PASSWORD_SALT_ROUNDS = 10;

// O hash da senha nunca deve sair nas respostas da API (ver docs/auth.md).
const omitPassword = { password: true } as const;

// Perfil do usuário logado: só o necessário ao front, nunca a senha.
const profileSelect = {
  id: true,
  name: true,
  email: true,
  type: true,
  // Profissional vinculado; só vale enquanto ativo (o deletedAt decide no AuthService).
  people: { select: { id: true, name: true, deletedAt: true } },
  company: {
    select: {
      id: true,
      corporateReason: true,
      fantasyName: true,
      timezone: true,
      logoUrl: true,
    },
  },
} satisfies Prisma.UserSelect;

export type UserProfile = Prisma.UserGetPayload<{
  select: typeof profileSelect;
}>;

/**
 * Gerenciamento de usuários (ver docs/business-rules.md):
 * - SUPER_ADMIN gerencia usuários de qualquer empresa ativa;
 * - ADMIN gerencia apenas usuários da própria empresa e não enxerga SUPER_ADMINs;
 * - ninguém exclui nem altera o tipo da própria conta.
 * Usuários fora do alcance de quem consulta se comportam como inexistentes (404).
 */
@Injectable()
export class UserService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly companyService: CompanyService,
    private readonly auditService: AuditService,
  ) {}

  // Uso exclusivo da autenticação: é a única consulta que retorna o hash da senha.
  findByEmailWithPassword(email: string): Promise<User | null> {
    return this.prisma.user.findFirst({ where: { email, deletedAt: null } });
  }

  // Uso do GET /auth/me: o usuário logado com os dados da empresa que o front exibe.
  findProfile(id: string): Promise<UserProfile | null> {
    return this.prisma.user.findFirst({
      where: { id, deletedAt: null },
      select: profileSelect,
    });
  }

  // Uso da autenticação: recarrega o usuário do token a cada requisição.
  findActiveById(id: string): Promise<PublicUser | null> {
    return this.prisma.user.findFirst({
      where: { id, deletedAt: null },
      omit: omitPassword,
    });
  }

  async create(
    dto: CreateUserDto,
    currentUser: AuthenticatedUser,
    ip?: string,
  ): Promise<PublicUser> {
    this.ensureCanAssignType(dto.type, currentUser);
    const companyId = await this.resolveTargetCompany(dto, currentUser);
    if (dto.peopleId) {
      await this.ensureLinkableProfessional(dto.peopleId, companyId);
    }

    try {
      // Usuário e auditoria do vínculo na mesma transação: sem rastro, sem vínculo.
      return await this.prisma.$transaction(async (tx) => {
        const created = await tx.user.create({
          data: {
            name: dto.name,
            email: dto.email,
            password: await this.hashPassword(dto.password),
            type: dto.type,
            companyId,
            peopleId: dto.peopleId,
          },
          omit: omitPassword,
        });

        if (dto.peopleId) {
          await this.recordLinkChange(created, currentUser, ip, tx);
        }

        return created;
      });
    } catch (error) {
      throw this.mapUniqueViolation(error, Boolean(dto.peopleId));
    }
  }

  async findAll(
    { page, limit, companyId }: FindUsersQueryDto,
    currentUser: AuthenticatedUser,
  ): Promise<PaginatedResult<PublicUser>> {
    // A listagem traz ativos e inativos (o status vem do deletedAt), para que
    // um usuário inativado possa ser reativado.
    const where = this.visibleTo(currentUser, companyId, {
      includeDeleted: true,
    });

    const [items, total] = await this.prisma.$transaction([
      this.prisma.user.findMany({
        where,
        omit: omitPassword,
        orderBy: { createdAt: "desc" },
        skip: (page - 1) * limit,
        take: limit,
      }),
      this.prisma.user.count({ where }),
    ]);

    return { items, total, page, limit };
  }

  async findOne(
    id: string,
    currentUser: AuthenticatedUser,
  ): Promise<PublicUser> {
    const user = await this.prisma.user.findFirst({
      where: { id, ...this.visibleTo(currentUser) },
      omit: omitPassword,
    });

    if (!user) {
      throw new NotFoundException("Usuário não encontrado");
    }

    return user;
  }

  async update(
    id: string,
    dto: UpdateUserDto,
    currentUser: AuthenticatedUser,
    ip?: string,
  ): Promise<PublicUser> {
    const user = await this.findOne(id, currentUser);

    if (dto.type !== undefined && dto.type !== user.type) {
      // Rebaixar a própria conta poderia deixar a empresa (ou a plataforma) sem administrador.
      if (id === currentUser.id) {
        throw new ForbiddenException("Não é possível alterar o próprio tipo");
      }
      this.ensureCanAssignType(dto.type, currentUser);
    }

    // Enviar o mesmo vínculo que já existe não muda nada (e não gera auditoria).
    const linkChanged =
      dto.peopleId !== undefined && dto.peopleId !== user.peopleId;
    if (linkChanged && dto.peopleId) {
      await this.ensureLinkableProfessional(dto.peopleId, user.companyId, id);
    }

    try {
      return await this.prisma.$transaction(async (tx) => {
        const updated = await tx.user.update({
          where: { id },
          data: { ...dto, updatedAt: new Date() },
          omit: omitPassword,
        });

        if (linkChanged) {
          await this.recordLinkChange(updated, currentUser, ip, tx);
        }

        return updated;
      });
    } catch (error) {
      throw this.mapUniqueViolation(error, linkChanged);
    }
  }

  async resetPassword(
    id: string,
    dto: ResetPasswordDto,
    currentUser: AuthenticatedUser,
  ): Promise<PublicUser> {
    await this.findOne(id, currentUser);
    const password = await this.hashPassword(dto.newPassword);

    // Trocar a senha encerra as sessões abertas: se a conta foi invadida, quem
    // tem um refresh token antigo não consegue mais renová-lo.
    const [updated] = await this.prisma.$transaction([
      this.prisma.user.update({
        where: { id },
        data: { password, updatedAt: new Date() },
        omit: omitPassword,
      }),
      this.revokeSessions(id),
    ]);

    return updated;
  }

  // Reativa um usuário inativado (limpa o deletedAt).
  async restore(
    id: string,
    currentUser: AuthenticatedUser,
  ): Promise<PublicUser> {
    const user = await this.prisma.user.findFirst({
      where: {
        id,
        ...this.visibleTo(currentUser, undefined, { includeDeleted: true }),
      },
      select: { deletedAt: true },
    });

    if (!user) {
      throw new NotFoundException("Usuário não encontrado");
    }
    if (!user.deletedAt) {
      throw new ConflictException("O usuário já está ativo");
    }

    try {
      // A reativação começa sem sessões: um refresh token emitido antes da
      // inativação não volta a valer (a inativação já os revoga; isto cobre os
      // usuários inativados antes dessa regra).
      const [restored] = await this.prisma.$transaction([
        this.prisma.user.update({
          where: { id },
          data: { deletedAt: null, updatedAt: new Date() },
          omit: omitPassword,
        }),
        this.revokeSessions(id),
      ]);

      return restored;
    } catch (error) {
      // E-mail e profissional vinculado são únicos só entre ativos: outro
      // usuário pode ter assumido um deles.
      throw isUniqueConstraintViolation(error)
        ? new ConflictException(
            "Não é possível reativar: o e-mail ou o profissional vinculado já está em uso por outro usuário ativo",
          )
        : error;
    }
  }

  async remove(id: string, currentUser: AuthenticatedUser): Promise<void> {
    if (id === currentUser.id) {
      throw new ForbiddenException("Não é possível excluir o próprio usuário");
    }

    await this.findOne(id, currentUser);

    const now = new Date();
    await this.prisma.$transaction([
      this.prisma.user.update({
        where: { id },
        data: { deletedAt: now, updatedAt: now },
      }),
      this.revokeSessions(id),
    ]);
  }

  /**
   * Encerra as sessões do usuário revogando os refresh tokens ainda válidos. O
   * access token em uso continua valendo até expirar, exceto para usuário
   * inativado, que o JwtStrategy já recusa na hora.
   *
   * Grava a tabela de tokens direto pelo Prisma: o AuthModule depende do
   * UserModule, e usar o AuthService aqui criaria dependência circular.
   */
  private revokeSessions(userId: string) {
    return this.prisma.refreshToken.updateMany({
      where: { userId, revokedAt: null },
      data: { revokedAt: new Date() },
    });
  }

  /**
   * Monta o filtro dos usuários que `currentUser` pode enxergar.
   *
   * - SUPER_ADMIN: qualquer empresa (ou a pedida), mas só empresas ativas — os
   *   dados de uma empresa inativa ficam inacessíveis até a reativação. O filtro
   *   pela relação `company` é apenas um JOIN de leitura do status.
   * - ADMIN: apenas a própria empresa (sempre ativa, pois o JwtStrategy recusa
   *   usuários de empresa inativa) e nunca contas SUPER_ADMIN.
   */
  private visibleTo(
    currentUser: AuthenticatedUser,
    requestedCompanyId?: string,
    // A listagem e a reativação também enxergam os inativos; as demais
    // operações (consultar, alterar, trocar senha, excluir) só os ativos.
    { includeDeleted = false }: { includeDeleted?: boolean } = {},
  ): Prisma.UserWhereInput {
    const companyId = resolveCompanyScope(currentUser, requestedCompanyId);
    const active = includeDeleted ? {} : { deletedAt: null };

    if (isSuperAdmin(currentUser)) {
      return { ...active, companyId, company: { isActive: true } };
    }

    return {
      ...active,
      companyId,
      type: { not: UserType.SUPER_ADMIN },
    };
  }

  /**
   * Empresa em que o novo usuário será criado. O SUPER_ADMIN precisa informá-la
   * (e ela deve estar ativa); o ADMIN sempre cria na própria empresa.
   */
  private async resolveTargetCompany(
    dto: CreateUserDto,
    currentUser: AuthenticatedUser,
  ): Promise<string> {
    const companyId = resolveCompanyScope(currentUser, dto.companyId);

    if (!companyId) {
      throw new BadRequestException("companyId é obrigatório para SUPER_ADMIN");
    }

    if (isSuperAdmin(currentUser)) {
      await this.companyService.findActive(companyId);
    }

    return companyId;
  }

  // Apenas SUPER_ADMIN pode criar ou promover contas SUPER_ADMIN.
  private ensureCanAssignType(type: UserType, currentUser: AuthenticatedUser) {
    if (type === UserType.SUPER_ADMIN && !isSuperAdmin(currentUser)) {
      throw new ForbiddenException(
        "Apenas SUPER_ADMIN pode atribuir o tipo SUPER_ADMIN",
      );
    }
  }

  private hashPassword(password: string): Promise<string> {
    return bcrypt.hash(password, PASSWORD_SALT_ROUNDS);
  }

  /**
   * O vínculo é conferido antes de gravar; se ainda assim o banco recusar (duas
   * requisições ao mesmo tempo), a violação pode ser do e-mail ou do vínculo, e
   * a mensagem cobre os dois quando o vínculo estava em jogo.
   */
  private mapUniqueViolation(error: unknown, linkInvolved = false): unknown {
    if (!isUniqueConstraintViolation(error)) {
      return error;
    }
    return new ConflictException(
      linkInvolved
        ? "Já existe um usuário com este e-mail ou com este profissional vinculado"
        : "Já existe um usuário com este e-mail",
    );
  }

  /**
   * O profissional do vínculo deve ser uma pessoa ativa do tipo PROFESSIONAL da
   * empresa do usuário e não pode estar ligado a outro usuário ativo.
   */
  private async ensureLinkableProfessional(
    peopleId: string,
    companyId: string,
    userId?: string,
  ): Promise<void> {
    const professional = await this.prisma.people.findFirst({
      where: {
        id: peopleId,
        companyId,
        type: PeopleType.PROFESSIONAL,
        deletedAt: null,
      },
      select: { id: true },
    });
    if (!professional) {
      throw new BadRequestException(
        "peopleId deve ser um profissional ativo da empresa do usuário",
      );
    }

    const linkedUser = await this.prisma.user.findFirst({
      where: {
        peopleId,
        deletedAt: null,
        ...(userId && { id: { not: userId } }),
      },
      select: { id: true },
    });
    if (linkedUser) {
      throw new ConflictException(
        "O profissional já está vinculado a outro usuário",
      );
    }
  }

  // Auditoria do vínculo: quem alterou (ator), qual usuário e quando; o alvo é o usuário.
  private recordLinkChange(
    target: PublicUser,
    actor: AuthenticatedUser,
    ip: string | undefined,
    tx: Prisma.TransactionClient,
  ) {
    return this.auditService.record(
      {
        companyId: target.companyId,
        userId: actor.id,
        action: AuditAction.USER_LINK_CHANGED,
        entityType: "USER",
        entityId: target.id,
        ip,
      },
      tx,
    );
  }
}
