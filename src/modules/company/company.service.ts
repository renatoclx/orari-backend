import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import { Company, Prisma } from "../../../generated/prisma/client";
import {
  isSuperAdmin,
  resolveCompanyScope,
} from "../../common/authorization/company-scope";
import { AuthenticatedUser } from "../../common/interfaces/authenticated-user.interface";
import { detectImageExtension } from "../../common/storage/image-type";
import { LocalFileStorage } from "../../common/storage/local-file-storage.service";
import { PaginatedResult } from "../../common/interfaces/paginated-result.interface";
import { isUniqueConstraintViolation } from "../../prisma/prisma-errors";
import { PrismaService } from "../../prisma/prisma.service";
import { CreateCompanyDto } from "./dto/create-company.dto";
import { FindCompaniesQueryDto } from "./dto/find-companies-query.dto";
import { UpdateCompanyDto } from "./dto/update-company.dto";
import { UpdateOwnCompanyDto } from "./dto/update-own-company.dto";

// Pasta das logos dentro do armazenamento de arquivos (servida em /uploads/companies).
const LOGO_FOLDER = "companies";
const LOGO_PUBLIC_PREFIX = `/uploads/${LOGO_FOLDER}/`;

/**
 * Empresas não são excluídas: são inativadas (ver docs/business-rules.md).
 * Escrita é exclusiva do SUPER_ADMIN (garantido por @Roles no controller);
 * os demais tipos só enxergam a própria empresa.
 */
@Injectable()
export class CompanyService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly storage: LocalFileStorage,
  ) {}

  async create(dto: CreateCompanyDto): Promise<Company> {
    try {
      return await this.prisma.company.create({ data: dto });
    } catch (error) {
      throw this.mapUniqueViolation(error);
    }
  }

  // Busca todas as empresas e retorna a interface genérica baseada na empresa.
  async findAll(
    { page, limit, isActive }: FindCompaniesQueryDto,
    currentUser: AuthenticatedUser,
  ): Promise<PaginatedResult<Company>> {
    // O filtro por status só faz sentido para quem enxerga várias empresas.
    if (isActive !== undefined && !isSuperAdmin(currentUser)) {
      throw new ForbiddenException(
        "Apenas SUPER_ADMIN pode filtrar empresas por status",
      );
    }

    const where: Prisma.CompanyWhereInput = {
      id: resolveCompanyScope(currentUser),
      isActive,
    };

    const [items, total] = await this.prisma.$transaction([
      this.prisma.company.findMany({
        where,
        orderBy: { createdAt: "desc" },
        skip: (page - 1) * limit,
        take: limit,
      }),
      this.prisma.company.count({ where }),
    ]);

    return { items, total, page, limit };
  }

  /**
   * Busca uma empresa visível ao usuário. Para quem não é SUPER_ADMIN, outra
   * empresa responde 404 (e não 403) para não revelar que o id existe.
   */
  async findOne(id: string, currentUser: AuthenticatedUser): Promise<Company> {
    if (!isSuperAdmin(currentUser) && id !== currentUser.companyId) {
      throw new NotFoundException("Empresa não encontrada");
    }

    return this.findById(id);
  }

  /**
   * Garante que a empresa existe e está ativa. Usado quando o SUPER_ADMIN atua
   * sobre dados de outra empresa: os dados de uma empresa inativa ficam
   * inacessíveis até a reativação.
   */
  async findActive(id: string): Promise<Company> {
    const company = await this.prisma.company.findFirst({
      where: { id, isActive: true },
    });

    if (!company) {
      throw new NotFoundException("Empresa não encontrada ou inativa");
    }

    return company;
  }

  // Fuso em que os horários da empresa devem ser interpretados.
  async getTimeZone(id: string): Promise<string> {
    const company = await this.prisma.company.findUnique({
      where: { id },
      select: { timezone: true },
    });

    if (!company) {
      throw new NotFoundException("Empresa não encontrada");
    }

    return company.timezone;
  }

  // Consulta usada pela autenticação a cada requisição.
  async isActive(id: string): Promise<boolean> {
    const company = await this.prisma.company.findUnique({
      where: { id },
      select: { isActive: true },
    });

    return company?.isActive ?? false;
  }

  async update(
    id: string,
    dto: UpdateCompanyDto,
    currentUser: AuthenticatedUser,
  ): Promise<Company> {
    // Inativar a própria empresa derrubaria o acesso do próprio SUPER_ADMIN.
    if (dto.isActive === false && id === currentUser.companyId) {
      throw new ForbiddenException("Não é possível inativar a própria empresa");
    }

    await this.findById(id);

    try {
      return await this.prisma.company.update({
        where: { id },
        data: { ...dto, updatedAt: new Date() },
      });
    } catch (error) {
      throw this.mapUniqueViolation(error);
    }
  }

  /**
   * O administrador altera a própria empresa, identificada pelo token (nunca
   * pela URL): só o nome fantasia. Sem o campo, nada é alterado.
   */
  async updateOwn(
    companyId: string,
    dto: UpdateOwnCompanyDto,
  ): Promise<Company> {
    const company = await this.findById(companyId);
    if (dto.fantasyName === undefined) {
      return company;
    }

    return this.prisma.company.update({
      where: { id: companyId },
      data: { fantasyName: dto.fantasyName, updatedAt: new Date() },
    });
  }

  /**
   * Grava a logo da própria empresa e substitui a anterior. O formato é
   * conferido pelo conteúdo (JPEG ou PNG); o tamanho já foi limitado no upload.
   * O arquivo antigo só é apagado depois que o banco aponta para o novo.
   */
  async updateLogo(companyId: string, content: Buffer): Promise<Company> {
    const company = await this.findById(companyId);

    const extension = detectImageExtension(content);
    if (!extension) {
      throw new BadRequestException("A logo deve ser uma imagem JPEG ou PNG");
    }

    const logoUrl = await this.storage.save(LOGO_FOLDER, content, extension);
    const updated = await this.prisma.company.update({
      where: { id: companyId },
      data: { logoUrl, updatedAt: new Date() },
    });

    await this.removeStoredLogo(company.logoUrl);

    return updated;
  }

  // Remove a logo: limpa o caminho no banco e apaga o arquivo.
  async removeLogo(companyId: string): Promise<void> {
    const company = await this.findById(companyId);
    if (!company.logoUrl) {
      return;
    }

    await this.prisma.company.update({
      where: { id: companyId },
      data: { logoUrl: null, updatedAt: new Date() },
    });
    await this.removeStoredLogo(company.logoUrl);
  }

  /**
   * Só apaga arquivo que está na pasta das logos. O SUPER_ADMIN pode ter
   * gravado no logoUrl uma URL externa, ou até o caminho da foto de uma pessoa:
   * isso nunca deve ser apagado do disco por aqui.
   */
  private async removeStoredLogo(logoUrl: string | null): Promise<void> {
    if (logoUrl?.startsWith(LOGO_PUBLIC_PREFIX)) {
      await this.storage.remove(logoUrl);
    }
  }

  private async findById(id: string): Promise<Company> {
    const company = await this.prisma.company.findUnique({ where: { id } });

    if (!company) {
      throw new NotFoundException("Empresa não encontrada");
    }

    return company;
  }

  private mapUniqueViolation(error: unknown): unknown {
    return isUniqueConstraintViolation(error)
      ? new ConflictException(
          "Já existe uma empresa com este CNPJ ou subdomínio",
        )
      : error;
  }
}
