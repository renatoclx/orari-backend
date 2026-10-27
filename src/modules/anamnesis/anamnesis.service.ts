import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import { Prisma } from "../../../generated/prisma/client";
import {
  AnamnesisEntryKind,
  AuditAction,
  PeopleType,
} from "../../../generated/prisma/enums";
import type { AuthenticatedUser } from "../../common/interfaces/authenticated-user.interface";
import { PaginatedResult } from "../../common/interfaces/paginated-result.interface";
import { toZonedParts } from "../../common/time/time-zone";
import { isUniqueConstraintViolation } from "../../prisma/prisma-errors";
import { PrismaService } from "../../prisma/prisma.service";
import { AuditService } from "../audit/audit.service";
import { AppointmentService } from "../appointment/appointment.service";
import { CompanyService } from "../company/company.service";
import { PeopleService } from "../people/people.service";
import {
  AnswerValue,
  parseIsoDate,
  resolveAnswers,
} from "./anamnesis-answer-rules";
import { AnamnesisAccessService } from "./anamnesis-access.service";
import { AnamnesisCryptoService } from "./anamnesis-crypto.service";
import { CreateAnamnesisEntryDto } from "./dto/create-anamnesis-entry.dto";
import { CreateAnamnesisDto } from "./dto/create-anamnesis.dto";
import { FindAnamnesesQueryDto } from "./dto/find-anamneses-query.dto";

const AUDIT_ANAMNESIS = "ANAMNESIS";
const AUDIT_ENTRY = "ANAMNESIS_ENTRY";
const AUDIT_CLIENT = "CLIENT";

// Perguntas como o front as recebe (as mesmas do modelo, na versão da ficha).
const questionSelect = {
  id: true,
  position: true,
  label: true,
  helpText: true,
  type: true,
  isRequired: true,
  options: true,
  detailLabel: true,
} satisfies Prisma.AnamnesisQuestionSelect;

// Tudo o que a ficha completa precisa; as respostas e a evolução chegam cifradas.
const viewArgs = {
  include: {
    client: { select: { id: true, name: true } },
    template: { select: { id: true, name: true } },
    version: {
      select: {
        id: true,
        version: true,
        questions: { orderBy: { position: "asc" }, select: questionSelect },
      },
    },
    entries: {
      // Ordem do histórico: data da consulta e, no mesmo dia, a de gravação.
      orderBy: [{ consultationDate: "asc" }, { createdAt: "asc" }],
      include: {
        authorUser: { select: { id: true, name: true } },
        authorProfessional: { select: { id: true, name: true } },
        answers: { select: { questionId: true, value: true } },
      },
    },
  },
} satisfies Prisma.AnamnesisDefaultArgs;

type StoredAnamnesis = Prisma.AnamnesisGetPayload<typeof viewArgs>;

export interface AnamnesisAnswerView {
  questionId: string;
  value: AnswerValue;
}

export interface AnamnesisEntryView {
  id: string;
  kind: AnamnesisEntryKind;
  consultationDate: Date;
  appointmentId: string | null;
  evolution: string | null;
  authorUser: { id: string; name: string };
  authorProfessional: { id: string; name: string } | null;
  createdAt: Date;
  answers: AnamnesisAnswerView[];
}

export interface AnamnesisView {
  id: string;
  createdAt: Date;
  client: { id: string; name: string };
  template: { id: string; name: string };
  version: StoredAnamnesis["version"];
  /** Situação atual: a resposta mais recente de cada pergunta. */
  current: (AnamnesisAnswerView & {
    entryId: string;
    consultationDate: Date;
  })[];
  /** Histórico em ordem de data, do registro inicial ao último acompanhamento. */
  entries: AnamnesisEntryView[];
}

export interface AnamnesisSummary {
  id: string;
  createdAt: Date;
  template: { id: string; name: string };
  templateVersion: number;
  entriesCount: number;
  lastConsultationDate: Date | null;
}

/**
 * Fichas de anamnese (ver docs/business-rules.md, "Anamnese"). Pertencem à
 * empresa do usuário; as de outras empresas se comportam como inexistentes (404).
 * Todo acesso exige a permissão da anamnese e deixa registro de auditoria. As
 * respostas e a evolução são guardadas criptografadas e decifradas só aqui, ao
 * montar a resposta. Os registros são imutáveis: não há edição nem exclusão.
 */
@Injectable()
export class AnamnesisService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly accessService: AnamnesisAccessService,
    private readonly cryptoService: AnamnesisCryptoService,
    private readonly auditService: AuditService,
    private readonly peopleService: PeopleService,
    private readonly companyService: CompanyService,
    private readonly appointmentService: AppointmentService,
  ) {}

  /** Abre a ficha do cliente no modelo, gravando o registro inicial. */
  async create(
    dto: CreateAnamnesisDto,
    currentUser: AuthenticatedUser,
    ip?: string,
  ): Promise<AnamnesisView> {
    await this.accessService.ensureAccess(currentUser);
    const { companyId } = currentUser;

    const client = await this.peopleService.findOne(dto.clientId, companyId);
    if (client.type !== PeopleType.CLIENT) {
      throw new BadRequestException(
        "clientId deve ser uma pessoa do tipo CLIENT",
      );
    }

    // A ficha nasce presa à versão vigente do modelo (a de maior número).
    const template = await this.prisma.anamnesisTemplate.findFirst({
      where: { id: dto.templateId, companyId },
      include: {
        versions: {
          orderBy: { version: "desc" },
          take: 1,
          select: { id: true, questions: { select: questionSelect } },
        },
      },
    });
    if (!template) {
      throw new NotFoundException("Modelo de anamnese não encontrado");
    }
    if (!template.isActive) {
      throw new ConflictException("O modelo de anamnese está inativo");
    }
    const version = template.versions[0];

    const consultationDate = await this.resolveConsultationDate(
      dto.consultationDate,
      companyId,
    );
    const answers = resolveAnswers(version.questions, dto.answers, {
      requireAll: true,
    });
    const professionalId =
      await this.accessService.findProfessionalId(currentUser);

    try {
      // Ficha, registro inicial e auditoria na mesma transação.
      const anamnesisId = await this.prisma.$transaction(async (tx) => {
        const created = await tx.anamnesis.create({
          data: {
            companyId,
            clientId: client.id,
            templateId: template.id,
            versionId: version.id,
            entries: {
              create: {
                kind: AnamnesisEntryKind.INITIAL,
                consultationDate,
                authorUserId: currentUser.id,
                authorProfessionalId: professionalId,
                answers: { create: this.encryptAnswers(answers) },
              },
            },
          },
          select: { id: true, entries: { select: { id: true } } },
        });

        await this.auditService.record(
          {
            companyId,
            userId: currentUser.id,
            action: AuditAction.ANAMNESIS_ENTRY_CREATED,
            entityType: AUDIT_ENTRY,
            entityId: created.entries[0].id,
            clientId: client.id,
            ip,
          },
          tx,
        );

        return created.id;
      });

      return await this.buildView(anamnesisId, companyId);
    } catch (error) {
      throw isUniqueConstraintViolation(error)
        ? new ConflictException("O cliente já tem uma ficha deste modelo")
        : error;
    }
  }

  /** Fichas de um cliente (resumo, sem respostas). */
  async findByClient(
    { page, limit, clientId }: FindAnamnesesQueryDto,
    currentUser: AuthenticatedUser,
    ip?: string,
  ): Promise<PaginatedResult<AnamnesisSummary>> {
    await this.accessService.ensureAccess(currentUser);
    const { companyId } = currentUser;

    // Cliente inativo também pode ter as fichas consultadas.
    const client = await this.prisma.people.findFirst({
      where: { id: clientId, companyId, type: PeopleType.CLIENT },
      select: { id: true },
    });
    if (!client) {
      throw new NotFoundException("Cliente não encontrado");
    }

    const where: Prisma.AnamnesisWhereInput = { companyId, clientId };
    const [items, total] = await this.prisma.$transaction([
      this.prisma.anamnesis.findMany({
        where,
        select: {
          id: true,
          createdAt: true,
          template: { select: { id: true, name: true } },
          version: { select: { version: true } },
          _count: { select: { entries: true } },
          entries: {
            orderBy: { consultationDate: "desc" },
            take: 1,
            select: { consultationDate: true },
          },
        },
        orderBy: { createdAt: "asc" },
        skip: (page - 1) * limit,
        take: limit,
      }),
      this.prisma.anamnesis.count({ where }),
    ]);

    // O registro de auditoria vem antes da resposta: se falhar, nada é entregue.
    await this.auditService.record({
      companyId,
      userId: currentUser.id,
      action: AuditAction.ANAMNESIS_LISTED,
      entityType: AUDIT_CLIENT,
      entityId: clientId,
      clientId,
      ip,
    });

    return {
      items: items.map((item) => ({
        id: item.id,
        createdAt: item.createdAt,
        template: item.template,
        templateVersion: item.version.version,
        entriesCount: item._count.entries,
        lastConsultationDate: item.entries[0]?.consultationDate ?? null,
      })),
      total,
      page,
      limit,
    };
  }

  /**
   * Ficha completa decifrada, com o controle de acesso mas **sem auditar**: quem
   * a entrega (a leitura ou o PDF) registra a própria ação.
   */
  async getView(
    id: string,
    currentUser: AuthenticatedUser,
  ): Promise<AnamnesisView> {
    await this.accessService.ensureAccess(currentUser);

    return this.buildView(id, currentUser.companyId);
  }

  /** Ficha completa: perguntas, situação atual e histórico. */
  async findOne(
    id: string,
    currentUser: AuthenticatedUser,
    ip?: string,
  ): Promise<AnamnesisView> {
    const view = await this.getView(id, currentUser);

    await this.auditService.record({
      companyId: currentUser.companyId,
      userId: currentUser.id,
      action: AuditAction.ANAMNESIS_VIEWED,
      entityType: AUDIT_ANAMNESIS,
      entityId: id,
      clientId: view.client.id,
      ip,
    });

    return view;
  }

  /**
   * Acompanhamento de uma consulta: a evolução e, se algo mudou, as respostas
   * atualizadas (só das perguntas alteradas). Cliente inativo não recebe novos
   * registros, mas as fichas continuam legíveis.
   */
  async addEntry(
    id: string,
    dto: CreateAnamnesisEntryDto,
    currentUser: AuthenticatedUser,
    ip?: string,
  ): Promise<AnamnesisView> {
    await this.accessService.ensureAccess(currentUser);
    const { companyId } = currentUser;

    const anamnesis = await this.prisma.anamnesis.findFirst({
      where: { id, companyId },
      select: {
        clientId: true,
        client: { select: { deletedAt: true } },
        version: { select: { questions: { select: questionSelect } } },
        // A data do registro inicial é o piso das datas de consulta.
        entries: {
          where: { kind: AnamnesisEntryKind.INITIAL },
          select: { consultationDate: true },
        },
      },
    });
    if (!anamnesis) {
      throw new NotFoundException("Ficha de anamnese não encontrada");
    }
    if (anamnesis.client.deletedAt) {
      throw new ConflictException(
        "O cliente está inativo: a ficha não recebe novos registros",
      );
    }

    if (dto.appointmentId) {
      const appointment = await this.appointmentService.findOne(
        dto.appointmentId,
        companyId,
      );
      if (appointment.clientId !== anamnesis.clientId) {
        throw new BadRequestException(
          "O agendamento deve ser do mesmo cliente da ficha",
        );
      }
    }

    const consultationDate = await this.resolveConsultationDate(
      dto.consultationDate,
      companyId,
      anamnesis.entries[0].consultationDate,
    );
    const answers = resolveAnswers(
      anamnesis.version.questions,
      dto.answers ?? [],
      { requireAll: false },
    );
    const professionalId =
      await this.accessService.findProfessionalId(currentUser);

    // Registro e auditoria na mesma transação.
    await this.prisma.$transaction(async (tx) => {
      const entry = await tx.anamnesisEntry.create({
        data: {
          anamnesisId: id,
          kind: AnamnesisEntryKind.FOLLOW_UP,
          consultationDate,
          appointmentId: dto.appointmentId,
          evolution: this.cryptoService.encrypt(dto.evolution),
          authorUserId: currentUser.id,
          authorProfessionalId: professionalId,
          answers: { create: this.encryptAnswers(answers) },
        },
        select: { id: true },
      });

      await this.auditService.record(
        {
          companyId,
          userId: currentUser.id,
          action: AuditAction.ANAMNESIS_ENTRY_CREATED,
          entityType: AUDIT_ENTRY,
          entityId: entry.id,
          clientId: anamnesis.clientId,
          ip,
        },
        tx,
      );
    });

    return this.buildView(id, companyId);
  }

  /**
   * Data da consulta: a informada (que exista e não seja futura) ou, sem
   * informar, hoje no fuso da empresa. Pelo texto AAAA-MM-DD a comparação é
   * direta, sem converter fusos. Num acompanhamento, também não pode ser anterior
   * ao registro inicial (`notBefore`).
   */
  private async resolveConsultationDate(
    input: string | undefined,
    companyId: string,
    notBefore?: Date,
  ): Promise<Date> {
    const timeZone = await this.companyService.getTimeZone(companyId);
    const { year, month, day } = toZonedParts(new Date(), timeZone);
    const pad = (value: number) => String(value).padStart(2, "0");
    const today = `${year}-${pad(month)}-${pad(day)}`;

    if (input === undefined) {
      return parseIsoDate(today)!;
    }

    const date = parseIsoDate(input);
    if (!date) {
      throw new BadRequestException("consultationDate não é uma data válida");
    }
    if (input > today) {
      throw new BadRequestException("A data da consulta não pode ser futura");
    }

    if (notBefore && date < notBefore) {
      throw new BadRequestException(
        "A data da consulta não pode ser anterior ao registro inicial da ficha",
      );
    }

    return date;
  }

  private encryptAnswers(
    answers: { questionId: string; value: AnswerValue }[],
  ): Prisma.AnamnesisAnswerCreateWithoutEntryInput[] {
    return answers.map(({ questionId, value }) => ({
      question: { connect: { id: questionId } },
      value: this.cryptoService.encrypt(JSON.stringify(value)),
    }));
  }

  // Monta a ficha decifrada. Não audita: quem expõe os dados registra o acesso.
  private async buildView(
    id: string,
    companyId: string,
  ): Promise<AnamnesisView> {
    const anamnesis = await this.prisma.anamnesis.findFirst({
      where: { id, companyId },
      ...viewArgs,
    });
    if (!anamnesis) {
      throw new NotFoundException("Ficha de anamnese não encontrada");
    }

    const entries = anamnesis.entries.map(
      ({ answers, evolution, ...entry }): AnamnesisEntryView => ({
        ...entry,
        evolution: evolution && this.cryptoService.decrypt(evolution),
        answers: answers.map(({ questionId, value }) => ({
          questionId,
          value: JSON.parse(this.cryptoService.decrypt(value)) as AnswerValue,
        })),
      }),
    );

    // Os registros estão em ordem de data: a última resposta de cada pergunta vence.
    const latest = new Map<string, AnamnesisView["current"][number]>();
    for (const entry of entries) {
      for (const answer of entry.answers) {
        latest.set(answer.questionId, {
          ...answer,
          entryId: entry.id,
          consultationDate: entry.consultationDate,
        });
      }
    }

    return {
      id: anamnesis.id,
      createdAt: anamnesis.createdAt,
      client: anamnesis.client,
      template: anamnesis.template,
      version: anamnesis.version,
      current: [...latest.values()],
      entries,
    };
  }
}
