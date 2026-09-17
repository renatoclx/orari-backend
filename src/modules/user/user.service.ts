import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import * as bcrypt from "bcrypt";
import { Prisma, User } from "../../../generated/prisma/client";
import { UserType } from "../../../generated/prisma/enums";
import {
  isSuperAdmin,
  resolveCompanyScope,
} from "../../common/authorization/company-scope";
import { AuthenticatedUser } from "../../common/interfaces/authenticated-user.interface";
import { PaginatedResult } from "../../common/interfaces/paginated-result.interface";
import { isUniqueConstraintViolation } from "../../prisma/prisma-errors";
import { PrismaService } from "../../prisma/prisma.service";
import { CompanyService } from "../company/company.service";
import { CreateUserDto } from "./dto/create-user.dto";
import { FindUsersQueryDto } from "./dto/find-users-query.dto";
import { ResetPasswordDto } from "./dto/reset-password.dto";
import { UpdateUserDto } from "./dto/update-user.dto";

export type PublicUser = Omit<User, "password">;

const PASSWORD_SALT_ROUNDS = 10;

// O hash da senha nunca deve sair nas respostas da API (ver docs/auth.md).
const omitPassword = { password: true } as const;

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
  ) {}

  // Uso exclusivo da autenticação: é a única consulta que retorna o hash da senha.
  findByEmailWithPassword(email: string): Promise<User | null> {
    return this.prisma.user.findFirst({ where: { email, deletedAt: null } });
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
  ): Promise<PublicUser> {
    this.ensureCanAssignType(dto.type, currentUser);
    const companyId = await this.resolveTargetCompany(dto, currentUser);

    try {
      return await this.prisma.user.create({
        data: {
          name: dto.name,
          email: dto.email,
          password: await this.hashPassword(dto.password),
          type: dto.type,
          companyId,
        },
        omit: omitPassword,
      });
    } catch (error) {
      throw this.mapUniqueViolation(error);
    }
  }

  async findAll(
    { page, limit, companyId }: FindUsersQueryDto,
    currentUser: AuthenticatedUser,
  ): Promise<PaginatedResult<PublicUser>> {
    const where = this.visibleTo(currentUser, companyId);

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
  ): Promise<PublicUser> {
    const user = await this.findOne(id, currentUser);

    if (dto.type !== undefined && dto.type !== user.type) {
      // Rebaixar a própria conta poderia deixar a empresa (ou a plataforma) sem administrador.
      if (id === currentUser.id) {
        throw new ForbiddenException("Não é possível alterar o próprio tipo");
      }
      this.ensureCanAssignType(dto.type, currentUser);
    }

    try {
      return await this.prisma.user.update({
        where: { id },
        data: { ...dto, updatedAt: new Date() },
        omit: omitPassword,
      });
    } catch (error) {
      throw this.mapUniqueViolation(error);
    }
  }

  async resetPassword(
    id: string,
    dto: ResetPasswordDto,
    currentUser: AuthenticatedUser,
  ): Promise<PublicUser> {
    await this.findOne(id, currentUser);

    return this.prisma.user.update({
      where: { id },
      data: {
        password: await this.hashPassword(dto.newPassword),
        updatedAt: new Date(),
      },
      omit: omitPassword,
    });
  }

  async remove(id: string, currentUser: AuthenticatedUser): Promise<void> {
    if (id === currentUser.id) {
      throw new ForbiddenException("Não é possível excluir o próprio usuário");
    }

    await this.findOne(id, currentUser);

    const now = new Date();
    await this.prisma.user.update({
      where: { id },
      data: { deletedAt: now, updatedAt: now },
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
  ): Prisma.UserWhereInput {
    const companyId = resolveCompanyScope(currentUser, requestedCompanyId);

    if (isSuperAdmin(currentUser)) {
      return { deletedAt: null, companyId, company: { isActive: true } };
    }

    return {
      deletedAt: null,
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

  private mapUniqueViolation(error: unknown): unknown {
    return isUniqueConstraintViolation(error)
      ? new ConflictException("Já existe um usuário com este e-mail")
      : error;
  }
}
