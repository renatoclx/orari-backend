import { Injectable, NotFoundException } from "@nestjs/common";
import { Address, Prisma } from "../../../generated/prisma/client";
import { ownedByCompany } from "../../common/authorization/owner-scope";
import { FindOwnedQueryDto } from "../../common/dto/find-owned-query.dto";
import { OwnerDto } from "../../common/dto/owner.dto";
import { PaginatedResult } from "../../common/interfaces/paginated-result.interface";
import { PrismaService } from "../../prisma/prisma.service";
import { CityService } from "../city/city.service";
import { PeopleService } from "../people/people.service";
import { CreateAddressDto } from "./dto/create-address.dto";
import { UpdateAddressDto } from "./dto/update-address.dto";

/**
 * Todas as operações recebem o companyId do usuário autenticado. Um endereço é
 * visível se pertence a essa empresa ou a uma de suas pessoas (ver ownedByCompany);
 * os demais se comportam como inexistentes (404). Cidades são globais.
 */
@Injectable()
export class AddressService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly cityService: CityService,
    private readonly peopleService: PeopleService,
  ) {}

  async create(dto: CreateAddressDto, companyId: string): Promise<Address> {
    await this.cityService.findOne(dto.cityId);
    await this.ensureOwnerInCompany(dto, companyId);

    return this.prisma.address.create({ data: dto });
  }

  async findAll(
    { page, limit, companyId: ownerCompanyId, peopleId }: FindOwnedQueryDto,
    companyId: string,
  ): Promise<PaginatedResult<Address>> {
    // Os filtros por dono são combinados (AND) com o escopo da empresa, então
    // filtrar por dono de outra empresa simplesmente não retorna nada.
    const where: Prisma.AddressWhereInput = {
      ...ownedByCompany(companyId),
      deletedAt: null,
      companyId: ownerCompanyId,
      peopleId,
    };

    const [items, total] = await this.prisma.$transaction([
      this.prisma.address.findMany({
        where,
        orderBy: { createdAt: "desc" },
        skip: (page - 1) * limit,
        take: limit,
      }),
      this.prisma.address.count({ where }),
    ]);

    return { items, total, page, limit };
  }

  async findOne(id: string, companyId: string): Promise<Address> {
    const address = await this.prisma.address.findFirst({
      where: { id, deletedAt: null, ...ownedByCompany(companyId) },
    });

    if (!address) {
      throw new NotFoundException("Endereço não encontrado");
    }

    return address;
  }

  async update(
    id: string,
    dto: UpdateAddressDto,
    companyId: string,
  ): Promise<Address> {
    await this.findOne(id, companyId);

    if (dto.cityId) {
      await this.cityService.findOne(dto.cityId);
    }

    return this.prisma.address.update({
      where: { id },
      data: { ...dto, updatedAt: new Date() },
    });
  }

  async remove(id: string, companyId: string): Promise<void> {
    await this.findOne(id, companyId);

    const now = new Date();
    await this.prisma.address.update({
      where: { id },
      data: { deletedAt: now, updatedAt: now },
    });
  }

  /**
   * O dono informado precisa pertencer à empresa do usuário: a própria empresa
   * ou uma pessoa dela. Dono de outra empresa responde 404, como se não existisse.
   */
  private async ensureOwnerInCompany(
    { companyId: ownerCompanyId, peopleId }: OwnerDto,
    companyId: string,
  ) {
    if (ownerCompanyId && ownerCompanyId !== companyId) {
      throw new NotFoundException("Empresa não encontrada");
    }

    if (peopleId) {
      await this.peopleService.findOne(peopleId, companyId);
    }
  }
}
