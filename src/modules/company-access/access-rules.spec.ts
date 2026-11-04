import { BadRequestException } from "@nestjs/common";
import { describe, expect, it } from "vitest";
import { defaultFeatureAccessRows, FEATURE_CATALOG } from "./access-catalog";
import { assertValidAccess, type FeatureAccessInput } from "./access-rules";

const full = (feature: string): FeatureAccessInput => ({
  feature,
  view: true,
  edit: true,
  create: true,
  remove: true,
});

// Todas as funcionalidades liberadas, respeitando as colunas de cada uma.
const allowed = (): FeatureAccessInput[] =>
  FEATURE_CATALOG.map(({ key, actions }) => ({
    feature: key,
    view: actions.includes("view"),
    edit: actions.includes("edit"),
    create: actions.includes("create"),
    remove: actions.includes("remove"),
  }));

describe("assertValidAccess", () => {
  it("aceita a matriz completa", () => {
    expect(() => assertValidAccess(allowed())).not.toThrow();
  });

  it("aceita uma matriz vazia (empresa sem nenhum acesso)", () => {
    expect(() => assertValidAccess([])).not.toThrow();
  });

  it("recusa funcionalidade desconhecida", () => {
    expect(() => assertValidAccess([full("foguete")])).toThrow(
      BadRequestException,
    );
  });

  it("recusa funcionalidade repetida", () => {
    expect(() => assertValidAccess([full("clients"), full("clients")])).toThrow(
      /repetida/,
    );
  });

  it("recusa ação que a funcionalidade não aceita (Auditoria só visualiza)", () => {
    expect(() =>
      assertValidAccess([
        {
          feature: "anamnesis-audit",
          view: true,
          edit: true,
          create: false,
          remove: false,
        },
      ]),
    ).toThrow(/não aceita/);
  });

  it("recusa editar, criar ou excluir sem visualizar", () => {
    expect(() =>
      assertValidAccess([
        {
          feature: "clients",
          view: false,
          edit: true,
          create: false,
          remove: false,
        },
      ]),
    ).toThrow(/exigem visualizar/);
  });

  it("agendamentos exige ver clientes, profissionais e serviços", () => {
    const matrix = allowed().map((item) =>
      item.feature === "clients"
        ? { ...item, view: false, edit: false, create: false, remove: false }
        : item,
    );
    expect(() => assertValidAccess(matrix)).toThrow(
      /Agendamentos, libere Visualiza em Clientes/,
    );
  });

  it("funcionalidade sem Visualiza não puxa dependência", () => {
    // Só os cadastros liberados; turmas, agendamentos etc. desligados.
    const matrix = ["clients", "professionals", "services"].map(full);
    expect(() => assertValidAccess(matrix)).not.toThrow();
  });
});

describe("defaultFeatureAccessRows", () => {
  it("deixa de fora anamnese e turmas, e o resultado é uma matriz válida", () => {
    const rows = defaultFeatureAccessRows();
    expect(rows.map((r) => r.feature)).not.toContain("class-groups");
    expect(rows.map((r) => r.feature)).not.toContain("anamnesis");
    const asInput = rows.map((r) => ({
      feature: r.feature,
      view: r.canView,
      edit: r.canEdit,
      create: r.canCreate,
      remove: r.canRemove,
    }));
    expect(() => assertValidAccess(asInput)).not.toThrow();
  });
});
