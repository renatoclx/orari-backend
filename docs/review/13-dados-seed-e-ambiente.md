# 13 – Dados, seed e ambiente

Schema, migrations, cargas iniciais e como rodar o projeto.

**PRs:** 1 (`chore/ci-e-deps`), 2 (`feat/schema-e-migrations`) e 8 (`feat/notificacoes-e-demo`) · **Referência:** [database.md](../database.md)

## O que revisar aqui

- **Schema e migrations:** 9 migrations, aplicadas em ordem, sem diferença
  entre schema e banco (`prisma migrate diff` vazio).
- **Constraints escritas à mão** nas migrations, por não existirem no schema do
  Prisma:
  - `contacts_single_owner_check` e `addresses_single_owner_check` (dono exclusivo);
  - `contacts_phone_or_email_check` (ao menos um meio de contato).
- **Índices únicos parciais** (`WHERE "deletedAt" IS NULL`) em e-mail de usuário,
  CNPJ, subdomínio, documento da pessoa, nome de serviço, nome de método de
  pagamento e agendamento do pagamento.
- **Índices GIN trigram** (`pg_trgm`) nas colunas `normalizedName`.
- **Versões do Prisma fixadas** na mesma versão exata, porque o projeto usa o
  preview feature `partialIndexes`.

## Seeds

| Comando | O que faz |
| ------- | --------- |
| `npm run prisma:seed` | Estados e cidades (IBGE) e, com as variáveis `SEED_*`, a empresa da plataforma e o SUPER_ADMIN inicial |
| `npm run seed:demo` | Cadastro completo de demonstração |

O `seed:demo` (`src/scripts/seed-demo.ts`) sobe o contexto do Nest e cria os
dados **pelos próprios services**, respeitando as regras: empresa, usuário
ADMIN, 5 pessoas, contatos, endereços, 2 serviços, 11 janelas de atendimento,
métodos de pagamento, um agendamento avulso, uma recorrência (que gera ~25
agendamentos) e dois pagamentos. Ambos são idempotentes.

## Ambiente

```bash
npm install
cp .env.example .env
npm run db:up                 # Postgres em Docker (projeto "orari", porta 5434)
npx prisma migrate deploy
npm run prisma:seed
npm run start:dev
```

## O que olhar com atenção

- **Migrations geradas com `migrate diff` + `migrate deploy`:** o `migrate dev`
  exige terminal interativo quando há aviso (ex.: remoção de valor de enum).
- **Extensões do Postgres:** `pg_trgm` fica instalada; `unaccent` foi criada e
  removida dentro da migration, só para o preenchimento inicial. Outros
  ambientes precisam permitir a criação de extensões.
- **Dados provisórios no seed:** empresa "Orari", CNPJ `11111111000191` e
  `admin@orari.local` precisam ser trocados antes de outro ambiente.
- **`.env` não é versionado**; o `.env.example` lista todas as variáveis,
  inclusive as `SEED_*`.
