import { SetMetadata } from "@nestjs/common";
import { UserType } from "../../../generated/prisma/enums";

export const ROLES_KEY = "roles";

// Restringe a rota aos tipos de usuário informados (verificado pelo RolesGuard global).
export const Roles = (...roles: UserType[]) => SetMetadata(ROLES_KEY, roles);
