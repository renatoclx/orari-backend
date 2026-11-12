// Catálogo de funcionalidades que o SUPER_ADMIN libera por empresa. As chaves
// são as mesmas da matriz do frontend (Acessos e limites). Funcionalidade nova
// entra aqui e nasce sem acesso nas empresas existentes (sem linha no banco).

export const ACCESS_ACTIONS = ["view", "edit", "create", "remove"] as const;
export type AccessAction = (typeof ACCESS_ACTIONS)[number];

export type FeatureAccessFlags = Record<AccessAction, boolean>;

export const FEATURE_KEYS = [
  "appointments",
  "recurrences",
  "clients",
  "employees",
  "professionals",
  "suppliers",
  "users",
  "services",
  "plans",
  "contracts",
  "tabs",
  "payments",
  "payment-methods",
  "expense-categories",
  "payables",
  "product-categories",
  "products",
  "product-sales",
  "professional-app",
  "anamnesis",
  "anamnesis-templates",
  "anamnesis-audit",
  "class-groups",
  "settings",
  "client-portal",
  "messages",
  "client-portfolio",
  "receivables",
  "appointments-report",
  "rankings",
  "financial-report",
  "packages-report",
  "clients-report",
  "dashboard",
  "commissions",
] as const;
export type FeatureKey = (typeof FEATURE_KEYS)[number];

// Uma só rota (/people) atende os três cadastros: o tipo da pessoa diz a funcionalidade.
export const PERSON_TYPE_FEATURE: Record<string, FeatureKey> = {
  CLIENT: "clients",
  EMPLOYEE: "employees",
  PROFESSIONAL: "professionals",
  SUPPLIER: "suppliers",
};

interface FeatureDefinition {
  key: FeatureKey;
  // Ações que fazem sentido para a funcionalidade (as demais são sempre falsas).
  actions: readonly AccessAction[];
  // Funcionalidades cujo Visualiza esta precisa ter (ex.: o agendamento lista clientes).
  requiresView?: readonly FeatureKey[];
}

const ALL = ACCESS_ACTIONS;
const BASE_REGISTRIES: readonly FeatureKey[] = [
  "clients",
  "professionals",
  "services",
];

export const FEATURE_CATALOG: readonly FeatureDefinition[] = [
  { key: "appointments", actions: ALL, requiresView: BASE_REGISTRIES },
  { key: "recurrences", actions: ALL, requiresView: BASE_REGISTRIES },
  { key: "clients", actions: ALL },
  { key: "employees", actions: ALL },
  { key: "professionals", actions: ALL },
  // Fornecedores: cadastro de pessoa, favorecido das contas a pagar.
  { key: "suppliers", actions: ALL },
  { key: "users", actions: ALL },
  { key: "services", actions: ALL },
  { key: "plans", actions: ALL },
  { key: "contracts", actions: ALL, requiresView: BASE_REGISTRIES },
  { key: "tabs", actions: ALL, requiresView: BASE_REGISTRIES },
  { key: "payments", actions: ALL },
  { key: "payment-methods", actions: ALL },
  // Categorias de despesa (contas a pagar): só o ADMIN usa.
  { key: "expense-categories", actions: ALL },
  // Contas a pagar: só o ADMIN usa. Pagar = Edita; cancelar e excluir = Exclui.
  { key: "payables", actions: ALL },
  { key: "product-categories", actions: ALL },
  // O cadastro do produto escolhe a categoria.
  { key: "products", actions: ALL, requiresView: ["product-categories"] },
  // Venda de produtos na comanda (só o ADMIN vende): Cria = vender; Exclui =
  // cancelar a venda pendente. Não há alteração da venda.
  {
    key: "product-sales",
    actions: ["view", "create", "remove"],
    requiresView: ["tabs", "products"],
  },
  // App do profissional (PWA, só leitura): a agenda, os clientes e as
  // comissões dele. Vem em todos os planos; o SUPER_ADMIN pode desligar.
  {
    key: "professional-app",
    actions: ["view"],
    requiresView: ["appointments"],
  },
  { key: "anamnesis", actions: ALL, requiresView: BASE_REGISTRIES },
  { key: "anamnesis-templates", actions: ALL },
  { key: "anamnesis-audit", actions: ["view"] },
  { key: "class-groups", actions: ALL, requiresView: BASE_REGISTRIES },
  { key: "settings", actions: ["view", "edit"] },
  // Portal do cliente: Visualiza = portal disponível à clínica; Edita = mudar as regras dele.
  { key: "client-portal", actions: ["view", "edit"] },
  // Mensagens automáticas ao cliente do app: Visualiza = ler; Edita = ligar e
  // mudar os textos. Só fazem sentido com o portal (o cliente recebe pelo app).
  {
    key: "messages",
    actions: ["view", "edit"],
    requiresView: ["client-portal"],
  },
  // Relatórios → Carteira de clientes: só leitura.
  {
    key: "client-portfolio",
    actions: ["view"],
    requiresView: ["clients", "professionals"],
  },
  // Relatórios → Contas a receber: só leitura, sobre os pagamentos.
  {
    key: "receivables",
    actions: ["view"],
    requiresView: ["payments", "clients"],
  },
  // Relatórios → Agendamentos: só leitura.
  {
    key: "appointments-report",
    actions: ["view"],
    requiresView: ["appointments"],
  },
  // Relatórios → Rankings: só leitura, sobre atendimentos e pagamentos.
  {
    key: "rankings",
    actions: ["view"],
    requiresView: ["appointments", "payments"],
  },
  // Relatórios → Financeiro: só leitura, sobre os pagamentos recebidos.
  {
    key: "financial-report",
    actions: ["view"],
    requiresView: ["payments"],
  },
  // Relatórios → Pacotes: só leitura, sobre as contratações.
  {
    key: "packages-report",
    actions: ["view"],
    requiresView: ["contracts"],
  },
  // Relatórios → Perfil do cliente: só leitura, sobre clientes e agendamentos.
  {
    key: "clients-report",
    actions: ["view"],
    requiresView: ["clients", "appointments"],
  },
  // Dashboard: só a tela (sem rota própria na API); cada bloco usa a rota do
  // relatório de origem e segue a funcionalidade dele.
  { key: "dashboard", actions: ["view"] },
  // Financeiro → Comissões: consulta, lançar adiantamento (Cria), fechar
  // (Edita) e excluir adiantamento ou desfazer fechamento (Exclui).
  {
    key: "commissions",
    actions: ["view", "edit", "create", "remove"],
    requiresView: ["professionals", "payments"],
  },
];

// Funcionalidades que o modelo padrão de uma empresa nova deixa de fora.
const DEFAULT_OFF: readonly string[] = [
  "anamnesis",
  "anamnesis-templates",
  "anamnesis-audit",
  "class-groups",
  // O SUPER_ADMIN libera o portal e as mensagens a quem contratar.
  "client-portal",
  "messages",
  // Produtos: liberados pelo SUPER_ADMIN a quem contratar.
  "product-categories",
  "products",
  "product-sales",
];

// Limites do modelo padrão (o "Essencial": administrador + 2 profissionais).
export const DEFAULT_LIMITS = { maxProfessionals: 3, maxAdmins: 1 } as const;

const NONE: FeatureAccessFlags = {
  view: false,
  edit: false,
  create: false,
  remove: false,
};

/** Todas as ações que a funcionalidade aceita, ligadas. */
export function fullAccess(feature: FeatureDefinition): FeatureAccessFlags {
  return {
    view: feature.actions.includes("view"),
    edit: feature.actions.includes("edit"),
    create: feature.actions.includes("create"),
    remove: feature.actions.includes("remove"),
  };
}

/** Linhas do modelo padrão de uma empresa nova (colunas do banco). */
export function defaultFeatureAccessRows() {
  return FEATURE_CATALOG.filter(
    (feature) => !DEFAULT_OFF.includes(feature.key),
  ).map((feature) => {
    const flags = fullAccess(feature);
    return {
      feature: feature.key,
      canView: flags.view,
      canEdit: flags.edit,
      canCreate: flags.create,
      canRemove: flags.remove,
    };
  });
}

export function emptyAccess(): FeatureAccessFlags {
  return { ...NONE };
}
