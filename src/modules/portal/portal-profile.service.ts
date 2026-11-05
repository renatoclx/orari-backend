import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import * as bcrypt from "bcrypt";
import type { Prisma } from "../../../generated/prisma/client";
import { ContactType, PeopleType } from "../../../generated/prisma/enums";
import { detectImageExtension } from "../../common/storage/image-type";
import { LocalFileStorage } from "../../common/storage/local-file-storage.service";
import { normalizeForSearch } from "../../common/text/normalize-for-search";
import { isUniqueConstraintViolation } from "../../prisma/prisma-errors";
import { PrismaService } from "../../prisma/prisma.service";
import { PortalAuthService, type PortalAccount } from "./portal-auth.service";
import { UpdateProfileDto } from "./dto/update-profile.dto";

// Pastas das fotos: a da conta e a das pessoas (a mesma do cadastro da clínica).
const ACCOUNT_PHOTO_FOLDER = "client-accounts";
const PEOPLE_PHOTO_FOLDER = "people";

const profileSelect = {
  name: true,
  phone: true,
  email: true,
  document: true,
  birthDate: true,
  profession: true,
  photoUrl: true,
  addressCep: true,
  addressStreet: true,
  addressNumber: true,
  addressComplement: true,
  addressNeighborhood: true,
  addressCity: {
    select: { id: true, name: true, state: { select: { acronym: true } } },
  },
} satisfies Prisma.ClientAccountSelect;

type ProfileRow = Prisma.ClientAccountGetPayload<{
  select: typeof profileSelect;
}>;

/**
 * "Meus dados" do app do cliente (ver docs/business-rules.md, "Portal do
 * cliente"). A conta guarda o cadastro e, ao salvar, o copia para o cadastro
 * do cliente em cada clínica ligada à conta: nome, CPF, nascimento, profissão,
 * telefone e e-mail (o contato principal) e o endereço principal. As
 * observações da clínica nunca são tocadas.
 */
@Injectable()
export class PortalProfileService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly storage: LocalFileStorage,
    private readonly portalAuthService: PortalAuthService,
  ) {}

  async get(account: PortalAccount) {
    const row = await this.prisma.clientAccount.findUniqueOrThrow({
      where: { id: account.accountId },
      select: profileSelect,
    });
    return toView(row);
  }

  async update(account: PortalAccount, dto: UpdateProfileDto) {
    const phone = this.portalAuthService.phoneOrFail(dto.phone);
    const current = await this.prisma.clientAccount.findUniqueOrThrow({
      where: { id: account.accountId },
      select: { phone: true, passwordHash: true },
    });
    // O telefone é o login: trocá-lo pede a senha atual.
    if (phone !== current.phone) {
      if (!dto.currentPassword) {
        throw new BadRequestException(
          "Para trocar o telefone, informe a senha atual",
        );
      }
      if (!(await bcrypt.compare(dto.currentPassword, current.passwordHash))) {
        throw new BadRequestException("Senha atual incorreta");
      }
    }
    if (dto.address) {
      const city = await this.prisma.city.findUnique({
        where: { id: dto.address.cityId },
        select: { id: true },
      });
      if (!city) throw new NotFoundException("Cidade não encontrada");
    }

    const people = await this.linkedPeople(account.accountId);
    const document = dto.document ?? null;
    if (document) await this.ensureDocumentIsFree(people, document);

    const data = {
      name: dto.name,
      phone,
      email: dto.email ?? null,
      document,
      birthDate: dto.birthDate ?? null,
      profession: dto.profession ?? null,
      addressCep: dto.address?.cep ?? null,
      addressStreet: dto.address?.street ?? null,
      addressNumber: dto.address?.number ?? null,
      addressComplement: dto.address?.complement ?? null,
      addressNeighborhood: dto.address?.neighborhood ?? null,
      addressCityId: dto.address?.cityId ?? null,
    };

    try {
      await this.prisma.$transaction(async (tx) => {
        await tx.clientAccount.update({
          where: { id: account.accountId },
          data: { ...data, updatedAt: new Date() },
        });
        for (const person of people) {
          await this.copyToPerson(tx, person.id, dto, phone, document);
        }
      });
    } catch (error) {
      if (isUniqueConstraintViolation(error)) {
        throw new ConflictException("Já existe uma conta com este telefone.");
      }
      throw error;
    }
    return this.get(account);
  }

  /**
   * Troca a foto da conta e a de cada clínica (cada uma com a própria cópia:
   * se a clínica trocar a foto no painel, as outras não perdem a sua). Os
   * arquivos antigos só são apagados depois que o banco aponta para os novos.
   */
  async updatePhoto(account: PortalAccount, content: Buffer) {
    const extension = detectImageExtension(content);
    if (!extension) {
      throw new BadRequestException("A foto deve ser uma imagem JPEG ou PNG");
    }
    const [accountRow, people] = await Promise.all([
      this.prisma.clientAccount.findUniqueOrThrow({
        where: { id: account.accountId },
        select: { photoUrl: true },
      }),
      this.linkedPeople(account.accountId),
    ]);

    const accountPhoto = await this.storage.save(
      ACCOUNT_PHOTO_FOLDER,
      content,
      extension,
    );
    const copies = await Promise.all(
      people.map((person) =>
        this.storage
          .save(PEOPLE_PHOTO_FOLDER, content, extension)
          .then((photoUrl) => ({ person, photoUrl })),
      ),
    );

    await this.prisma.$transaction([
      this.prisma.clientAccount.update({
        where: { id: account.accountId },
        data: { photoUrl: accountPhoto, updatedAt: new Date() },
      }),
      ...copies.map(({ person, photoUrl }) =>
        this.prisma.people.update({
          where: { id: person.id },
          data: { photoUrl, updatedAt: new Date() },
        }),
      ),
    ]);

    await this.removeFiles([
      accountRow.photoUrl,
      ...people.map((person) => person.photoUrl),
    ]);
    return { photoUrl: accountPhoto };
  }

  /** Tira a foto da conta e a de cada clínica. */
  async removePhoto(account: PortalAccount): Promise<void> {
    const [accountRow, people] = await Promise.all([
      this.prisma.clientAccount.findUniqueOrThrow({
        where: { id: account.accountId },
        select: { photoUrl: true },
      }),
      this.linkedPeople(account.accountId),
    ]);
    await this.prisma.$transaction([
      this.prisma.clientAccount.update({
        where: { id: account.accountId },
        data: { photoUrl: null, updatedAt: new Date() },
      }),
      this.prisma.people.updateMany({
        where: { id: { in: people.map((person) => person.id) } },
        data: { photoUrl: null, updatedAt: new Date() },
      }),
    ]);
    await this.removeFiles([
      accountRow.photoUrl,
      ...people.map((person) => person.photoUrl),
    ]);
  }

  /**
   * A cidade pelo nome e pela UF (o app preenche o endereço pelo CEP, que
   * devolve os dois). Sem acentos e sem diferença de maiúsculas; não achou: 404.
   */
  async findCity(name: string, state: string) {
    const city = await this.prisma.city.findFirst({
      where: {
        normalizedName: normalizeForSearch(name),
        state: { acronym: state.toUpperCase() },
      },
      select: { id: true, name: true, state: { select: { acronym: true } } },
    });
    if (!city) throw new NotFoundException("Cidade não encontrada");
    return { id: city.id, name: city.name, state: city.state.acronym };
  }

  // Cadastros ativos da conta, um por clínica.
  private linkedPeople(accountId: string) {
    return this.prisma.people.findMany({
      where: {
        clientAccountId: accountId,
        type: PeopleType.CLIENT,
        deletedAt: null,
      },
      select: { id: true, companyId: true, photoUrl: true },
    });
  }

  /**
   * O CPF não pode estar em outro cadastro ativo de alguma das clínicas (a
   * clínica tem o CPF único). Nada é salvo; a mensagem diz qual clínica.
   */
  private async ensureDocumentIsFree(
    people: { id: string; companyId: string }[],
    document: string,
  ) {
    for (const person of people) {
      const other = await this.prisma.people.findFirst({
        where: {
          companyId: person.companyId,
          document,
          deletedAt: null,
          id: { not: person.id },
        },
        select: {
          company: { select: { fantasyName: true, corporateReason: true } },
        },
      });
      if (other) {
        const name = other.company.fantasyName ?? other.company.corporateReason;
        throw new ConflictException(
          `Este CPF já está em outro cadastro de ${name}. Fale com o estabelecimento.`,
        );
      }
    }
  }

  // Copia os dados para o cadastro numa clínica (contato e endereço principais).
  private async copyToPerson(
    tx: Prisma.TransactionClient,
    personId: string,
    dto: UpdateProfileDto,
    phone: string,
    document: string | null,
  ) {
    const now = new Date();
    await tx.people.update({
      where: { id: personId },
      data: {
        name: dto.name,
        normalizedName: normalizeForSearch(dto.name),
        document,
        birthDate: dto.birthDate ?? null,
        profession: dto.profession ?? null,
        updatedAt: now,
      },
    });

    const contact = await tx.contact.findFirst({
      where: { peopleId: personId, isPrincipal: true, deletedAt: null },
      select: { id: true },
    });
    const contactData = { phone, email: dto.email ?? null, updatedAt: now };
    if (contact) {
      await tx.contact.update({ where: { id: contact.id }, data: contactData });
    } else {
      await tx.contact.create({
        data: {
          ...contactData,
          type: ContactType.MAIN,
          isPrincipal: true,
          peopleId: personId,
        },
      });
    }

    // Sem endereço no app, o da clínica fica como está (não é apagado).
    if (!dto.address) return;
    const address = await tx.address.findFirst({
      where: { peopleId: personId, isPrincipal: true, deletedAt: null },
      select: { id: true },
    });
    const addressData = {
      cep: dto.address.cep,
      street: dto.address.street,
      number: dto.address.number,
      complement: dto.address.complement ?? null,
      neighborhood: dto.address.neighborhood ?? null,
      cityId: dto.address.cityId,
      updatedAt: now,
    };
    if (address) {
      await tx.address.update({ where: { id: address.id }, data: addressData });
    } else {
      await tx.address.create({
        data: {
          ...addressData,
          type: "MAIN",
          isPrincipal: true,
          peopleId: personId,
        },
      });
    }
  }

  private async removeFiles(paths: (string | null)[]) {
    await Promise.all(
      paths
        .filter((path) => path !== null)
        .map((path) => this.storage.remove(path)),
    );
  }
}

function toView(row: ProfileRow) {
  const { addressCity, addressCep, addressStreet, addressNumber, ...rest } =
    row;
  return {
    name: rest.name,
    phone: rest.phone,
    email: rest.email,
    document: rest.document,
    birthDate: rest.birthDate,
    profession: rest.profession,
    photoUrl: rest.photoUrl,
    address:
      addressCep && addressStreet && addressNumber && addressCity
        ? {
            cep: addressCep,
            street: addressStreet,
            number: addressNumber,
            complement: rest.addressComplement,
            neighborhood: rest.addressNeighborhood,
            city: {
              id: addressCity.id,
              name: addressCity.name,
              state: addressCity.state.acronym,
            },
          }
        : null,
  };
}
