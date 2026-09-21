# Resumo da implementação

Registro consolidado do trabalho feito entre 16/09/2026 e 18/09/2026: da preparação do template até o estado atual da API. As regras de negócio completas estão em `business-rules.md`. Este documento resume **o que foi feito, as decisões tomadas e as pendências**.

> Estado do repositório: há 4 commits (até a criação do `domain.md`). Todo o trabalho a partir das entidades de domínio **ainda não foi commitado**.

---

## 1. Visão geral do estado atual

- **Stack:** NestJS 11 + TypeScript (strict), Prisma **7.10.0** (versão exata) com `@prisma/adapter-pg`, PostgreSQL 16 (Docker), Vitest.
- **Banco local:** container `orari_db` (projeto compose `orari`), porta **5434**, banco `orari`, volume `orari_postgres_data`.
- **Autenticação:** JWT com guards globais (`JwtAuthGuard` + `RolesGuard`). Todas as rotas exigem token, exceto `GET /` e `POST /auth/login`.
- **Multiempresa:** cada usuário pertence a uma empresa, e os dados operacionais são isolados por empresa.
- **Qualidade:** 275 testes unitários passando, lint sem erros e nenhuma diferença entre o schema do Prisma e o banco (`prisma migrate diff`).

### Entidades

| Entidade | Exclusão | Observações |
|---|---|---|
| State | — (somente leitura, seed IBGE) | 27 estados |
| City | — (somente leitura, seed IBGE) | 5.571 cidades; busca por nome sem acento |
| Company | **Não é excluída**, é inativada (`isActive`) | CNPJ numérico ou alfanumérico com dígitos verificadores |
| User | Soft delete | Tipos `SUPER_ADMIN`, `ADMIN`, `USER` |
| People | Soft delete | CPF com dígitos verificadores; tipos `CLIENT`, `EMPLOYEE`, `PROFESSIONAL` |
| Contact | Soft delete | Dono exclusivo (empresa **ou** pessoa); telefone e/ou e-mail |
| Address | Soft delete | Dono exclusivo; pertence a uma cidade |
| Service | Soft delete | Nome único por empresa; duração em minutos; `isActive` |
| Appointment | **Sem exclusão** (controlado por `status`) | Fim calculado pela duração do serviço; sem conflito de horário |
| RecurringAppointment | **Sem exclusão** (`isActive`) | Período + dias da semana |
| RecurringDay | Exclusão física (substituída em bloco) | Dia da semana e horários (`time`) |
| PaymentMethod | Soft delete | Nome único por empresa |
| Payment | Soft delete | Um por agendamento; `paidAt` apenas quando `PAID`; valor herda o preço do serviço |
| BusinessHour | Soft delete | Janelas de atendimento por dia da semana |
| Notification | **Sem exclusão** (resolvida) | Aviso de horizonte da recorrência |

### Rotas

| Recurso | Rotas | Quem acessa |
|---|---|---|
| Auth | `POST /auth/login` | Público |
| States | `GET /states`, `GET /states/:id` | Autenticado |
| Cities | `GET /cities` (`?stateId`, `?name`), `GET /cities/:id` | Autenticado |
| Companies | `POST`, `GET` (`?isActive`), `GET /:id`, `PATCH /:id` | Escrita e filtro por status: SUPER_ADMIN. Leitura: demais tipos só a própria empresa |
| Users | `POST`, `GET` (`?companyId`), `GET /:id`, `PATCH /:id`, `PATCH /:id/password`, `DELETE /:id` | SUPER_ADMIN (qualquer empresa ativa) e ADMIN (própria empresa) |
| People | CRUD + `GET` (`?name`, `?document`, `?type`) | Qualquer tipo, só na própria empresa |
| Contacts | CRUD + `GET` (`?companyId`, `?peopleId`) | Qualquer tipo, só na própria empresa |
| Addresses | CRUD + `GET` (`?companyId`, `?peopleId`) | Qualquer tipo, só na própria empresa |
| Services | CRUD + `GET` (`?name`, `?isActive`) | Qualquer tipo, só na própria empresa |
| Appointments | `POST`, `GET` (`?status`, `?professionalId`, `?clientId`, `?from`, `?to`), `GET /:id`, `PATCH /:id` | Qualquer tipo, só na própria empresa |
| Recurring appointments | `POST`, `GET` (`?professionalId`, `?clientId`, `?isActive`), `GET /:id`, `PATCH /:id` | Qualquer tipo, só na própria empresa |
| Payment methods | CRUD + `GET` (`?name`) | Qualquer tipo, só na própria empresa |
| Payments | CRUD + `GET` (`?status`, `?appointmentId`, `?paymentMethodId`) | Qualquer tipo, só na própria empresa |
| Business hours | CRUD + `GET` (`?weekDay`) | Qualquer tipo, só na própria empresa |
| Notifications | `GET` (`?onlyUnread`, `?includeResolved`), `GET /:id`, `PATCH /:id/read` | Qualquer tipo, só na própria empresa |
| Recurring (extensão) | `POST /recurring-appointments/:id/extend` | Qualquer tipo, só na própria empresa |

Listagens são paginadas (`page`, `limit` ≤ 100, `total`, `items`). Os status HTTP seguem o `coding-standards.md` (201/200/204).

---

## 2. Linha do tempo

### 2.1 Preparação do template

- A cópia do template veio **sem os arquivos ocultos**. Foram restaurados `.gitignore` e `.env.example`, e criados `.env`, `.github/workflows/ci.yml` e `.claude/settings.json`.
- O clone `template-backend/` estava aninhado no projeto e quebrava `tsc`, lint e build. Foi movido para fora.
- Foi feito `git init` e o commit inicial.
- **Incidente com Docker:** o compose não tinha nome de projeto, então herdava o nome da pasta (`backend`). Esse nome coincide com o do projeto `alb_locacoes/backend`, e o `docker compose up` substituiu o container dele (os dois usavam o mesmo volume). O container do alb foi recriado **sem perda de dados** (10 tabelas intactas). A correção foi definir `name: orari` e `container_name: orari_db` no `docker-compose.yml`, na porta 5434.
- A migration inicial (`User`) foi criada.
- O script `start:prod` foi corrigido: o build gera `dist/src/main.js`, porque o client gerado fica fora de `src/`.
- O "erro de lint" no `schema.prisma` era um falso positivo da extensão do VSCode, fixada no language server do Prisma 6 (`prisma.pinToPrisma6`). A configuração global foi desativada; o schema estava correto para o Prisma 7.

### 2.2 Entidades de domínio (prompt `create-entity.md`)

- Foram criadas State, City, Company, People, Contact e Address, com o mesmo padrão: Module, Controller, Service e DTOs.
- **Dono exclusivo** em Contact e Address: validado no DTO (`OwnerDto` + `ExactlyOneOf`) e no banco (CHECK). O dono não pode ser alterado depois.
- As chaves estrangeiras usam `onDelete: Restrict`.
- Foi criado o seed de estados e cidades a partir de uma cópia versionada dos dados do IBGE (`prisma/seed-data/states-cities.json`). O seed pode ser executado várias vezes sem duplicar dados.
- Dependência adicionada: `@nestjs/mapped-types`, para os DTOs de atualização.

### 2.3 Revisão do domínio e entidade User

- Company ganhou `isActive`, e `foundationDate` passou a ser obrigatório. Em People, `birthDate` passou a ser obrigatório. Em Contact, `phone` e `email` passaram a ser opcionais, exigindo ao menos um (DTO + CHECK). `PeopleType` perdeu `USER` e `ADMIN`.
- User ganhou `name`, `type` e `companyId`, e perdeu `isActive`.
- CRUD de usuários: senha com bcrypt, nunca retornada (`omit`), e `passwordConfirmation` usado apenas na validação.
- O login recusa usuários excluídos e usuários de empresa inativa.
- O seed passou a criar a empresa inicial e o administrador a partir das variáveis `SEED_*`.

### 2.4 Primeira rodada de pendências

- Autorização com `@Roles()` + `RolesGuard`, e `@CurrentUser()` para obter o usuário autenticado.
- O `JwtStrategy` passou a **recarregar o usuário a cada requisição**. Com isso, o token deixa de valer na hora em que o usuário é excluído ou a empresa é inativada.
- Redefinição de senha pelo administrador: `PATCH /users/:id/password`.
- **Índices únicos parciais** (`WHERE "deletedAt" IS NULL`, recurso preview `partialIndexes`): valores de registros excluídos podem ser reutilizados.
- Criado o `business-rules.md`. `auth.md` e `database.md` foram atualizados.

### 2.5 Segunda rodada de pendências

- Novo tipo **SUPER_ADMIN**, que administra a plataforma: empresas e usuários de qualquer empresa ativa.
- **Isolamento por empresa** em People, Contacts e Addresses: a empresa vem do token, nunca do payload.
- Ninguém pode excluir a própria conta nem alterar o próprio tipo. O SUPER_ADMIN não pode inativar a própria empresa.
- **Empresas não são mais excluídas:** a coluna `deletedAt` foi removida, e os dados de uma empresa inativa ficam inacessíveis até ela ser reativada.
- Validação de **CPF** e de **CNPJ numérico e alfanumérico** (formato emitido desde jul/2026), com dígitos verificadores.
- Filtros novos: cidades por nome, pessoas por nome, CPF e tipo, contatos e endereços por dono, usuários por empresa e empresas por status.

### 2.6 Pendências restantes

- **Busca sem acento e indexada:** coluna `normalizedName` em City e People, preenchida pela aplicação (`normalizeForSearch()`), com índice **GIN trigram** (`pg_trgm`). O preenchimento inicial das cidades, feito com `unaccent` na migration, foi conferido contra a função da aplicação: 0 divergências em 5.571 cidades.
- `prisma`, `@prisma/client` e `@prisma/adapter-pg` foram **fixados em 7.10.0**. Antes, o CLI estava em 7.10.0 e o client em 7.9.1.

### 2.7 Agenda e pagamentos

- Criadas Service, Appointment, RecurringAppointment, RecurringDay, PaymentMethod e Payment. A RecurringDay não havia sido pedida, mas sem ela a recorrência não teria dias nem horários; foi implementada dentro do módulo de recorrência.
- Regras principais: tipos de pessoa validados (`CLIENT`/`PROFESSIONAL`), fim do agendamento calculado pela duração do serviço, bloqueio de sobreposição de horário para profissional e cliente, e um pagamento por agendamento.
- Horários da recorrência usam colunas `time`, mapeadas como `DateTime @db.Time(0)`; a API troca esses valores como `"HH:MM"`. O `domain.md` pedia `Unsupported("time")`, que deixaria os campos fora do Prisma Client.
- `domain.md` ajustado em três pontos: `nome` → `name` em Service, `NO SHOW` → `NO_SHOW` e a regra de tipo dos horários.

### 2.8 Agenda completa

- **Horário de funcionamento:** nova entidade `BusinessHour` (janelas por dia da semana, várias por dia). Agendamentos precisam caber em uma janela. Empresa sem janelas cadastradas não é restringida, para não travar quem ainda não configurou.
- **Recorrência gera agendamentos:** ao criar uma recorrência ativa, os agendamentos são gerados até a data final ou 90 dias à frente, dentro de uma transação — conflito em qualquer data desfaz tudo. Editar a recorrência cancela os futuros em `SCHEDULED` e regera, preservando o histórico.
- **Vínculo:** `Appointment.recurringAppointmentId` identifica o que veio de uma recorrência.
- **Valor do pagamento:** quando omitido, herda o preço do serviço do agendamento.

### 2.9 Fuso, notificações e demonstração

- **Fuso por empresa:** `Company.timezone` (padrão `America/Sao_Paulo`). Janelas de atendimento e horários de recorrência passam a valer no relógio da empresa; os instantes seguem gravados em UTC. Conversões em `common/time/time-zone.ts`, com `Intl` e sem dependência nova.
- **Datas puras pelo calendário:** o período da recorrência (`date`) não sofre conversão de fuso. Antes, em UTC-3, uma data final "2026-12-15" perdia o próprio dia 15.
- **Horizonte só cresce por ação manual:** quando faltam menos de 30 dias de agenda, a API cria uma notificação (`RECURRING_APPOINTMENT_HORIZON`), e a ampliação é feita por `POST /recurring-appointments/:id/extend`. A lista de notificações se sincroniza a cada consulta, sem rotina agendada.
- **Agendamento no passado bloqueado**, inclusive em remarcação. Editar status de um atendimento já realizado continua permitido.
- **Cadastro de demonstração:** `npm run seed:demo` cria uma empresa completa (usuários, pessoas, contatos, endereços, serviços, janelas, métodos de pagamento, um agendamento avulso, uma recorrência com os agendamentos gerados e pagamentos), usando os próprios services.

---

## 3. Arquitetura transversal (código compartilhado)

| Arquivo | Papel |
|---|---|
| `common/authorization/company-scope.ts` | `resolveCompanyScope()`: define em qual empresa o usuário pode agir (SUPER_ADMIN escolhe a empresa; os demais usam a própria, e pedir outra retorna 403) |
| `common/authorization/owner-scope.ts` | `ownedByCompany()`: filtro de contatos e endereços visíveis para uma empresa (os da própria empresa e os de suas pessoas não excluídas) |
| `common/decorators/` | `@Public()`, `@Roles()`, `@CurrentUser()` |
| `common/dto/` | Paginação, `OwnerDto` (dono exclusivo), filtro por dono |
| `common/validators/` | `ExactlyOneOf`, `AtLeastOneOf`, `Match`, `IsCpf`, `IsCnpj` |
| `common/text/normalize-for-search.ts` | Normalização usada na busca por nome |
| `common/time/time-of-day.ts` | Conversão entre `"HH:MM"` e as colunas `time` |
| `common/time/time-zone.ts` | Conversões entre o relógio da empresa e o instante UTC |
| `prisma/prisma-errors.ts` | Detecção de violação de unicidade (P2002 → 409) |
| `modules/auth/guards/roles.guard.ts` | Verificação de `@Roles()` (403) |

**Convenções de resposta**
- Registros fora do alcance do usuário respondem **404**, para não revelar que existem.
- Pedir explicitamente outra empresa, seja no filtro ou no payload, responde **403**.

**Exceção consciente ao `architecture.md`:** contatos, endereços e usuários são filtrados usando as relações `people` e `company` na própria consulta. É um JOIN só de leitura, e está comentado no código.

---

## 4. Banco de dados

### Migrations

| Migration | Conteúdo |
|---|---|
| `20260916190816_init` | Tabela `users` |
| `20260917134153_create_domain_entities` | Entidades de domínio, enums e CHECK de dono exclusivo |
| `20260917140435_update_domain_entities` | User completo, `isActive` em Company, campos obrigatórios e opcionais, CHECK de telefone/e-mail |
| `20260917164530_partial_unique_indexes` | Índices únicos parciais |
| `20260917170003_super_admin_and_company_inactivation` | `SUPER_ADMIN`, remoção de `companies.deletedAt`, CPF com `CHAR(11)` |
| `20260917171259_accent_insensitive_name_search` | `pg_trgm`, `normalizedName` e índices GIN (escrita à mão, em etapas) |
| `20260917185855_scheduling_and_payments` | Serviços, agendamentos, recorrências, métodos de pagamento e pagamentos |
| `20260917191312_business_hours_and_recurrence_link` | Janelas de atendimento e vínculo do agendamento com a recorrência |
| `20260917192848_company_timezone_and_notifications` | Fuso da empresa e entidade de notificações |

**Observação:** o `prisma migrate dev` exige terminal interativo quando há avisos. Nesses casos, as migrations foram geradas com `prisma migrate diff --from-config-datasource --to-schema ... --script` e aplicadas com `prisma migrate deploy`.

### Restrições fora do schema do Prisma

- `contacts_single_owner_check` e `addresses_single_owner_check`: dono exclusivo.
- `contacts_phone_or_email_check`: ao menos um meio de contato.
- Conflito de horário e "um pagamento por agendamento" (este último via índice único parcial).
- Extensão `pg_trgm`.

---

## 5. Como rodar

```bash
npm install
cp .env.example .env          # ajustar valores (inclusive SEED_*)
npm run db:up                 # Postgres em Docker (projeto "orari", porta 5434)
npx prisma migrate deploy     # aplica as migrations
npm run prisma:seed           # estados/cidades + empresa da plataforma + SUPER_ADMIN
npm run start:dev

npm run seed:demo             # opcional: cadastro completo de demonstração
```

**Variáveis do seed:**
- empresa: `SEED_COMPANY_CORPORATE_REASON`, `SEED_COMPANY_CNPJ`, `SEED_COMPANY_SUBDOMAIN`, `SEED_COMPANY_FOUNDATION_DATE`;
- SUPER_ADMIN: `SEED_SUPER_ADMIN_NAME`, `SEED_SUPER_ADMIN_EMAIL`, `SEED_SUPER_ADMIN_PASSWORD`.

Se alguma estiver ausente, o seed pula essa etapa. O seed **só cria o que falta** e nunca altera registros existentes.

**Ambiente de desenvolvimento**
- O usuário precisa estar no grupo `docker`.
- O `alb_locacoes_postgres` usa a porta 5433, e o Postgres nativo usa a 5432.

---

## 6. Verificações realizadas

- **A cada etapa:** `tsc --noEmit`, ESLint, Prettier, `vitest` (hoje 155 testes), `nest build` e `prisma migrate diff` sem diferenças.
- **Testes ponta a ponta contra a API real:**
  - login, permissões por tipo e isolamento entre empresas;
  - invalidação imediata de tokens e inativação/reativação de empresa;
  - unicidade parcial, CPF/CNPJ, filtros e busca sem acento.
  - Os dados de teste foram removidos ao final de cada rodada.
- **Consultas diretas ao banco:** CHECK constraints e uso do índice trigram (`EXPLAIN`).

---

## 7. Pendências e pontos de atenção

**Pendente**
- **Extensão do horizonte depende de alguém abrir as notificações:** a sincronização acontece na consulta a `/notifications`. Sem ninguém consultando, o aviso não é criado — foi a opção escolhida para não depender de rotina agendada.
- **Dados provisórios do seed:** empresa "Orari", CNPJ `11111111000191`, `admin@orari.local`. É preciso trocar pelos dados reais antes de usar em outro ambiente e, como o seed não altera registros, atualizar também os registros já existentes.
- **Commit:** todo o trabalho desde a criação das entidades ainda não foi commitado.

**Atenção**
- **Recurso preview `partialIndexes`:** ao atualizar o Prisma, revisar o changelog. As versões estão fixadas propositalmente.
- **Coluna `normalizedName`:** qualquer gravação de nome de pessoa ou cidade fora dos services ou do seed precisa preenchê-la.
- **Extensões:** outros ambientes precisam permitir `pg_trgm` (e `unaccent`, usada durante a migration).
- **Custo por requisição:** cada requisição autenticada faz 2 consultas extras (usuário e empresa), que são o preço da invalidação imediata de tokens.
- **Warning de lint:** há um warning antigo em `test/app.e2e-spec.ts`, fora do escopo do que foi feito.
- **Documentos de acompanhamento:** `progress.md` e `journal.md` não foram criados. O `CLAUDE.md` exige confirmação antes de atualizá-los.
