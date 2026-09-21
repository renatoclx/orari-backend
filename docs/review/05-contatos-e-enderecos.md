# 05 – Contatos e endereços

Dados de contato e de localização, que pertencem **ou** a uma empresa **ou** a
uma pessoa.

**PR:** 5 (`feat/entidades-base`) · **Regras:** [business-rules.md § Contatos e endereços](../business-rules.md)

## Regras em resumo

- **Dono exclusivo:** exatamente um entre `companyId` e `peopleId`. Nunca os
  dois, nunca nenhum.
- O dono é definido na criação e **não pode ser alterado**: enviar `companyId` ou
  `peopleId` no PATCH retorna 400.
- O dono precisa pertencer à empresa do usuário (empresa própria ou pessoa dela);
  caso contrário, 404.
- Um contato precisa de telefone e/ou e-mail, e uma edição não pode remover o
  último dos dois.
- Endereço pertence a uma cidade (base global do IBGE).
- Contatos e endereços de uma **pessoa excluída** somem junto com ela.

## Onde está

| Arquivo | Responsabilidade |
| ------- | ---------------- |
| `common/dto/owner.dto.ts` | Validação do dono exclusivo (`ExactlyOneOf`) |
| `common/authorization/owner-scope.ts` | Filtro do que a empresa enxerga |
| `modules/contact/contact.service.ts` | Escopo, dono e regra de telefone/e-mail |
| `modules/address/address.service.ts` | Escopo, dono e validação da cidade |
| `prisma/migrations/20260917134153_create_domain_entities` | CHECK `*_single_owner_check` |
| `prisma/migrations/20260917140435_update_domain_entities` | CHECK `contacts_phone_or_email_check` |

## Rotas

| Método | Rota |
| ------ | ---- |
| POST | `/contacts`, `/addresses` |
| GET | `/contacts`, `/addresses` (`?companyId`, `?peopleId`) |
| GET/PATCH/DELETE | `/contacts/:id`, `/addresses/:id` |

## Testes

`contact.service.spec.ts` (11), `address.service.spec.ts` (8),
`owner.dto.spec.ts` (7), `create-contact.dto.spec.ts` (4).

## O que olhar com atenção

- **A regra do dono está em três lugares** (DTO, service e CHECK no banco). É
  proposital — redundância defensiva —, mas mudar a regra exige mexer nos três.
- **Validação do DTO é intrincada:** o `OwnerDto` combina `@ValidateIf`,
  `ExactlyOneOf` e `IsUUID` para acusar tanto "nenhum dono" quanto "dois donos".
  Um POST sem dono retorna duas mensagens, sendo uma genérica
  (`companyId must be a UUID`).
- **A visibilidade cai em cascata, mas o dado permanece:** o contato de uma
  pessoa excluída continua na tabela, apenas deixa de ser retornado.
