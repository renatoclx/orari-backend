import type { Decimal } from "../../../generated/prisma/internal/prismaNamespace";

// Como o app do profissional mostra o serviço e a origem de um atendimento
// (a agenda e o histórico do cliente usam o mesmo formato).

/** O serviço com o preço em número (o Decimal sairia como texto). */
export function presentService<T extends { price: Decimal | null }>(
  service: T,
): Omit<T, "price"> & { price: number | null } {
  return { ...service, price: service.price?.toNumber() ?? null };
}

/** Origem: de uma recorrência (e se é de pacote) ou avulso (nulo). */
export function presentOrigin(
  recurringAppointment: { clientPlanId: string | null } | null,
): { isPackage: boolean } | null {
  return recurringAppointment
    ? { isPackage: recurringAppointment.clientPlanId !== null }
    : null;
}
