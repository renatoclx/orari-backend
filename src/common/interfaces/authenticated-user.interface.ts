import { UserType } from "../../../generated/prisma/enums";

// Conteúdo de request.user após o JwtAuthGuard (ver JwtStrategy.validate).
export interface AuthenticatedUser {
  id: string;
  email: string;
  type: UserType;
  companyId: string;
}
