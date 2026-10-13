import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import { Contact, Prisma } from "../../../generated/prisma/client";
import {
  ownedByCompany,
  principalOfOwner,
} from "../../common/authorization/owner-scope";
import { FindOwnedQueryDto } from "../../common/dto/find-owned-query.dto";
import { OwnerDto } from "../../common/dto/owner.dto";
import { PaginatedResult } from "../../common/interfaces/paginated-result.interface";
import { isUniqueConstraintViolation } from "../../prisma/prisma-errors";
import { PrismaService } from "../../prisma/prisma.service";
import { PeopleService } from "../people/people.service";
import { CreateContactDto } from "./dto/create-contact.dto";
import { UpdateContactDto } from "./dto/update-contact.dto";

/**
 * Todas as operações recebem o companyId do usuário autenticado. Um contato é
 * visível se pertence a essa empresa ou a uma de suas pessoas (ver ownedByCompany);
 * os demais se comportam como inexistentes (404).
 */
@Injectable()
export class ContactService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly peopleService: PeopleService,
  ) {}

  async create(dto: CreateContactDto, companyId: string): Promise<Contact> {
    await this.ensureOwnerInCompany(dto, companyId);

    const create = this.prisma.contact.create({ data: dto });
    if (!dto.isPrincipal) {
      return create;
    }

    return this.withPrincipalReplaced(dto, create);
  }

  async findAll(
    { page, limit, companyId: ownerCompanyId, peopleId }: FindOwnedQueryDto,
    companyId: string,
  ): Promise<PaginatedResult<Contact>> {
    // Os filtros por dono são combinados (AND) com o escopo da empresa, então
    // filtrar por dono de outra empresa simplesmente não retorna nada.
    const where: Prisma.ContactWhereInput = {
      ...ownedByCompany(companyId),
      deletedAt: null,
      companyId: ownerCompanyId,
      peopleId,
    };

    const [items, total] = await this.prisma.$transaction([
      this.prisma.contact.findMany({
        where,
        orderBy: { createdAt: "desc" },
        skip: (page - 1) * limit,
        take: limit,
      }),
      this.prisma.contact.count({ where }),
    ]);

    return { items, total, page, limit };
  }

  async findOne(id: string, companyId: string): Promise<Contact> {
    const contact = await this.prisma.contact.findFirst({
      where: { id, deletedAt: null, ...ownedByCompany(companyId) },
    });

    if (!contact) {
      throw new NotFoundException("Contato não encontrado");
    }

    return contact;
  }

  async update(
    id: string,
    dto: UpdateContactDto,
    companyId: string,
  ): Promise<Contact> {
    const contact = await this.findOne(id, companyId);
    this.ensureKeepsPhoneOrEmail(contact, dto);

    const update = this.prisma.contact.update({
      where: { id },
      data: { ...dto, updatedAt: new Date() },
    });
    if (!dto.isPrincipal) {
      return update;
    }

    return this.withPrincipalReplaced(contact, update, id);
  }

  async remove(id: string, companyId: string): Promise<void> {
    await this.findOne(id, companyId);

    const now = new Date();
    await this.prisma.contact.update({
      where: { id },
      data: { deletedAt: now, updatedAt: now },
    });
  }

  /**
   * Cada dono tem no máximo um contato principal: o anterior é desmarcado na
   * mesma transação em que o novo é gravado. Se duas marcações concorrerem, o
   * índice único parcial recusa a segunda, que vira 409.
   */
  private async withPrincipalReplaced(
    owner: OwnerDto | Contact,
    write: Prisma.PrismaPromise<Contact>,
    exceptId?: string,
  ): Promise<Contact> {
    const now = new Date();

    try {
      const [, contact] = await this.prisma.$transaction([
        this.prisma.contact.updateMany({
          where: {
            ...principalOfOwner(owner),
            ...(exceptId && { id: { not: exceptId } }),
          },
          data: { isPrincipal: false, updatedAt: now },
        }),
        write,
      ]);
      return contact;
    } catch (error) {
      if (isUniqueConstraintViolation(error)) {
        throw new ConflictException(
          "Outro contato principal foi marcado ao mesmo tempo; tente novamente",
        );
      }
      throw error;
    }
  }

  /**
   * O PATCH aceita null para limpar um campo. O resultado final (valor enviado
   * ou, se ausente, o atual) não pode ficar sem telefone e sem e-mail. O banco
   * também garante isso via CHECK; validar aqui devolve um 400 claro em vez de
   * um erro de constraint.
   */
  private ensureKeepsPhoneOrEmail(contact: Contact, dto: UpdateContactDto) {
    const phone = dto.phone === undefined ? contact.phone : dto.phone;
    const email = dto.email === undefined ? contact.email : dto.email;

    if (!phone && !email) {
      throw new BadRequestException(
        "O contato deve manter ao menos um dos campos: phone, email",
      );
    }
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
