import { ForbiddenException, Injectable } from "@nestjs/common";
import { Prisma } from "../../../generated/prisma/client";
import { DEFAULT_LIMITS } from "./access-catalog";

export type LimitedResource = "professionals" | "admins";

const LABEL: Record<LimitedResource, [singular: string, plural: string]> = {
  professionals: ["profissional", "profissionais"],
  admins: ["administrador", "administradores"],
};

/**
 * Limites de profissionais e administradores por empresa (ver
 * docs/business-rules/empresa-e-acesso.md, "Acessos e limites da empresa"). Quem cria ou reativa
 * um deles chama `assertWithinLimit` dentro da própria transação.
 */
@Injectable()
export class PlanLimitService {
  /**
   * Recusa (403 `PLAN_LIMIT_REACHED`) quando a empresa já usa todo o limite.
   * Só os ativos contam. A linha de limites da empresa é travada até o fim da
   * transação: dois cadastros ao mesmo tempo na última vaga não passam juntos.
   */
  async assertWithinLimit(
    resource: LimitedResource,
    companyId: string,
    tx: Prisma.TransactionClient,
  ): Promise<void> {
    // A trava vem antes da contagem: quem chega depois espera e conta de novo.
    await tx.$queryRaw`SELECT 1 FROM "company_limits" WHERE "companyId" = ${companyId} FOR UPDATE`;

    const [limits, used] = await Promise.all([
      tx.companyLimit.findUnique({ where: { companyId } }),
      this.countActive(resource, companyId, tx),
    ]);
    const limit =
      resource === "professionals"
        ? (limits?.maxProfessionals ?? DEFAULT_LIMITS.maxProfessionals)
        : (limits?.maxAdmins ?? DEFAULT_LIMITS.maxAdmins);

    if (used >= limit) {
      throw new ForbiddenException({
        statusCode: 403,
        error: "Forbidden",
        code: "PLAN_LIMIT_REACHED",
        message: `O plano da empresa permite ${limit} ${LABEL[resource][limit === 1 ? 0 : 1]}. Inative um ou peça a ampliação do limite`,
        resource,
        limit,
        used,
      });
    }
  }

  // Profissional inativo é o excluído logicamente (deletedAt preenchido).
  private countActive(
    resource: LimitedResource,
    companyId: string,
    tx: Prisma.TransactionClient,
  ): Promise<number> {
    return resource === "professionals"
      ? tx.people.count({
          where: { companyId, type: "PROFESSIONAL", deletedAt: null },
        })
      : tx.user.count({ where: { companyId, type: "ADMIN", deletedAt: null } });
  }
}
