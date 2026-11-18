import { describe, expect, it } from "vitest";
import { assertValidAccess } from "./access-rules";
import { FEATURE_CATALOG } from "./access-catalog";
import { planFeatureAccessRows } from "./plan-templates";

const asInput = (plan: "ESSENTIAL" | "PLUS" | "CLINICAL") =>
  planFeatureAccessRows(plan).map((row) => ({
    feature: row.feature,
    view: row.canView,
    edit: row.canEdit,
    create: row.canCreate,
    remove: row.canRemove,
  }));

describe("planFeatureAccessRows", () => {
  it("os três planos passam nas regras da matriz", () => {
    for (const plan of ["ESSENTIAL", "PLUS", "CLINICAL"] as const) {
      expect(() => assertValidAccess(asInput(plan))).not.toThrow();
    }
  });

  it("Essencial: contas a receber só para ver; sem pacotes, anamnese e turmas", () => {
    const rows = planFeatureAccessRows("ESSENTIAL");
    expect(rows.find((row) => row.feature === "payments")).toEqual({
      feature: "payments",
      canView: true,
      canEdit: false,
      canCreate: false,
      canRemove: false,
    });
    const keys = rows.map((row) => row.feature);
    for (const key of ["plans", "payables", "anamnesis", "class-groups"]) {
      expect(keys).not.toContain(key);
    }
    expect(keys).toContain("tabs");
  });

  it("Plus: tudo menos anamnese e turmas; Clinical: tudo", () => {
    const plus = planFeatureAccessRows("PLUS").map((row) => row.feature);
    expect(plus).toContain("payables");
    expect(plus).not.toContain("anamnesis");
    expect(plus).not.toContain("class-groups");
    expect(planFeatureAccessRows("CLINICAL")).toHaveLength(
      FEATURE_CATALOG.length,
    );
  });
});
