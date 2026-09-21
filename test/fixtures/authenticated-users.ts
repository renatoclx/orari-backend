import { AuthenticatedUser } from "../../src/common/interfaces/authenticated-user.interface";

// Usuários autenticados de referência para os testes de escopo por empresa.
export const PLATFORM_COMPANY_ID = "platform-company";
export const COMPANY_ID = "company-1";
export const OTHER_COMPANY_ID = "company-2";

export const superAdminUser: AuthenticatedUser = {
  id: "super-admin-1",
  email: "super@orari.com",
  type: "SUPER_ADMIN",
  companyId: PLATFORM_COMPANY_ID,
};

export const adminUser: AuthenticatedUser = {
  id: "admin-1",
  email: "admin@empresa.com",
  type: "ADMIN",
  companyId: COMPANY_ID,
};

export const regularUser: AuthenticatedUser = {
  id: "user-1",
  email: "user@empresa.com",
  type: "USER",
  companyId: COMPANY_ID,
};
