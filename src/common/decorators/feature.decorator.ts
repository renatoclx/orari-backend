import { SetMetadata } from "@nestjs/common";
import type {
  AccessAction,
  FeatureKey,
} from "../../modules/company-access/access-catalog";

export const FEATURE_KEY = "feature";
export const FEATURE_ACTION_KEY = "featureAction";

// Liga a rota (ou o controller) a uma funcionalidade liberada por empresa;
// o FeatureAccessGuard global confere. Sem isso, a rota não é limitada por plano.
export const Feature = (feature: FeatureKey) =>
  SetMetadata(FEATURE_KEY, feature);

// Ação exigida quando o verbo HTTP não a diz (ex.: cancelar é PATCH, mas é "remove").
export const FeatureAction = (action: AccessAction) =>
  SetMetadata(FEATURE_ACTION_KEY, action);
