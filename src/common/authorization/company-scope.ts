import { ForbiddenException } from "@nestjs/common";
import { UserType } from "../../../generated/prisma/enums";
import { AuthenticatedUser } from "../interfaces/authenticated-user.interface";

export const isSuperAdmin = (user: AuthenticatedUser) =>
  user.type === UserType.SUPER_ADMIN;

/**
 * Define em qual empresa o usuário autenticado pode agir.
 *
 * - SUPER_ADMIN administra a plataforma: devolve a empresa pedida, ou `undefined`
 *   quando nenhuma foi pedida (o chamador decide se isso significa "todas" ou se é
 *   um dado obrigatório).
 * - Os demais tipos só agem na própria empresa. Pedir explicitamente outra empresa
 *   é um erro de permissão (403), e não um "não encontrado", porque o próprio
 *   usuário informou o identificador.
 */
export function resolveCompanyScope(
  user: AuthenticatedUser,
  requestedCompanyId?: string,
): string | undefined {
  if (isSuperAdmin(user)) {
    return requestedCompanyId;
  }

  if (requestedCompanyId && requestedCompanyId !== user.companyId) {
    throw new ForbiddenException(
      "Apenas SUPER_ADMIN pode atuar em outra empresa",
    );
  }

  return user.companyId;
}
