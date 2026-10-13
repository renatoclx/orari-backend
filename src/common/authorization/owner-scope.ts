/**
 * Filtro Prisma dos registros com dono misto (contatos e endereços) que uma
 * empresa pode acessar: os que pertencem à própria empresa e os que pertencem a
 * pessoas dela ainda não excluídas.
 *
 * O filtro pela relação `people` é apenas um JOIN de leitura para descobrir a
 * empresa do dono; nenhum dado de pessoa é lido ou alterado por quem o usa.
 * Contatos e endereços de uma pessoa excluída deixam de aparecer junto com ela.
 */
export const ownedByCompany = (companyId: string) => ({
  OR: [{ companyId }, { people: { companyId, deletedAt: null } }],
});

type Owner = { companyId?: string | null; peopleId?: string | null };

/**
 * Filtro Prisma do contato/endereço principal atual de um dono. O dono é
 * obrigatório: sem ele, o filtro alcançaria registros de todas as empresas.
 */
export function principalOfOwner(owner: Owner) {
  const ownerFilter = owner.peopleId
    ? { peopleId: owner.peopleId }
    : owner.companyId
      ? { companyId: owner.companyId }
      : undefined;

  if (!ownerFilter) {
    throw new Error("O registro precisa de um dono para ter principal");
  }

  return { ...ownerFilter, isPrincipal: true, deletedAt: null };
}
