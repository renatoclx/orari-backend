import { describe, expect, it } from "vitest";
import { buildOnboarding, ONBOARDING_STEPS } from "./onboarding-steps";

describe("buildOnboarding", () => {
  it("o progresso conta só os passos obrigatórios", () => {
    const state = buildOnboarding(
      [
        { key: "SERVICE", optional: false, done: true },
        { key: "PROFESSIONAL", optional: false, done: false },
        { key: "PORTAL", optional: true, done: true },
      ],
      false,
    );
    expect(state).toMatchObject({ completed: 1, total: 2, dismissed: false });
  });

  it("repassa se foi dispensado", () => {
    expect(buildOnboarding([], true).dismissed).toBe(true);
  });
});

describe("ONBOARDING_STEPS", () => {
  it("são seis obrigatórios e o portal opcional, cada um com a funcionalidade do plano", () => {
    expect(ONBOARDING_STEPS.filter((step) => !step.optional)).toHaveLength(6);
    expect(
      ONBOARDING_STEPS.filter((step) => step.optional).map((s) => s.key),
    ).toEqual(["PORTAL"]);
    for (const step of ONBOARDING_STEPS) expect(step.feature).toBeTruthy();
  });
});
