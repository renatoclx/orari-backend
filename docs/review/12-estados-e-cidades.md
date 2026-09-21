# 12 – Estados e cidades

Base territorial usada pelos endereços.

**PR:** 5 (`feat/entidades-base`) · **Regras:** [business-rules.md § Estados e cidades](../business-rules.md)

## Regras em resumo

- **Somente leitura pela API**, mantidas pelo seed a partir de uma cópia dos
  dados do IBGE (27 estados e 5.571 cidades).
- Dados globais: não pertencem a nenhuma empresa e são visíveis a qualquer
  usuário autenticado.
- Não usam exclusão lógica (exceção documentada no `database.md`).
- Busca de cidade por nome é parcial e ignora acentos e maiúsculas; também dá
  para filtrar por estado.

## Onde está

| Arquivo | Responsabilidade |
| ------- | ---------------- |
| `modules/state/state.service.ts` | Listagem e busca por id |
| `modules/city/city.service.ts` | Listagem com filtros `stateId` e `name` |
| `prisma/seed.ts` | Carga idempotente a partir do snapshot |
| `prisma/seed-data/states-cities.json` | Snapshot versionado do IBGE |

## Rotas

| Método | Rota |
| ------ | ---- |
| GET | `/states`, `/states/:id` |
| GET | `/cities` (`?stateId`, `?name`), `/cities/:id` |

## Testes

`state.service.spec.ts` (3), `city.service.spec.ts` (4).

## O que olhar com atenção

- **A coluna `normalizedName`** é preenchida pelo seed. O preenchimento inicial
  na migration usou `unaccent` do Postgres e foi conferido contra a função da
  aplicação nas 5.571 cidades (sem divergência).
- **O snapshot é versionado**, então atualizações do IBGE exigem regerar o JSON
  — não há sincronização automática.
- Não há rota para criar ou editar: uma cidade nova só entra pelo seed.
