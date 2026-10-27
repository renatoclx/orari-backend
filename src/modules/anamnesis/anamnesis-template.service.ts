import {
  ConflictException,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import { Prisma } from "../../../generated/prisma/client";
import { AuditAction } from "../../../generated/prisma/enums";
import type { AuthenticatedUser } from "../../common/interfaces/authenticated-user.interface";
import { PaginatedResult } from "../../common/interfaces/paginated-result.interface";
import { normalizeForSearch } from "../../common/text/normalize-for-search";
import { isUniqueConstraintViolation } from "../../prisma/prisma-errors";
import { PrismaService } from "../../prisma/prisma.service";
import { AuditService } from "../audit/audit.service";
import { validateQuestions } from "./anamnesis-question-rules";
import { AnamnesisAccessService } from "./anamnesis-access.service";
import { CreateAnamnesisTemplateDto } from "./dto/create-anamnesis-template.dto";
import { FindAnamnesisTemplatesQueryDto } from "./dto/find-anamnesis-templates-query.dto";
import { AnamnesisQuestionDto } from "./dto/anamnesis-question.dto";
import { UpdateAnamnesisTemplateDto } from "./dto/update-anamnesis-template.dto";

const ENTITY_TYPE = "ANAMNESIS_TEMPLATE";

// A versão vigente é a de maior número; as anteriores só interessam às fichas.
const withCurrentVersion = {
  omit: { normalizedName: true },
  include: {
    versions: {
      orderBy: { version: "desc" },
      take: 1,
      select: {
        id: true,
        version: true,
        createdAt: true,
        questions: {
          orderBy: { position: "asc" },
          select: {
            id: true,
            position: true,
            label: true,
            helpText: true,
            type: true,
            isRequired: true,
            options: true,
            detailLabel: true,
          },
        },
      },
    },
  },
} satisfies Prisma.AnamnesisTemplateDefaultArgs;

type TemplateWithVersion = Prisma.AnamnesisTemplateGetPayload<
  typeof withCurrentVersion
>;

export type AnamnesisTemplateResponse = Omit<
  TemplateWithVersion,
  "versions"
> & {
  currentVersion: TemplateWithVersion["versions"][number];
};

/**
 * Modelos de ficha da empresa do usuário autenticado; os de outras empresas se
 * comportam como inexistentes (404). O nome é único na empresa, sem diferenciar
 * acentos nem maiúsculas.
 *
 * Quem tem acesso à anamnese consulta; criar e editar é do ADMIN (restrito no
 * controller). As perguntas ficam em versões imutáveis: enviar `questions` na
 * edição cria a versão seguinte, e a anterior permanece como estava para as
 * fichas já abertas. Não existe exclusão: o modelo é inativado.
 */
@Injectable()
export class AnamnesisTemplateService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly accessService: AnamnesisAccessService,
    private readonly auditService: AuditService,
  ) {}

  async create(
    dto: CreateAnamnesisTemplateDto,
    currentUser: AuthenticatedUser,
    ip?: string,
  ): Promise<AnamnesisTemplateResponse> {
    const { questions, ...data } = dto;
    validateQuestions(questions);

    try {
      // Modelo, versão 1 e auditoria na mesma transação.
      const template = await this.prisma.$transaction(async (tx) => {
        const created = await tx.anamnesisTemplate.create({
          data: {
            ...data,
            normalizedName: normalizeForSearch(dto.name),
            companyId: currentUser.companyId,
            versions: {
              create: {
                version: 1,
                createdById: currentUser.id,
                questions: { create: this.toQuestionData(questions) },
              },
            },
          },
          ...withCurrentVersion,
        });

        await this.record(
          AuditAction.ANAMNESIS_TEMPLATE_CREATED,
          created.id,
          currentUser,
          ip,
          tx,
        );

        return created;
      });

      return this.toResponse(template);
    } catch (error) {
      throw this.mapUniqueViolation(error);
    }
  }

  async findAll(
    { page, limit, name, isActive }: FindAnamnesisTemplatesQueryDto,
    currentUser: AuthenticatedUser,
  ): Promise<PaginatedResult<AnamnesisTemplateResponse>> {
    await this.accessService.ensureAccess(currentUser);

    const where: Prisma.AnamnesisTemplateWhereInput = {
      companyId: currentUser.companyId,
      isActive,
      normalizedName: name ? { contains: normalizeForSearch(name) } : undefined,
    };

    const [items, total] = await this.prisma.$transaction([
      this.prisma.anamnesisTemplate.findMany({
        where,
        ...withCurrentVersion,
        orderBy: { name: "asc" },
        skip: (page - 1) * limit,
        take: limit,
      }),
      this.prisma.anamnesisTemplate.count({ where }),
    ]);

    return {
      items: items.map((template) => this.toResponse(template)),
      total,
      page,
      limit,
    };
  }

  async findOne(
    id: string,
    currentUser: AuthenticatedUser,
  ): Promise<AnamnesisTemplateResponse> {
    await this.accessService.ensureAccess(currentUser);

    return this.toResponse(await this.findInCompany(id, currentUser.companyId));
  }

  async update(
    id: string,
    dto: UpdateAnamnesisTemplateDto,
    currentUser: AuthenticatedUser,
    ip?: string,
  ): Promise<AnamnesisTemplateResponse> {
    const current = await this.findInCompany(id, currentUser.companyId);
    const { questions, ...data } = dto;

    if (questions) {
      validateQuestions(questions);
    }
    if (data.name !== undefined) {
      await this.ensureNameIsFree(data.name, currentUser.companyId, id);
    }

    try {
      const template = await this.prisma.$transaction(async (tx) => {
        const updated = await tx.anamnesisTemplate.update({
          where: { id },
          data: {
            ...data,
            // Mantém a coluna de busca em sincronia sempre que o nome muda.
            ...(data.name !== undefined && {
              normalizedName: normalizeForSearch(data.name),
            }),
            // Nova versão = a vigente + 1; a unicidade (templateId, version)
            // barra duas edições simultâneas.
            ...(questions && {
              versions: {
                create: {
                  version: current.versions[0].version + 1,
                  createdById: currentUser.id,
                  questions: { create: this.toQuestionData(questions) },
                },
              },
            }),
            updatedAt: new Date(),
          },
          ...withCurrentVersion,
        });

        await this.record(
          AuditAction.ANAMNESIS_TEMPLATE_UPDATED,
          id,
          currentUser,
          ip,
          tx,
        );

        return updated;
      });

      return this.toResponse(template);
    } catch (error) {
      if (isUniqueConstraintViolation(error)) {
        // O nome foi conferido antes; sobra a edição simultânea do mesmo modelo.
        throw new ConflictException(
          "O modelo foi alterado por outra pessoa; recarregue e tente novamente",
        );
      }
      throw error;
    }
  }

  private async findInCompany(id: string, companyId: string) {
    const template = await this.prisma.anamnesisTemplate.findFirst({
      where: { id, companyId },
      ...withCurrentVersion,
    });

    if (!template) {
      throw new NotFoundException("Modelo de anamnese não encontrado");
    }

    return template;
  }

  // O nome só conflita com outro modelo da empresa (renomear para o mesmo nome é permitido).
  private async ensureNameIsFree(name: string, companyId: string, id: string) {
    const existing = await this.prisma.anamnesisTemplate.findFirst({
      where: {
        companyId,
        normalizedName: normalizeForSearch(name),
        id: { not: id },
      },
      select: { id: true },
    });

    if (existing) {
      throw new ConflictException(
        "Já existe um modelo com este nome na empresa",
      );
    }
  }

  // A posição é a ordem da lista enviada, de 1 em diante.
  private toQuestionData(
    questions: AnamnesisQuestionDto[],
  ): Prisma.AnamnesisQuestionCreateWithoutVersionInput[] {
    return questions.map((question, index) => ({
      position: index + 1,
      label: question.label,
      helpText: question.helpText,
      type: question.type,
      isRequired: question.isRequired ?? false,
      options: question.options ?? [],
      detailLabel: question.detailLabel,
    }));
  }

  private record(
    action: AuditAction,
    templateId: string,
    currentUser: AuthenticatedUser,
    ip: string | undefined,
    tx: Prisma.TransactionClient,
  ) {
    return this.auditService.record(
      {
        companyId: currentUser.companyId,
        userId: currentUser.id,
        action,
        entityType: ENTITY_TYPE,
        entityId: templateId,
        ip,
      },
      tx,
    );
  }

  private toResponse(template: TemplateWithVersion): AnamnesisTemplateResponse {
    const { versions, ...rest } = template;

    return { ...rest, currentVersion: versions[0] };
  }

  private mapUniqueViolation(error: unknown): unknown {
    return isUniqueConstraintViolation(error)
      ? new ConflictException("Já existe um modelo com este nome na empresa")
      : error;
  }
}
