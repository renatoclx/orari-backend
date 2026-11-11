import { Injectable, NotFoundException } from "@nestjs/common";
import { AuditAction, UserType } from "../../../generated/prisma/enums";
import { AuthenticatedUser } from "../../common/interfaces/authenticated-user.interface";
import { PrismaService } from "../../prisma/prisma.service";
import { AuditService } from "../audit/audit.service";
import {
  DEFAULT_LIMITS,
  FEATURE_CATALOG,
  emptyAccess,
  type AccessAction,
  fullAccess,
  type FeatureAccessFlags,
} from "./access-catalog";
import { assertValidAccess } from "./access-rules";
import { UpdateCompanyAccessDto } from "./dto/update-company-access.dto";

export type FeatureAccessEntry = { feature: string } & FeatureAccessFlags;

export interface CompanyAccessResponse {
  // Uma entrada por funcionalidade do catálogo; a que não tem linha vem sem acesso.
  features: FeatureAccessEntry[];
  limits: { professionals: number; admins: number };
  // Quanto a empresa já usa de cada limite (ativos hoje).
  usage: { professionals: number; admins: number };
}

/**
 * Acessos e limites por empresa (ver docs/business-rules/empresa-e-acesso.md, "Acessos e
 * limites"). Só o SUPER_ADMIN lê e grava, por empresa (garantido no controller).
 */
@Injectable()
export class CompanyAccessService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly auditService: AuditService,
  ) {}

  async findOne(companyId: string): Promise<CompanyAccessResponse> {
    await this.ensureCompanyExists(companyId);

    const [features, limit, professionals, admins] = await Promise.all([
      this.loadFeatures(companyId),
      this.prisma.companyLimit.findUnique({ where: { companyId } }),
      // Profissional inativo é o excluído logicamente (deletedAt preenchido).
      this.prisma.people.count({
        where: { companyId, type: "PROFESSIONAL", deletedAt: null },
      }),
      this.prisma.user.count({
        where: { companyId, type: "ADMIN", deletedAt: null },
      }),
    ]);

    return {
      features,
      limits: {
        professionals:
          limit?.maxProfessionals ?? DEFAULT_LIMITS.maxProfessionals,
        admins: limit?.maxAdmins ?? DEFAULT_LIMITS.maxAdmins,
      },
      usage: { professionals, admins },
    };
  }

  /**
   * Acessos do usuário logado (GET /auth/me): os da empresa dele. O SUPER_ADMIN
   * é o dono da plataforma e não é limitado por plano: vê tudo.
   */
  async findForUser(
    type: UserType,
    companyId: string,
  ): Promise<FeatureAccessEntry[]> {
    if (type === UserType.SUPER_ADMIN) {
      return FEATURE_CATALOG.map((feature) => ({
        feature: feature.key,
        ...fullAccess(feature),
      }));
    }
    return this.loadFeatures(companyId);
  }

  // Tipo da pessoa de um registro da empresa (inclui a excluída, para o restore).
  async findPersonType(
    companyId: string,
    personId: string,
  ): Promise<string | undefined> {
    const person = await this.prisma.people.findFirst({
      where: { id: personId, companyId },
      select: { type: true },
    });
    return person?.type;
  }

  // Uma consulta pela chave única: é o que a barreira das rotas faz a cada requisição.
  async can(
    companyId: string,
    feature: string,
    action: AccessAction,
  ): Promise<boolean> {
    const row = await this.prisma.companyFeatureAccess.findUnique({
      where: { companyId_feature: { companyId, feature } },
    });
    if (!row) return false;
    return {
      view: row.canView,
      edit: row.canEdit,
      create: row.canCreate,
      remove: row.canRemove,
    }[action];
  }

  // Uma entrada por funcionalidade do catálogo; sem linha, sem acesso.
  private async loadFeatures(companyId: string): Promise<FeatureAccessEntry[]> {
    const rows = await this.prisma.companyFeatureAccess.findMany({
      where: { companyId },
    });
    const byFeature = new Map(rows.map((row) => [row.feature, row]));
    return FEATURE_CATALOG.map(({ key }) => {
      const row = byFeature.get(key);
      return {
        feature: key,
        ...(row
          ? {
              view: row.canView,
              edit: row.canEdit,
              create: row.canCreate,
              remove: row.canRemove,
            }
          : emptyAccess()),
      };
    });
  }

  // Substitui a matriz e os limites de uma vez; a mudança fica no log de auditoria.
  async replace(
    companyId: string,
    dto: UpdateCompanyAccessDto,
    currentUser: AuthenticatedUser,
    ip?: string,
  ): Promise<CompanyAccessResponse> {
    await this.ensureCompanyExists(companyId);
    assertValidAccess(dto.features);

    const limits = {
      maxProfessionals: dto.limits.professionals,
      maxAdmins: dto.limits.admins,
    };

    await this.prisma.$transaction(async (tx) => {
      await tx.companyFeatureAccess.deleteMany({ where: { companyId } });
      // Só entram as funcionalidades com alguma ação: sem linha = sem acesso.
      await tx.companyFeatureAccess.createMany({
        data: dto.features
          .filter((item) => item.view)
          .map((item) => ({
            companyId,
            feature: item.feature,
            canView: item.view,
            canEdit: item.edit,
            canCreate: item.create,
            canRemove: item.remove,
          })),
      });
      await tx.companyLimit.upsert({
        where: { companyId },
        create: { companyId, ...limits },
        update: limits,
      });
      await this.auditService.record(
        {
          // O registro é da empresa do SUPER_ADMIN: o cliente não vê a gestão do plano dele.
          companyId: currentUser.companyId,
          userId: currentUser.id,
          action: AuditAction.COMPANY_ACCESS_CHANGED,
          entityType: "COMPANY",
          entityId: companyId,
          ip,
        },
        tx,
      );
    });

    return this.findOne(companyId);
  }

  private async ensureCompanyExists(companyId: string): Promise<void> {
    const company = await this.prisma.company.findUnique({
      where: { id: companyId },
      select: { id: true },
    });
    if (!company) throw new NotFoundException("Empresa não encontrada");
  }
}
