# 04 – Pessoas

Clientes, profissionais e funcionários de uma empresa.

**PR:** 5 (`feat/entidades-base`) · **Regras:** [business-rules.md § Pessoas](../business-rules.md)

## Regras em resumo

- A pessoa pertence à empresa do usuário autenticado; **`companyId` não é aceito
  no payload** (enviar retorna 400).
- Tipos: `CLIENT`, `EMPLOYEE`, `PROFESSIONAL`.
- `document` é um CPF válido, sem máscara. É único por empresa entre as pessoas
  não excluídas — o documento de uma pessoa excluída pode ser reutilizado.
- Busca por nome é parcial e ignora acentos e maiúsculas.
- Exclusão lógica. Pessoas de outra empresa respondem 404.

## Onde está

| Arquivo | Responsabilidade |
| ------- | ---------------- |
| `modules/people/people.service.ts` | Escopo por empresa, filtros e sincronia de `normalizedName` |
| `modules/people/dto/create-people.dto.ts` | CPF, data de nascimento, tipo |
| `modules/people/dto/find-people-query.dto.ts` | Filtros `name`, `document`, `type` |

## Rotas

| Método | Rota |
| ------ | ---- |
| POST | `/people` |
| GET | `/people` (`?name`, `?document`, `?type`) |
| GET/PATCH/DELETE | `/people/:id` |

## Testes

`people.service.spec.ts` (9), `create-people.dto.spec.ts` (3).

## O que olhar com atenção

- **`normalizedName` é dado derivado:** o service preenche na criação e sempre
  que o nome muda. Gravar pessoa por fora do service (SQL, script) exige
  preencher a coluna — o banco recusa sem ela, mas uma *alteração* feita por fora
  deixaria a busca desatualizada.
- **Tipo é livre para mudar** no PATCH: um CLIENT com agendamentos pode virar
  EMPLOYEE, e os agendamentos antigos continuam apontando para ele.
- Excluir uma pessoa **não** cancela os agendamentos dela; apenas esconde os
  contatos e endereços (ver guia 05).
