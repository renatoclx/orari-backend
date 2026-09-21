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
