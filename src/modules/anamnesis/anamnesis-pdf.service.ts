import { dirname, join } from "node:path";
import { Injectable } from "@nestjs/common";
// O pdfmake exporta uma instância (module.exports); só o `import =` a mantém inteira.
// eslint-disable-next-line @typescript-eslint/no-require-imports
import pdfmake = require("pdfmake");
import { Prisma } from "../../../generated/prisma/client";
import { AuditAction } from "../../../generated/prisma/enums";
import { detectImageExtension } from "../../common/storage/image-type";
import { LocalFileStorage } from "../../common/storage/local-file-storage.service";
import type { AuthenticatedUser } from "../../common/interfaces/authenticated-user.interface";
import { PrismaService } from "../../prisma/prisma.service";
import { AuditService } from "../audit/audit.service";
import { PeopleService } from "../people/people.service";
import {
  ageInYears,
  formatAddress,
  formatDocument,
  formatPhone,
} from "./anamnesis-pdf-format";
import { buildAnamnesisPdf, PdfParty } from "./anamnesis-pdf-document";
import { AnamnesisService } from "./anamnesis.service";

const AUDIT_ANAMNESIS = "ANAMNESIS";

// Só as logos gravadas pelo upload (pasta companies) são lidas para o PDF.
const LOGO_PUBLIC_PREFIX = "/uploads/companies/";
const IMAGE_MIME = { jpg: "image/jpeg", png: "image/png" } as const;

// Fonte que acompanha o pdfmake (Roboto, com acentos do português).
const FONTS_DIR = join(
  dirname(require.resolve("pdfmake/package.json")),
  "fonts",
  "Roboto",
);

// Contato e endereço principais da clínica, sem soft-deleted.
const companyArgs = {
  select: {
    corporateReason: true,
    fantasyName: true,
    document: true,
    timezone: true,
    logoUrl: true,
    contacts: {
      where: { isPrincipal: true, deletedAt: null },
      select: { phone: true, email: true },
      take: 1,
    },
    addresses: {
      where: { isPrincipal: true, deletedAt: null },
      select: {
        cep: true,
        street: true,
        number: true,
        complement: true,
        neighborhood: true,
        city: {
          select: { name: true, state: { select: { acronym: true } } },
        },
      },
      take: 1,
    },
  },
} satisfies Prisma.CompanyDefaultArgs;

type CompanyForPdf = Prisma.CompanyGetPayload<typeof companyArgs>;
type ClientForPdf = Awaited<ReturnType<PeopleService["findDetail"]>>;

/**
 * PDF da ficha de anamnese, gerado no servidor (a impressão é do frontend). Tem
 * o mesmo acesso da leitura da ficha e deixa o próprio registro de auditoria:
 * se ele falhar, o arquivo não é entregue.
 */
@Injectable()
export class AnamnesisPdfService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly anamnesisService: AnamnesisService,
    private readonly peopleService: PeopleService,
    private readonly auditService: AuditService,
    private readonly storage: LocalFileStorage,
  ) {
    pdfmake.setFonts({
      Roboto: {
        normal: join(FONTS_DIR, "Roboto-Regular.ttf"),
        bold: join(FONTS_DIR, "Roboto-Medium.ttf"),
        italics: join(FONTS_DIR, "Roboto-Italic.ttf"),
        bolditalics: join(FONTS_DIR, "Roboto-MediumItalic.ttf"),
      },
    });
    // O documento só tem texto: nada de baixar recursos nem ler arquivos além das fontes.
    pdfmake.setUrlAccessPolicy(() => false);
    pdfmake.setLocalAccessPolicy((path) => path.startsWith(FONTS_DIR));
  }

  async generate(
    id: string,
    { includeHistory }: { includeHistory: boolean },
    currentUser: AuthenticatedUser,
    ip?: string,
  ): Promise<Buffer> {
    const { companyId } = currentUser;
    // A ficha (com o controle de acesso) é montada sem auditar a leitura: o PDF
    // registra a própria ação.
    const view = await this.anamnesisService.getView(id, currentUser);

    const [company, client] = await Promise.all([
      this.prisma.company.findUniqueOrThrow({
        where: { id: companyId },
        ...companyArgs,
      }),
      // Cliente inativo também tem a ficha impressa.
      this.peopleService.findDetail(view.client.id, companyId),
    ]);

    const issuedAt = new Date();
    const definition = buildAnamnesisPdf({
      view,
      issuedAt,
      timeZone: company.timezone,
      includeHistory,
      clinic: this.clinicParty(company),
      clinicLogo: await this.logoDataUrl(company.logoUrl),
      client: this.clientParty(client, issuedAt, company.timezone),
    });
    const pdf = await pdfmake.createPdf(definition).getBuffer();

    await this.auditService.record({
      companyId,
      userId: currentUser.id,
      action: AuditAction.ANAMNESIS_PDF_GENERATED,
      entityType: AUDIT_ANAMNESIS,
      entityId: id,
      clientId: view.client.id,
      ip,
    });

    return pdf;
  }

  /**
   * Logo da clínica como data URL (PNG ou JPEG, conferidos pelo conteúdo do
   * arquivo). A logo é enfeite: qualquer problema (sem logo, URL externa, arquivo
   * ausente ou de outro formato) resulta em PDF sem ela, nunca em erro.
   */
  private async logoDataUrl(logoUrl: string | null): Promise<string | null> {
    if (!logoUrl?.startsWith(LOGO_PUBLIC_PREFIX)) {
      return null;
    }

    const content = await this.storage.read(logoUrl);
    const extension = content && detectImageExtension(content);
    if (!content || !extension) {
      return null;
    }

    return `data:${IMAGE_MIME[extension]};base64,${content.toString("base64")}`;
  }

  private clinicParty(company: CompanyForPdf): PdfParty {
    const [contact] = company.contacts;
    const [address] = company.addresses;

    return {
      name: company.fantasyName ?? company.corporateReason,
      details: [
        ["Razão social", company.corporateReason],
        ["CPF/CNPJ", formatDocument(company.document)],
        ["Telefone", contact?.phone && formatPhone(contact.phone)],
        ["E-mail", contact?.email],
        ["Endereço", address && formatAddress(address)],
      ],
    };
  }

  private clientParty(
    client: ClientForPdf,
    now: Date,
    timeZone: string,
  ): PdfParty {
    const age = ageInYears(client.birthDate, now, timeZone);

    return {
      name: client.name,
      details: [
        ["Nome", client.name],
        ["Idade", age === null ? null : `${age} anos`],
        ["CPF", client.document && formatDocument(client.document)],
        [
          "Telefone",
          client.principalContact?.phone &&
            formatPhone(client.principalContact.phone),
        ],
        [
          "Endereço",
          client.principalAddress && formatAddress(client.principalAddress),
        ],
      ],
    };
  }
}
