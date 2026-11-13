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
import { normalizePortalPhone } from "../portal/portal-phone";
import { PrismaService } from "../../prisma/prisma.service";
import { AuditService } from "../audit/audit.service";
import { PlanLimitService } from "../company-access/plan-limit.service";
import { CompanyService } from "../company/company.service";
import { CreateUserDto } from "./dto/create-user.dto";
import { FindUsersQueryDto } from "./dto/find-users-query.dto";
import { ResetPasswordDto } from "./dto/reset-password.dto";
import { UpdateUserDto } from "./dto/update-user.dto";

export type PublicUser = Omit<User, "password">;

// Item da listagem: o usuário e, se houver vínculo, o tipo e o cargo da pessoa
// (a tela mostra a "Função" sem outra chamada).
export type UserListItem = PublicUser & {
  people: { type: PeopleType; profession: string | null } | null;
};

const PASSWORD_SALT_ROUNDS = 10;

// O hash da senha nunca deve sair nas respostas da API (ver docs/auth.md).
const omitPassword = { password: true } as const;

// Perfil do usuário logado: só o necessário ao front, nunca a senha.
const profileSelect = {
  id: true,
  name: true,
  email: true,
  // O telefone de login do usuário PROFESSIONAL (null nos demais).
  phone: true,
  type: true,
  // Pessoa vinculada (profissional ou funcionário); só vale enquanto ativa (o deletedAt decide no AuthService).
  people: {
    select: {
      id: true,
      name: true,
      type: true,
      profession: true,
      deletedAt: true,
    },
  },
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
 * Gerenciamento de usuários (ver docs/business-rules/empresa-e-acesso.md):
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
    private readonly planLimitService: PlanLimitService,
  ) {}

  // Uso exclusivo da autenticação: é a única consulta que retorna o hash da senha.
  findByEmailWithPassword(email: string): Promise<User | null> {
    return this.prisma.user.findFirst({ where: { email, deletedAt: null } });
  }

  // Login do usuário PROFESSIONAL no app: pelo telefone (só dígitos). Só a
  // autenticação usa; devolve o hash da senha.
  findProfessionalByPhoneWithPassword(phone: string): Promise<User | null> {
    return this.prisma.user.findFirst({
      where: { phone, type: UserType.PROFESSIONAL, deletedAt: null },
    });
  }

  // Login do usuário PROFESSIONAL no app, pelo e-mail (o mesmo do cadastro).
  findProfessionalByEmailWithPassword(email: string): Promise<User | null> {
    return this.prisma.user.findFirst({
      where: { email, type: UserType.PROFESSIONAL, deletedAt: null },
    });
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
    this.ensureCanAssignType(dto.type);
    const companyId = await this.resolveTargetCompany(dto, currentUser);
    if (dto.peopleId) {
      await this.ensureLinkablePerson(dto.peopleId, companyId);
    }
    await this.ensureProfessionalLink(dto.type, dto.peopleId, companyId);
    const phone = this.resolvePhone(dto.type, dto.phone);
    if (phone) await this.ensurePhoneFree(phone);

    try {
      // Usuário e auditoria do vínculo na mesma transação: sem rastro, sem vínculo.
      return await this.prisma.$transaction(async (tx) => {
        // Nascer ADMIN ocupa uma vaga do limite de administradores.
        if (dto.type === UserType.ADMIN) {
          await this.planLimitService.assertWithinLimit(
            "admins",
            companyId,
            tx,
          );
        }
        const created = await tx.user.create({
          data: {
            name: dto.name,
            email: dto.email,
            password: await this.hashPassword(dto.password),
            type: dto.type,
            companyId,
            peopleId: dto.peopleId,
            // Só o usuário profissional tem telefone (o login dele no app).
            ...(phone && { phone }),
          },
          omit: omitPassword,
        });

        if (dto.peopleId) {
          await this.recordUserChange(
            AuditAction.USER_LINK_CHANGED,
            created,
            currentUser,
            ip,
            tx,
          );
          await this.withoutCommissionIfAdmin(created, tx);
        }
        // Nascer ADMIN já dá acesso aos dados de saúde (anamnese).
        if (dto.type === UserType.ADMIN) {
          await this.recordUserChange(
            AuditAction.USER_TYPE_CHANGED,
            created,
            currentUser,
            ip,
            tx,
          );
        }

        return created;
      });
    } catch (error) {
      throw this.mapUniqueViolation(error, Boolean(dto.peopleId));
    }
  }

  async findAll(
    { page, limit, companyId, name }: FindUsersQueryDto,
    currentUser: AuthenticatedUser,
  ): Promise<PaginatedResult<UserListItem>> {
    // A listagem traz ativos e inativos (o status vem do deletedAt), para que
    // um usuário inativado possa ser reativado.
    const where = {
      ...this.visibleTo(currentUser, companyId, { includeDeleted: true }),
      ...(name && {
        name: { contains: name.trim(), mode: "insensitive" as const },
      }),
    };

    const [items, total] = await this.prisma.$transaction([
      this.prisma.user.findMany({
        where,
        omit: omitPassword,
        include: { people: { select: { type: true, profession: true } } },
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

    const typeChanged = dto.type !== undefined && dto.type !== user.type;
    if (dto.type !== undefined && typeChanged) {
      // Rebaixar a própria conta poderia deixar a empresa (ou a plataforma) sem administrador.
      if (id === currentUser.id) {
        throw new ForbiddenException("Não é possível alterar o próprio tipo");
      }
      this.ensureCanAssignType(dto.type);
    }

    // Enviar o mesmo vínculo que já existe não muda nada (e não gera auditoria).
    const linkChanged =
      dto.peopleId !== undefined && dto.peopleId !== user.peopleId;
    if (linkChanged && dto.peopleId) {
      await this.ensureLinkablePerson(dto.peopleId, user.companyId, id);
    }
    // O usuário só de app precisa continuar com um profissional vinculado: vale
    // o tipo e o vínculo que ficarão depois desta alteração.
    if (typeChanged || linkChanged) {
      await this.ensureProfessionalLink(
        dto.type ?? user.type,
        dto.peopleId !== undefined ? dto.peopleId : user.peopleId,
        user.companyId,
      );
    }
    // E com o telefone de login: o enviado, ou o que já tem. Sair do tipo só
    // de app apaga o telefone (os demais não têm).
    const finalType = dto.type ?? user.type;
    const phone =
      finalType === UserType.PROFESSIONAL
        ? this.resolvePhone(
            finalType,
            dto.phone !== undefined ? dto.phone : user.phone,
          )
        : this.resolvePhone(finalType, undefined);
    const phoneChanged = phone !== (user.phone ?? null);
    if (phoneChanged && phone) await this.ensurePhoneFree(phone, id);

    try {
      return await this.prisma.$transaction(async (tx) => {
        // Virar ADMIN (vindo de outro tipo) ocupa uma vaga do limite.
        if (typeChanged && dto.type === UserType.ADMIN) {
          await this.planLimitService.assertWithinLimit(
            "admins",
            user.companyId,
            tx,
          );
        }
        const updated = await tx.user.update({
          where: { id },
          data: {
            ...dto,
            ...(phoneChanged && { phone }),
            updatedAt: new Date(),
          },
          omit: omitPassword,
        });

        if (linkChanged) {
          await this.recordUserChange(
            AuditAction.USER_LINK_CHANGED,
            updated,
            currentUser,
            ip,
            tx,
          );
          await this.withoutCommissionIfAdmin(updated, tx);
        }
        // Toda mudança de tipo, inclusive a retirada do ADMIN (quem revogou também importa).
        if (typeChanged) {
          await this.recordUserChange(
            AuditAction.USER_TYPE_CHANGED,
            updated,
            currentUser,
            ip,
            tx,
          );
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

  /**
   * Troca da própria senha, depois de conferir a atual. Como na redefinição pelo
   * ADMIN, encerra as sessões abertas (os refresh tokens deixam de renovar).
   */
  async changeOwnPassword(
    userId: string,
    currentPassword: string,
    newPassword: string,
  ): Promise<void> {
    const user = await this.prisma.user.findFirst({
      where: { id: userId, deletedAt: null },
      select: { password: true },
    });
    const matches =
      user && (await bcrypt.compare(currentPassword, user.password));
    if (!user || !matches) {
      throw new BadRequestException("A senha atual está incorreta");
    }
    if (await bcrypt.compare(newPassword, user.password)) {
      throw new BadRequestException(
        "A nova senha precisa ser diferente da atual",
      );
    }

    const password = await this.hashPassword(newPassword);
    await this.prisma.$transaction([
      this.prisma.user.update({
        where: { id: userId },
        data: { password, updatedAt: new Date() },
      }),
      this.revokeSessions(userId),
    ]);
  }

  // Reativa um usuário inativado (limpa o deletedAt).
  async restore(
    id: string,
    currentUser: AuthenticatedUser,
    ip?: string,
  ): Promise<PublicUser> {
    const user = await this.prisma.user.findFirst({
      where: {
        id,
        ...this.visibleTo(currentUser, undefined, { includeDeleted: true }),
      },
      select: { deletedAt: true, type: true, peopleId: true, companyId: true },
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
      return await this.prisma.$transaction(async (tx) => {
        // Reativar um ADMIN volta a ocupar uma vaga do limite.
        if (user.type === UserType.ADMIN) {
          await this.planLimitService.assertWithinLimit(
            "admins",
            user.companyId,
            tx,
          );
        }
        const restored = await tx.user.update({
          where: { id },
          data: { deletedAt: null, updatedAt: new Date() },
          omit: omitPassword,
        });
        await this.revokeSessions(id, tx);

        // Reativar um ADMIN ou um usuário vinculado devolve o acesso à anamnese.
        if (user.type === UserType.ADMIN || user.peopleId) {
          await this.recordUserChange(
            AuditAction.USER_RESTORED,
            restored,
            currentUser,
            ip,
            tx,
          );
        }

        return restored;
      });
    } catch (error) {
      // E-mail e profissional vinculado são únicos só entre ativos: outro
      // usuário pode ter assumido um deles.
      throw isUniqueConstraintViolation(error)
        ? new ConflictException(
            "Não é possível reativar: o e-mail ou a pessoa vinculada já está em uso por outro usuário ativo",
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
   * O `client` permite participar de uma transação interativa (`tx`).
   */
  private revokeSessions(
    userId: string,
    client: Prisma.TransactionClient = this.prisma,
  ) {
    return client.refreshToken.updateMany({
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

  // Há um único SUPER_ADMIN (o admin da plataforma), criado pelo seed: a API não
  // cria nem promove ninguém a esse tipo, nem mesmo o próprio SUPER_ADMIN.
  private ensureCanAssignType(type: UserType) {
    if (type === UserType.SUPER_ADMIN) {
      throw new ForbiddenException(
        "O tipo SUPER_ADMIN não pode ser atribuído pela API",
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
  /**
   * Telefone de login do usuário só de app: obrigatório nele (10 ou 11 dígitos,
   * com DDD; máscara e +55 são aceitos) e só dele. Devolve os dígitos, ou null
   * nos demais tipos.
   */
  private resolvePhone(
    type: UserType,
    phone: string | null | undefined,
  ): string | null {
    const filled = typeof phone === "string" && phone.trim() !== "";
    if (type !== UserType.PROFESSIONAL) {
      if (filled) {
        throw new BadRequestException(
          "O telefone de acesso é só do usuário profissional",
        );
      }
      return null;
    }
    const digits = filled ? normalizePortalPhone(phone) : undefined;
    if (!digits) {
      throw new BadRequestException(
        filled
          ? "phone deve conter 10 ou 11 dígitos numéricos (DDD + número)"
          : "O usuário profissional precisa do telefone com que entra no aplicativo",
      );
    }
    return digits;
  }

  /**
   * O telefone é o login do profissional no app: dois com o mesmo o tornariam
   * ambíguo. A checagem explícita dá a mensagem certa (o índice único parcial
   * do banco não diz qual coluna falhou) e o índice cobre a corrida.
   */
  private async ensurePhoneFree(
    phone: string,
    exceptUserId?: string,
  ): Promise<void> {
    const taken = await this.prisma.user.count({
      where: {
        phone,
        deletedAt: null,
        ...(exceptUserId && { id: { not: exceptUserId } }),
      },
    });
    if (taken > 0) {
      throw new ConflictException(
        "Já existe um usuário profissional com este telefone",
      );
    }
  }

  private mapUniqueViolation(error: unknown, linkInvolved = false): unknown {
    if (!isUniqueConstraintViolation(error)) {
      return error;
    }
    return new ConflictException(
      linkInvolved
        ? "Já existe um usuário com este e-mail ou com esta pessoa vinculada"
        : "Já existe um usuário com este e-mail",
    );
  }

  /**
   * O profissional vinculado a um usuário ADMIN (o dono que atende) nasce sem
   * comissão. Vale só no momento do vínculo: depois, quem administra liga ou
   * desliga no cadastro do profissional, e mudar o tipo do usuário não mexe.
   */
  private async withoutCommissionIfAdmin(
    user: { type: UserType; peopleId: string | null },
    tx: Prisma.TransactionClient,
  ): Promise<void> {
    if (user.type !== UserType.ADMIN || !user.peopleId) return;
    await tx.people.updateMany({
      where: { id: user.peopleId, type: PeopleType.PROFESSIONAL },
      data: { receivesCommission: false, commissionSince: null },
    });
  }

  /**
   * O usuário PROFESSIONAL (só app) existe para um profissional: o vínculo é
   * obrigatório e a pessoa precisa ser um profissional ativo da empresa
   * (funcionário não vale: não tem agenda nem comissão). Outros tipos não
   * mudam.
   */
  private async ensureProfessionalLink(
    type: UserType,
    peopleId: string | null | undefined,
    companyId: string,
  ): Promise<void> {
    if (type !== UserType.PROFESSIONAL) return;
    const professional = peopleId
      ? await this.prisma.people.findFirst({
          where: {
            id: peopleId,
            companyId,
            type: PeopleType.PROFESSIONAL,
            deletedAt: null,
          },
          select: { id: true },
        })
      : null;
    if (!professional) {
      throw new BadRequestException(
        "O usuário profissional precisa estar vinculado a um profissional ativo da empresa",
      );
    }
  }

  /**
   * A pessoa do vínculo deve estar ativa, ser da empresa do usuário e do tipo
   * PROFESSIONAL ou EMPLOYEE (cliente não tem acesso), e não pode estar ligada a
   * outro usuário ativo.
   */
  private async ensureLinkablePerson(
    peopleId: string,
    companyId: string,
    userId?: string,
  ): Promise<void> {
    const person = await this.prisma.people.findFirst({
      where: {
        id: peopleId,
        companyId,
        type: { in: [PeopleType.PROFESSIONAL, PeopleType.EMPLOYEE] },
        deletedAt: null,
      },
      select: { id: true },
    });
    if (!person) {
      throw new BadRequestException(
        "peopleId deve ser um profissional ou funcionário ativo da empresa do usuário",
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
        "Esta pessoa já está vinculada a outro usuário",
      );
    }
  }

  /**
   * Auditoria das mudanças que dão ou tiram acesso aos dados de saúde (vínculo,
   * tipo e reativação): quem alterou (ator), qual usuário e quando. O registro
   * fica na empresa do usuário alterado, para o ADMIN dela enxergar, inclusive
   * as ações do SUPER_ADMIN.
   */
  private recordUserChange(
    action: AuditAction,
    target: PublicUser,
    actor: AuthenticatedUser,
    ip: string | undefined,
    tx: Prisma.TransactionClient,
  ) {
    return this.auditService.record(
      {
        companyId: target.companyId,
        userId: actor.id,
        action,
        entityType: "USER",
        entityId: target.id,
        ip,
      },
      tx,
    );
  }
}
