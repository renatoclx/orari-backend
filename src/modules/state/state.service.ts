import { Injectable, NotFoundException } from "@nestjs/common";
import { State } from "../../../generated/prisma/client";
import { PaginationQueryDto } from "../../common/dto/pagination-query.dto";
import { PaginatedResult } from "../../common/interfaces/paginated-result.interface";
import { PrismaService } from "../../prisma/prisma.service";

@Injectable()
export class StateService {
  constructor(private readonly prisma: PrismaService) {}

  async findAll({
    page,
    limit,
  }: PaginationQueryDto): Promise<PaginatedResult<State>> {
    const [items, total] = await this.prisma.$transaction([
      this.prisma.state.findMany({
        orderBy: { name: "asc" },
        skip: (page - 1) * limit,
        take: limit,
      }),
      this.prisma.state.count(),
    ]);

    return { items, total, page, limit };
  }

  async findOne(id: string): Promise<State> {
    const state = await this.prisma.state.findUnique({ where: { id } });

    if (!state) {
      throw new NotFoundException("Estado não encontrado");
    }

    return state;
  }
}
