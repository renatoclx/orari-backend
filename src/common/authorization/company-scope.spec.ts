import { ForbiddenException } from "@nestjs/common";
import { describe, expect, it } from "vitest";
import {
  adminUser,
  COMPANY_ID,
  OTHER_COMPANY_ID,
  regularUser,
  superAdminUser,
} from "../../../test/fixtures/authenticated-users";
import { isSuperAdmin, resolveCompanyScope } from "./company-scope";

describe("resolveCompanyScope", () => {
  it("SUPER_ADMIN atua na empresa pedida", () => {
    expect(resolveCompanyScope(superAdminUser, OTHER_COMPANY_ID)).toBe(
      OTHER_COMPANY_ID,
    );
  });

  it("SUPER_ADMIN sem empresa pedida recebe undefined (todas)", () => {
    expect(resolveCompanyScope(superAdminUser)).toBeUndefined();
  });

  it.each([adminUser, regularUser])(
    "$type atua sempre na própria empresa",
    (user) => {
      expect(resolveCompanyScope(user)).toBe(COMPANY_ID);
      expect(resolveCompanyScope(user, COMPANY_ID)).toBe(COMPANY_ID);
    },
  );

  it.each([adminUser, regularUser])(
    "$type não pode pedir outra empresa",
    (user) => {
      expect(() => resolveCompanyScope(user, OTHER_COMPANY_ID)).toThrow(
        ForbiddenException,
      );
    },
  );

  it("isSuperAdmin identifica apenas SUPER_ADMIN", () => {
    expect(isSuperAdmin(superAdminUser)).toBe(true);
    expect(isSuperAdmin(adminUser)).toBe(false);
  });
});
