# 00 – Convenções transversais

Decisões que valem para quase todos os módulos. Entendendo estas, os demais
guias ficam curtos.

**PR:** 3 (`feat/common`)

## Regras em resumo

- **Escopo por empresa:** a empresa vem sempre do `request.user`, nunca do corpo
  da requisição. Quem não é SUPER_ADMIN só enxerga a própria empresa.
- **404 × 403:** registro fora do alcance responde **404**, para não revelar que
  existe. Pedir explicitamente outra empresa (`companyId` no filtro ou no
  payload) responde **403**, porque o usuário informou o identificador.
- **Exclusão lógica:** a maioria das entidades usa `deletedAt`. As exceções
  (Company, Appointment, RecurringAppointment, RecurringDay, Notification, State
  e City) estão no [`database.md`](../database.md).
- **Paginação:** toda listagem devolve `items`, `total`, `page` e `limit`
  (máximo 100).
- **Status HTTP:** 201 no POST, 200 no GET e PATCH, 204 no DELETE.

## Onde está

| Arquivo | Responsabilidade |
| ------- | ---------------- |
| `common/authorization/company-scope.ts` | `resolveCompanyScope()`: em qual empresa o usuário pode agir; lança 403 ao pedir outra |
| `common/authorization/owner-scope.ts` | `ownedByCompany()`: filtro dos registros de dono misto (contato/endereço) visíveis para a empresa |
| `common/decorators/current-user.decorator.ts` | `@CurrentUser()` |
| `common/decorators/roles.decorator.ts` | `@Roles()` |
| `common/dto/pagination-query.dto.ts` | `page` e `limit` |
| `common/dto/owner.dto.ts` | Dono exclusivo: empresa **ou** pessoa |
| `common/dto/find-owned-query.dto.ts` | Filtros por dono |
| `common/validators/` | `ExactlyOneOf`, `AtLeastOneOf`, `Match`, `IsCpf`, `IsCnpj`, `IsTimeZone` |
| `common/text/normalize-for-search.ts` | Normalização para busca sem acento |
| `common/time/time-of-day.ts` | `"HH:MM"` ↔ colunas `time` |
| `common/time/time-zone.ts` | Relógio da empresa ↔ instante UTC |
| `src/prisma/prisma-errors.ts` | Violação de unicidade (P2002) vira 409 |

## Testes

`company-scope.spec.ts` (5), `document.validator.spec.ts` (4),
`time-zone.spec.ts` (8), `time-of-day.spec.ts` (3),
`normalize-for-search.spec.ts` (2), `owner.dto.spec.ts` (7, vive na PR 5).

## O que olhar com atenção

- **Acesso a dados de outro módulo:** contatos, endereços, pagamentos e usuários
  são filtrados usando relações (`people`, `appointment`, `company`) na própria
  query. É leitura, mas é uma exceção consciente à regra do
  [`architecture.md`](../architecture.md) de um módulo não acessar o banco de
  outro. Está comentada no código.
- **`IsCnpj` aceita o formato alfanumérico** (emitido desde jul/2026) além do
  numérico. Vale conferir o algoritmo em `document.validator.ts`.
- **Índices únicos parciais** usam um recurso *preview* do Prisma
  (`partialIndexes`). Por isso as versões do Prisma estão fixadas.
