import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import { People, Prisma } from "../../../generated/prisma/client";
import { ContactType } from "../../../generated/prisma/enums";
import { PaginatedResult } from "../../common/interfaces/paginated-result.interface";
import { isUniqueConstraintViolation } from "../../prisma/prisma-errors";
import { normalizeForSearch } from "../../common/text/normalize-for-search";
import { detectImageExtension } from "../../common/storage/image-type";
import { LocalFileStorage } from "../../common/storage/local-file-storage.service";
import { PrismaService } from "../../prisma/prisma.service";
import { CityService } from "../city/city.service";
import { CreatePeopleDto } from "./dto/create-people.dto";
import { FindPeopleQueryDto } from "./dto/find-people-query.dto";
import { PeopleAddressDto } from "./dto/people-address.dto";
import { PeopleContactDto } from "./dto/people-contact.dto";
import { UpdatePeopleDto } from "./dto/update-people.dto";

export type PublicPeople = Omit<People, "normalizedName">;

// A coluna normalizedName existe só para a busca e não faz parte das respostas.
const omitSearchColumn = { normalizedName: true } as const;

// Pasta das fotos dentro do armazenamento de arquivos.
const PHOTO_FOLDER = "people";

// Só o contato/endereço marcado como principal acompanha a pessoa.
const principalOnly = { isPrincipal: true, deletedAt: null } as const;

const principalContactQuery = {
  where: principalOnly,
  select: { id: true, type: true, phone: true, email: true },
  take: 1,
} satisfies Prisma.People$contactsArgs;

const principalAddressQuery = {
  where: principalOnly,
  select: {
    id: true,
    type: true,
    cep: true,
    street: true,
    neighborhood: true,
    number: true,
    complement: true,
    city: {
      select: { id: true, name: true, state: { select: { acronym: true } } },
    },
  },
  take: 1,
} satisfies Prisma.People$addressesArgs;

type PrincipalContact = Prisma.ContactGetPayload<typeof principalContactQuery>;
type PrincipalAddress = Prisma.AddressGetPayload<typeof principalAddressQuery>;

export type PeopleListItem = PublicPeople & {
  principalContact: PrincipalContact | null;
};

export type PeopleDetail = PeopleListItem & {
  principalAddress: PrincipalAddress | null;
};

/**
 * Todas as operações recebem o companyId do usuário autenticado e se restringem a
 * ele: pessoas de outra empresa se comportam como inexistentes (404). A empresa
 * está sempre ativa aqui, pois o JwtStrategy recusa usuários de empresa inativa.
 */
@Injectable()
export class PeopleService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly storage: LocalFileStorage,
    private readonly cityService: CityService,
  ) {}

  /**
   * Cadastro da pessoa, com telefone principal, contatos e endereços opcionais.
   * É uma escrita aninhada do Prisma: pessoa, contatos e endereços são gravados
   * juntos ou nada é gravado. Não usa o ContactService/AddressService, que
   * dependem do PeopleService (dependência circular).
   */
  async create(dto: CreatePeopleDto, companyId: string): Promise<PublicPeople> {
    const { phone, contacts = [], addresses = [], ...person } = dto;

    this.ensureAtMostOnePrincipal(phone, contacts, addresses);
    // Antes de gravar: cidade inexistente é 404 e a pessoa não chega a ser criada.
    await this.ensureCitiesExist(addresses);

    try {
      return await this.prisma.people.create({
        data: {
          ...person,
          normalizedName: normalizeForSearch(dto.name),
          companyId,
          contacts: this.toContactsWrite(phone, contacts),
          addresses: this.toAddressesWrite(addresses),
        },
        omit: omitSearchColumn,
      });
    } catch (error) {
      throw this.mapUniqueViolation(error);
    }
  }

  async findAll(
    { page, limit, name, document, type, isActive }: FindPeopleQueryDto,
    companyId: string,
  ): Promise<PaginatedResult<PeopleListItem>> {
    // Sem filtro de status, inclui as inativas: o status é derivado do deletedAt,
    // que vai na resposta.
    const where: Prisma.PeopleWhereInput = {
      companyId,
      ...(isActive !== undefined && {
        deletedAt: isActive ? null : { not: null },
      }),
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
        include: { contacts: principalContactQuery },
        orderBy: { createdAt: "desc" },
        skip: (page - 1) * limit,
        take: limit,
      }),
      this.prisma.people.count({ where }),
    ]);

    return {
      items: items.map(({ contacts, ...people }) => ({
        ...people,
        principalContact: contacts[0] ?? null,
      })),
      total,
      page,
      limit,
    };
  }

  /**
   * Detalhe exibido na tela da pessoa, com contato e endereço principais.
   * As validações internas (ex.: agendamentos) usam o findOne, sem esses JOINs.
   */
  /**
   * Consulta (GET /people/:id): devolve também a pessoa inativa, só para
   * leitura (ex.: o histórico do cliente). Alterar, excluir e vincular continuam
   * só para ativas (findOne).
   */
  async findDetail(id: string, companyId: string): Promise<PeopleDetail> {
    const people = await this.prisma.people.findFirst({
      where: { id, companyId },
      omit: omitSearchColumn,
      include: {
        contacts: principalContactQuery,
        addresses: principalAddressQuery,
      },
    });

    if (!people) {
      throw new NotFoundException("Pessoa não encontrada");
    }

    const { contacts, addresses, ...rest } = people;
    return {
      ...rest,
      principalContact: contacts[0] ?? null,
      principalAddress: addresses[0] ?? null,
    };
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

  /**
   * Reativa uma pessoa excluída (limpa o deletedAt). O CPF dela pode ter sido
   * reaproveitado por outra pessoa ativa nesse meio tempo: nesse caso o índice
   * único do banco recusa e a resposta é 409. Os contatos e endereços voltam a
   * ser acessíveis junto com ela.
   */
  async restore(id: string, companyId: string): Promise<PublicPeople> {
    const people = await this.prisma.people.findFirst({
      where: { id, companyId },
      select: { deletedAt: true },
    });

    if (!people) {
      throw new NotFoundException("Pessoa não encontrada");
    }
    if (!people.deletedAt) {
      throw new ConflictException("A pessoa já está ativa");
    }

    try {
      return await this.prisma.people.update({
        where: { id },
        data: { deletedAt: null, updatedAt: new Date() },
        omit: omitSearchColumn,
      });
    } catch (error) {
      throw isUniqueConstraintViolation(error)
        ? new ConflictException(
            "Não é possível reativar: o CPF já está em uso por outra pessoa ativa",
          )
        : error;
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

  /**
   * Grava a foto da pessoa e substitui a anterior. O formato é conferido pelo
   * conteúdo (JPEG ou PNG); o tamanho já foi limitado no upload. O arquivo
   * antigo só é apagado depois que o banco aponta para o novo, para a pessoa
   * nunca ficar com um caminho que não existe.
   */
  async updatePhoto(
    id: string,
    content: Buffer,
    companyId: string,
  ): Promise<PublicPeople> {
    const people = await this.findOne(id, companyId);

    const extension = detectImageExtension(content);
    if (!extension) {
      throw new BadRequestException("A foto deve ser uma imagem JPEG ou PNG");
    }

    const photoUrl = await this.storage.save(PHOTO_FOLDER, content, extension);
    const updated = await this.prisma.people.update({
      where: { id },
      data: { photoUrl, updatedAt: new Date() },
      omit: omitSearchColumn,
    });

    if (people.photoUrl) {
      await this.storage.remove(people.photoUrl);
    }

    return updated;
  }

  // Remove a foto: limpa o caminho no banco e apaga o arquivo.
  async removePhoto(id: string, companyId: string): Promise<void> {
    const people = await this.findOne(id, companyId);
    if (!people.photoUrl) {
      return;
    }

    await this.prisma.people.update({
      where: { id },
      data: { photoUrl: null, updatedAt: new Date() },
    });
    await this.storage.remove(people.photoUrl);
  }

  /**
   * O principal é definido só pela flag isPrincipal, sem relação com o tipo do
   * contato. O telefone principal conta como o contato principal, então
   * nenhum item da lista pode ser principal quando ele é informado.
   */
  private ensureAtMostOnePrincipal(
    phone: string | undefined,
    contacts: PeopleContactDto[],
    addresses: PeopleAddressDto[],
  ) {
    const principalContacts = contacts.filter((contact) => contact.isPrincipal);

    if (phone && principalContacts.length > 0) {
      throw new BadRequestException(
        "O telefone informado já é o contato principal: nenhum item de contacts pode ser principal",
      );
    }
    if (principalContacts.length > 1) {
      throw new BadRequestException("Informe no máximo um contato principal");
    }
    if (addresses.filter((address) => address.isPrincipal).length > 1) {
      throw new BadRequestException("Informe no máximo um endereço principal");
    }
  }

  // Valida cada cidade distinta uma vez; o CityService responde 404 se não existir.
  private async ensureCitiesExist(addresses: PeopleAddressDto[]) {
    for (const cityId of new Set(addresses.map((address) => address.cityId))) {
      await this.cityService.findOne(cityId);
    }
  }

  /**
   * O telefone principal é criado à parte (create) e a lista de contatos em
   * lote (createMany), na mesma escrita aninhada.
   */
  private toContactsWrite(
    phone: string | undefined,
    contacts: PeopleContactDto[],
  ): Prisma.ContactCreateNestedManyWithoutPeopleInput | undefined {
    if (!phone && contacts.length === 0) {
      return undefined;
    }

    return {
      // O tipo do telefone principal é MAIN; o que o torna principal é a flag.
      ...(phone && {
        create: { type: ContactType.MAIN, phone, isPrincipal: true },
      }),
      ...(contacts.length > 0 && {
        createMany: {
          data: contacts.map(({ type, phone: number, email, isPrincipal }) => ({
            type,
            phone: number,
            email,
            isPrincipal: isPrincipal ?? false,
          })),
        },
      }),
    };
  }

  private toAddressesWrite(
    addresses: PeopleAddressDto[],
  ): Prisma.AddressCreateNestedManyWithoutPeopleInput | undefined {
    if (addresses.length === 0) {
      return undefined;
    }

    return {
      createMany: {
        data: addresses.map((address) => ({
          type: address.type,
          cep: address.cep,
          street: address.street,
          number: address.number,
          neighborhood: address.neighborhood,
          complement: address.complement,
          cityId: address.cityId,
          isPrincipal: address.isPrincipal ?? false,
        })),
      },
    };
  }

  private mapUniqueViolation(error: unknown): unknown {
    return isUniqueConstraintViolation(error)
      ? new ConflictException(
          "Já existe uma pessoa com este documento nesta empresa",
        )
      : error;
  }
}
