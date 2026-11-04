import { SetMetadata } from "@nestjs/common";
import type {
  AccessAction,
  FeatureKey,
} from "../../modules/company-access/access-catalog";

export const FEATURE_KEY = "feature";
export const FEATURE_ACTION_KEY = "featureAction";
export const FEATURE_BY_PERSON_TYPE_KEY = "featureByPersonType";

// Liga a rota (ou o controller) a uma funcionalidade liberada por empresa;
// o FeatureAccessGuard global confere. Sem isso, a rota não é limitada por plano.
export const Feature = (feature: FeatureKey) =>
  SetMetadata(FEATURE_KEY, feature);

// Para /people: a funcionalidade (clientes, funcionários ou profissionais) vem do
// tipo da pessoa, lido do corpo, da consulta ou do registro (ver FeatureAccessGuard).
export const FeatureByPersonType = () =>
  SetMetadata(FEATURE_BY_PERSON_TYPE_KEY, true);

// Ação exigida quando o verbo HTTP não a diz (ex.: cancelar é PATCH, mas é "remove").
export const FeatureAction = (action: AccessAction) =>
  SetMetadata(FEATURE_ACTION_KEY, action);
