// Os primeiros passos da clínica nova (sem banco): a ordem, a funcionalidade do
// plano que cada um exige e se é opcional.

export const ONBOARDING_STEPS = [
  { key: "BUSINESS_HOURS", feature: "settings", optional: false },
  { key: "LOGO", feature: "settings", optional: false },
  { key: "SERVICE", feature: "services", optional: false },
  { key: "PROFESSIONAL", feature: "professionals", optional: false },
  { key: "CLIENT", feature: "clients", optional: false },
  { key: "APPOINTMENT", feature: "appointments", optional: false },
  // Opcional: liga o app do cliente (só se o plano tem o Portal do cliente).
  { key: "PORTAL", feature: "client-portal", optional: true },
] as const;

export type OnboardingStepKey = (typeof ONBOARDING_STEPS)[number]["key"];

export interface OnboardingStep {
  key: OnboardingStepKey;
  done: boolean;
  optional: boolean;
}

export interface OnboardingState {
  /** O usuário dispensou a lista. */
  dismissed: boolean;
  steps: OnboardingStep[];
  /** Quantos passos obrigatórios estão feitos, e de quantos. */
  completed: number;
  total: number;
}

/** Monta o estado: o progresso conta só os passos obrigatórios. */
export function buildOnboarding(
  steps: OnboardingStep[],
  dismissed: boolean,
): OnboardingState {
  const required = steps.filter((step) => !step.optional);
  return {
    dismissed,
    steps,
    completed: required.filter((step) => step.done).length,
    total: required.length,
  };
}
