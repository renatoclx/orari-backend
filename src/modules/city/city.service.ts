import { Injectable, NotFoundException } from "@nestjs/common";
import { City, Prisma } from "../../../generated/prisma/client";
import { PaginatedResult } from "../../common/interfaces/paginated-result.interface";
import { normalizeForSearch } from "../../common/text/normalize-for-search";
import { PrismaService } from "../../prisma/prisma.service";
import { FindCitiesQueryDto } from "./dto/find-cities-query.dto";

export type PublicCity = Omit<City, "normalizedName">;

// A coluna normalizedName existe só para a busca e não faz parte das respostas.
const omitSearchColumn = { normalizedName: true } as const;

@Injectable()
export class CityService {
  constructor(private readonly prisma: PrismaService) {}

  async findAll({
    page,
    limit,
    stateId,
    name,
  }: FindCitiesQueryDto): Promise<PaginatedResult<PublicCity>> {
    // O termo é normalizado como a coluna: a busca ignora acentos e maiúsculas
    // e pode usar o índice trigram de normalizedName.
    const where: Prisma.CityWhereInput = {
      stateId,
      normalizedName: name ? { contains: normalizeForSearch(name) } : undefined,
    };

    const [items, total] = await this.prisma.$transaction([
      this.prisma.city.findMany({
        where,
        omit: omitSearchColumn,
        orderBy: { name: "asc" },
        skip: (page - 1) * limit,
        take: limit,
      }),
      this.prisma.city.count({ where }),
    ]);

    return { items, total, page, limit };
  }

  async findOne(id: string): Promise<PublicCity> {
    const city = await this.prisma.city.findUnique({
      where: { id },
      omit: omitSearchColumn,
    });

    if (!city) {
      throw new NotFoundException("Cidade não encontrada");
    }

    return city;
  }
}
