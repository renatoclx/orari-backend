import {
  ConflictException,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import { People, Prisma } from "../../../generated/prisma/client";
import { PaginatedResult } from "../../common/interfaces/paginated-result.interface";
import { isUniqueConstraintViolation } from "../../prisma/prisma-errors";
import { normalizeForSearch } from "../../common/text/normalize-for-search";
import { PrismaService } from "../../prisma/prisma.service";
import { CreatePeopleDto } from "./dto/create-people.dto";
import { FindPeopleQueryDto } from "./dto/find-people-query.dto";
import { UpdatePeopleDto } from "./dto/update-people.dto";

export type PublicPeople = Omit<People, "normalizedName">;

// A coluna normalizedName existe só para a busca e não faz parte das respostas.
const omitSearchColumn = { normalizedName: true } as const;

/**
 * Todas as operações recebem o companyId do usuário autenticado e se restringem a
 * ele: pessoas de outra empresa se comportam como inexistentes (404). A empresa
 * está sempre ativa aqui, pois o JwtStrategy recusa usuários de empresa inativa.
 */
@Injectable()
export class PeopleService {
  constructor(private readonly prisma: PrismaService) {}

  async create(dto: CreatePeopleDto, companyId: string): Promise<PublicPeople> {
    try {
      return await this.prisma.people.create({
        data: {
          ...dto,
          normalizedName: normalizeForSearch(dto.name),
          companyId,
        },
        omit: omitSearchColumn,
      });
    } catch (error) {
      throw this.mapUniqueViolation(error);
    }
  }

  async findAll(
    { page, limit, name, document, type }: FindPeopleQueryDto,
    companyId: string,
  ): Promise<PaginatedResult<PublicPeople>> {
    const where: Prisma.PeopleWhereInput = {
      companyId,
      deletedAt: null,
      // O termo é normalizado como a coluna: a busca ignora acentos e maiúsculas
      // e pode usar o índice trigram de normalizedName.
      normalizedName: name ? { contains: normalizeForSearch(name) } : undefined,
      document,
      type,
    };

    const [items, total] = await this.prisma.$transaction([
      this.prisma.people.findMany({
        where,
        omit: omitSearchColumn,
        orderBy: { createdAt: "desc" },
        skip: (page - 1) * limit,
        take: limit,
      }),
      this.prisma.people.count({ where }),
    ]);

    return { items, total, page, limit };
  }

  async findOne(id: string, companyId: string): Promise<PublicPeople> {
    const people = await this.prisma.people.findFirst({
      where: { id, companyId, deletedAt: null },
      omit: omitSearchColumn,
    });

    if (!people) {
      throw new NotFoundException("Pessoa não encontrada");
    }

    return people;
  }

  async update(
    id: string,
    dto: UpdatePeopleDto,
    companyId: string,
  ): Promise<PublicPeople> {
    await this.findOne(id, companyId);

    try {
      return await this.prisma.people.update({
        where: { id },
        data: {
          ...dto,
          // Mantém a coluna de busca em sincronia sempre que o nome muda.
          ...(dto.name !== undefined && {
            normalizedName: normalizeForSearch(dto.name),
          }),
          updatedAt: new Date(),
        },
        omit: omitSearchColumn,
      });
    } catch (error) {
      throw this.mapUniqueViolation(error);
    }
  }

  async remove(id: string, companyId: string): Promise<void> {
    await this.findOne(id, companyId);

    const now = new Date();
    await this.prisma.people.update({
      where: { id },
      data: { deletedAt: now, updatedAt: now },
    });
  }

  private mapUniqueViolation(error: unknown): unknown {
    return isUniqueConstraintViolation(error)
      ? new ConflictException(
          "Já existe uma pessoa com este documento nesta empresa",
        )
      : error;
  }
}
