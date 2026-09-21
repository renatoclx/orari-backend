# Template Backend

Template base para APIs REST em **NestJS + Prisma + PostgreSQL**, pensado
para servir de ponto de partida para novos projetos.

## Stack

- [NestJS](https://nestjs.com) + TypeScript — arquitetura modular
  (Controller → Service → DTO), um módulo por entidade de domínio
- [Prisma ORM](https://www.prisma.io) + PostgreSQL (`@prisma/adapter-pg`)
- `class-validator` / `class-transformer` — validação e transformação de
  payload nos DTOs
- `@nestjs/config` — carregamento de variáveis de ambiente
- Docker Compose — banco de dados local

O template já inclui um módulo básico de autenticação JWT (`AuthModule` +
`UserModule`, ver `docs/auth.md`): `JwtAuthGuard` como guard global — toda
rota exige Bearer token por padrão, exceto as marcadas com `@Public()`
(hoje: `GET /` e `POST /auth/login`). Usuários são gerenciados em `/users`,
restrito a `SUPER_ADMIN` (plataforma) e `ADMIN` (própria empresa) — o
primeiro SUPER_ADMIN é criado pelo seed (`npm run prisma:seed`, variáveis
`SEED_*`). Os demais recursos são isolados por empresa. Regras de acesso em
`docs/business-rules.md`.

## Pré-requisitos

- Node.js 24+ (versão usada no CI)
- Docker (para o PostgreSQL local)

## Como rodar

```bash
npm install

cp .env.example .env
# ajuste as variáveis conforme necessário (ver tabela abaixo)

npm run db:up              # sobe o Postgres via Docker Compose
npx prisma generate        # gera o Prisma Client
npx prisma migrate dev     # aplica as migrations (quando houver models)
npm run prisma:seed        # estados/cidades (IBGE) + empresa e SUPER_ADMIN iniciais

npm run start:dev
```

API sobe em `http://localhost:3333` (ou a `PORT` configurada).

## Variáveis de ambiente (`.env`)

| Variável | Obrigatória | Descrição |
| --- | --- | --- |
| `PORT` | sim | Porta da API |
| `DATABASE_URL` | sim | Connection string do PostgreSQL |
| `JWT_SECRET` | sim | Segredo de assinatura do JWT |
| `JWT_EXPIRES_IN` | sim | Validade do access token (ex.: `1h`) |
| `CORS_ORIGIN` | não | Origens permitidas no CORS, separadas por vírgula. Sem valor, libera qualquer origem |
| `POSTGRES_USER` / `POSTGRES_PASSWORD` / `POSTGRES_DB` / `POSTGRES_PORT` | sim (Docker) | Credenciais do container do `docker-compose.yml` |
| `SEED_COMPANY_CORPORATE_REASON` / `SEED_COMPANY_CNPJ` / `SEED_COMPANY_SUBDOMAIN` / `SEED_COMPANY_FOUNDATION_DATE` | não | Empresa da plataforma criada pelo seed (CNPJ válido, sem máscara) |
| `SEED_SUPER_ADMIN_NAME` / `SEED_SUPER_ADMIN_EMAIL` / `SEED_SUPER_ADMIN_PASSWORD` | não | SUPER_ADMIN inicial criado pelo seed. Sem todas as `SEED_*`, o seed pula essa etapa |

Veja `.env.example` para os valores de referência.

## Scripts

| Comando | Descrição |
| --- | --- |
| `npm run start:dev` | Desenvolvimento, com watch |
| `npm run build` | Build de produção (`nest build`) |
| `npm run start:prod` | Sobe o build (`dist/src/main`) |
| `npm run lint` | ESLint + Prettier (`--fix`) |
| `npm run test` | Testes unitários (Vitest) — `src/**/*.spec.ts` |
| `npm run test:watch` | Testes unitários em modo watch |
| `npm run test:cov` | Testes unitários com relatório de cobertura |
| `npm run test:e2e` | Testes e2e (Vitest + Supertest) — `test/**/*.e2e-spec.ts`, requer banco no ar |
| `npm run db:up` / `db:down` | Sobe/derruba o Postgres local |
| `npm run prisma:generate` | Gera o Prisma Client |
| `npm run prisma:migrate:dev` | Nova migration a partir do schema |
| `npm run prisma:seed` | Popula estados e cidades (snapshot do IBGE) e cria a empresa da plataforma e o SUPER_ADMIN iniciais (idempotente) |
| `npm run seed:demo` | Cria um cadastro completo de demonstração (empresa, agenda, recorrência e pagamentos), usando os services (idempotente) |
| `npm run prisma:studio` | UI de inspeção do banco |

## CI

O workflow [`.github/workflows/ci.yml`](.github/workflows/ci.yml) roda a cada
push/PR nas branches `main`/`master`: instala as dependências e executa
lint, checagem de tipos, testes unitários e build. Os testes e2e (que
exigem banco) não fazem parte do CI ainda.

## Estrutura (`src/`)

```
src/
  app.module.ts
  app.controller.ts
  app.service.ts
  main.ts
  common/
    decorators/    # @Public() (isenta rota do JwtAuthGuard global)
  prisma/          # PrismaService (acesso ao banco centralizado)
  modules/
    auth/          # login + estratégia/guard JWT
    user/          # UserService mínimo (busca por e-mail para o login)
```

## Documentação

A pasta [`docs/`](docs/) é a fonte da verdade do projeto — a documentação
das regras de negócio precede o código, nunca o contrário.

- `architecture.md` — estrutura de módulos e responsabilidades das camadas
- `coding-standards.md` — convenções de código
- `database.md` — convenções de banco de dados (Prisma/PostgreSQL)
- `auth.md` — padrão de autenticação/autorização a seguir quando implementada

- `domain.md` — entidades, atributos e relacionamentos
- `business-rules.md` — regras de negócio do domínio
- `review/` — guias de revisão por funcionalidade: regra em resumo, onde está no
  código, testes e pontos de atenção (comece pelo
  [`review/README.md`](docs/review/README.md))
- `implementation-summary.md` — resumo do que foi implementado e pendências

Outros documentos (`decisions.md`, `technical-debt.md`, `progress.md`,
`journal.md`) podem ser adicionados conforme o projeto evoluir.
