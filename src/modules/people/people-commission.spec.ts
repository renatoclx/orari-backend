import { ForbiddenException } from "@nestjs/common";
import { describe, expect, it } from "vitest";
import type { AuthenticatedUser } from "../../common/interfaces/authenticated-user.interface";
import { ensureCanSetCommission } from "./people.controller";
import { commissionSinceOf } from "./people.service";

describe("recebe comissão (profissional)", () => {
  const now = new Date("2026-11-10T15:00:00Z");

  it("religar vale dali em diante; desligar limpa a data; igual, nada", () => {
    expect(commissionSinceOf(true, false, now)).toEqual({
      commissionSince: now,
    });
    expect(commissionSinceOf(false, true, now)).toEqual({
      commissionSince: null,
    });
    expect(commissionSinceOf(true, true, now)).toEqual({});
    expect(commissionSinceOf(undefined, false, now)).toEqual({});
  });

  it("só o ADMIN envia o campo", () => {
    const admin = { type: "ADMIN" } as AuthenticatedUser;
    const user = { type: "PROFESSIONAL" } as AuthenticatedUser;
    expect(() =>
      ensureCanSetCommission({ receivesCommission: false }, user),
    ).toThrow(ForbiddenException);
    expect(() => ensureCanSetCommission({}, user)).not.toThrow();
    expect(() =>
      ensureCanSetCommission({ receivesCommission: true }, admin),
    ).not.toThrow();
  });
});
