import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import { People, Prisma } from "../../../generated/prisma/client";
import { PaginatedResult } from "../../common/interfaces/paginated-result.interface";
import { isUniqueConstraintViolation } from "../../prisma/prisma-errors";
import { normalizeForSearch } from "../../common/text/normalize-for-search";
import { detectImageExtension } from "../../common/storage/image-type";
import { LocalFileStorage } from "../../common/storage/local-file-storage.service";
import { PrismaService } from "../../prisma/prisma.service";
import { CreatePeopleDto } from "./dto/create-people.dto";
import { FindPeopleQueryDto } from "./dto/find-people-query.dto";
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
  ) {}

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
  ): Promise<PaginatedResult<PeopleListItem>> {
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
  async findDetail(id: string, companyId: string): Promise<PeopleDetail> {
    const people = await this.prisma.people.findFirst({
      where: { id, companyId, deletedAt: null },
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

  private mapUniqueViolation(error: unknown): unknown {
    return isUniqueConstraintViolation(error)
      ? new ConflictException(
          "Já existe uma pessoa com este documento nesta empresa",
        )
      : error;
  }
}
