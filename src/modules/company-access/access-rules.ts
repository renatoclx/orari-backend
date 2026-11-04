import { BadRequestException } from "@nestjs/common";
import {
  ACCESS_ACTIONS,
  FEATURE_CATALOG,
  type FeatureAccessFlags,
} from "./access-catalog";

export interface FeatureAccessInput extends FeatureAccessFlags {
  feature: string;
}

const LABELS: Record<string, string> = {
  appointments: "Agendamentos",
  recurrences: "Recorrências",
  clients: "Clientes",
  professionals: "Profissionais",
  services: "Serviços",
  contracts: "Contratações",
  tabs: "Comandas",
  anamnesis: "Fichas de anamnese",
  "class-groups": "Turmas",
};

const label = (key: string) => LABELS[key] ?? key;

/**
 * Confere a matriz recebida: chave conhecida e sem repetição, só ações que a
 * funcionalidade aceita, Edita/Cria/Exclui exigem Visualiza e as dependências
 * entre funcionalidades (ex.: Agendamentos exige ver Clientes). Lança 400.
 */
export function assertValidAccess(features: FeatureAccessInput[]): void {
  const byKey = new Map<string, FeatureAccessInput>();

  for (const item of features) {
    const definition = FEATURE_CATALOG.find((f) => f.key === item.feature);
    if (!definition) {
      throw new BadRequestException(
        `Funcionalidade desconhecida: ${item.feature}`,
      );
    }
    if (byKey.has(item.feature)) {
      throw new BadRequestException(`Funcionalidade repetida: ${item.feature}`);
    }
    for (const action of ACCESS_ACTIONS) {
      if (item[action] && !definition.actions.includes(action)) {
        throw new BadRequestException(
          `A funcionalidade ${item.feature} não aceita a ação ${action}`,
        );
      }
    }
    if (!item.view && (item.edit || item.create || item.remove)) {
      throw new BadRequestException(
        `Para ${item.feature}, editar, criar e excluir exigem visualizar`,
      );
    }
    byKey.set(item.feature, item);
  }

  for (const definition of FEATURE_CATALOG) {
    if (!byKey.get(definition.key)?.view) continue;
    for (const required of definition.requiresView ?? []) {
      if (!byKey.get(required)?.view) {
        throw new BadRequestException(
          `Para liberar ${label(definition.key)}, libere Visualiza em ${label(required)}`,
        );
      }
    }
  }
}
