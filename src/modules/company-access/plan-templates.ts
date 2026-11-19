import type { SubscriptionPlan } from "../../../generated/prisma/enums";
import { FEATURE_CATALOG, fullAccess } from "./access-catalog";

/**
 * Acessos e limites de cada plano (docs/business-rules/empresa-e-acesso.md,
 * "Cadastro sozinho"). Espelham os modelos do painel do SUPER_ADMIN
 * (frontend: `ACCESS_TEMPLATES` em company-access.ts): mudou um, muda o outro.
 * Usados quando a empresa se cadastra sozinha, no plano escolhido na landing.
 */

// Essencial: agenda, cadastros, app do cliente e do profissional, receber o
// cliente (comanda e métodos de pagamento) e os relatórios da agenda.
const ESSENTIAL_KEYS = [
  "appointments",
  "recurrences",
  "clients",
  "employees",
  "professionals",
  "users",
  "services",
  "settings",
  "client-portal",
  "messages",
  "professional-app",
  "tabs",
  "payment-methods",
  "payments",
  "financial-report",
  "appointments-report",
  "clients-report",
  "client-portfolio",
  "dashboard",
];
// Plus: tudo, menos anamnese e turmas (só no Clinical).
const CLINICAL_ONLY_KEYS = [
  "anamnesis",
  "anamnesis-templates",
  "anamnesis-audit",
  "class-groups",
];
// No Essencial, Contas a receber é só para ver (o Dashboard e o Financeiro
// precisam ler os pagamentos; a gestão das contas é do Plus em diante).
const VIEW_ONLY: Partial<Record<SubscriptionPlan, string[]>> = {
  ESSENTIAL: ["payments"],
};

const ENABLED: Record<SubscriptionPlan, (key: string) => boolean> = {
  ESSENTIAL: (key) => ESSENTIAL_KEYS.includes(key),
  PLUS: (key) => !CLINICAL_ONLY_KEYS.includes(key),
  CLINICAL: () => true,
};

/** Profissionais incluídos e administradores de cada plano. */
export const PLAN_LIMITS: Record<
  SubscriptionPlan,
  { maxProfessionals: number; maxAdmins: number }
> = {
  ESSENTIAL: { maxProfessionals: 2, maxAdmins: 1 },
  PLUS: { maxProfessionals: 5, maxAdmins: 2 },
  CLINICAL: { maxProfessionals: 7, maxAdmins: 3 },
};

/** Mensal de cada plano (tabela da landing; o valor gravado na assinatura é o que vale). */
export const PLAN_MONTHLY_PRICE: Record<SubscriptionPlan, number> = {
  ESSENTIAL: 44.9,
  PLUS: 89.9,
  CLINICAL: 129.9,
};

/** Linhas da matriz do plano (colunas do banco); sem linha = sem acesso. */
export function planFeatureAccessRows(plan: SubscriptionPlan) {
  return FEATURE_CATALOG.filter((feature) => ENABLED[plan](feature.key)).map(
    (feature) => {
      const flags = fullAccess(feature);
      const viewOnly = VIEW_ONLY[plan]?.includes(feature.key) ?? false;
      return {
        feature: feature.key,
        canView: flags.view,
        canEdit: viewOnly ? false : flags.edit,
        canCreate: viewOnly ? false : flags.create,
        canRemove: viewOnly ? false : flags.remove,
      };
    },
  );
}
