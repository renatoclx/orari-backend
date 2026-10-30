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

| Entidade             | Exclusão                                     | Observações                                                                                      |
| -------------------- | -------------------------------------------- | ------------------------------------------------------------------------------------------------ |
| State                | — (somente leitura, seed IBGE)               | 27 estados                                                                                       |
| City                 | — (somente leitura, seed IBGE)               | 5.571 cidades; busca por nome sem acento                                                         |
| Company              | **Não é excluída**, é inativada (`isActive`) | CNPJ numérico ou alfanumérico com dígitos verificadores                                          |
| User                 | Soft delete                                  | Tipos `SUPER_ADMIN`, `ADMIN`, `USER`; vínculo opcional com um profissional (`peopleId`)          |
| AnamnesisTemplate    | **Sem exclusão** (`isActive`, reativável)    | Nome único na empresa (sem acento/maiúsculas); versões e perguntas imutáveis                     |
| Anamnesis            | **Sem exclusão nem alteração**               | Ficha por cliente e modelo, presa à versão; registros imutáveis; respostas criptografadas        |
| AuditLog             | **Sem exclusão nem alteração** (só insere)   | Registro de ações sensíveis; consulta só pelo ADMIN                                              |
| People               | Soft delete                                  | CPF com dígitos verificadores; tipos `CLIENT`, `EMPLOYEE`, `PROFESSIONAL`                        |
| Contact              | Soft delete                                  | Dono exclusivo (empresa **ou** pessoa); telefone e/ou e-mail                                     |
| Address              | Soft delete                                  | Dono exclusivo; pertence a uma cidade                                                            |
| Service              | Soft delete                                  | Nome único por empresa; duração em minutos; `isActive`                                           |
| Appointment          | **Sem exclusão** (controlado por `status`)   | Fim calculado pela duração do serviço; sem conflito de horário                                   |
| RecurringAppointment | **Sem exclusão** (`isActive`)                | Período + dias da semana                                                                         |
| RecurringDay         | Exclusão física (substituída em bloco)       | Dia da semana e horários (`time`)                                                                |
| PaymentMethod        | Soft delete                                  | Nome único por empresa                                                                           |
| Plan                 | **Sem exclusão** (`isActive`, reativável)    | Nome único na empresa; itens e períodos com exclusão física, substituídos em bloco               |
| Payment              | Soft delete                                  | Um por agendamento; `paidAt` e método obrigatórios quando `PAID`; valor herda o preço do serviço |
| BusinessHour         | Soft delete                                  | Janelas de atendimento por dia da semana                                                         |
| Notification         | **Sem exclusão** (resolvida)                 | Sem tipos em uso (entidade mantida para o futuro)                                                |

### Rotas

| Recurso                       | Rotas                                                                                                                                                                                                                                               | Quem acessa                                                                          |
| ----------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------ |
| Auth                          | `POST /auth/login`                                                                                                                                                                                                                                  | Público                                                                              |
| Auth                          | `GET /auth/me`                                                                                                                                                                                                                                      | Qualquer usuário autenticado (o próprio perfil)                                      |
| States                        | `GET /states`, `GET /states/:id`                                                                                                                                                                                                                    | Autenticado                                                                          |
| Cities                        | `GET /cities` (`?stateId`, `?name`), `GET /cities/:id`                                                                                                                                                                                              | Autenticado                                                                          |
| Companies                     | `POST`, `GET` (`?isActive`), `GET /:id`, `PATCH /:id`                                                                                                                                                                                               | Escrita e filtro por status: SUPER_ADMIN. Leitura: demais tipos só a própria empresa |
| Companies (a própria empresa) | `PATCH /me` (nome fantasia), `POST`/`DELETE /me/logo`                                                                                                                                                                                               | ADMIN e SUPER_ADMIN, na empresa do token                                             |
| Users                         | `POST`, `GET` (`?companyId`), `GET /:id`, `PATCH /:id`, `PATCH /:id/password`, `DELETE /:id`                                                                                                                                                        | SUPER_ADMIN (qualquer empresa ativa) e ADMIN (própria empresa)                       |
| People                        | CRUD + `GET` (`?name`, `?document`, `?type`; inclui inativas), `PATCH /:id/restore`, `POST`/`DELETE /:id/photo`                                                                                                                                     | Qualquer tipo, só na própria empresa                                                 |
| Contacts                      | CRUD + `GET` (`?companyId`, `?peopleId`)                                                                                                                                                                                                            | Qualquer tipo, só na própria empresa                                                 |
| Addresses                     | CRUD + `GET` (`?companyId`, `?peopleId`)                                                                                                                                                                                                            | Qualquer tipo, só na própria empresa                                                 |
| Services                      | CRUD + `GET` (`?name`, `?isActive`)                                                                                                                                                                                                                 | Qualquer tipo, só na própria empresa                                                 |
| Appointments                  | `POST`, `GET` (`?status`, `?professionalId`, `?clientId`, `?from`, `?to`; com cliente, profissional e serviço), `GET /:id`, `PATCH /:id`                                                                                                            | Qualquer tipo, só na própria empresa                                                 |
| Recurring appointments        | `POST`, `GET` (`?professionalId`, `?clientId`, `?isActive`), `GET /:id`, `PATCH /:id` (só `note` e cancelamento), `POST /:id/payments/settle`, `PATCH /:id/appointments/:appointmentId/reschedule`, `PATCH /:id/appointments/:appointmentId/cancel` | Qualquer tipo, só na própria empresa                                                 |
| Payment methods               | CRUD + `GET` (`?name`)                                                                                                                                                                                                                              | Qualquer tipo, só na própria empresa                                                 |
| Plans                         | `POST`, `GET` (`?name`, `?isActive`), `GET /:id`, `PATCH /:id`                                                                                                                                                                                      | Qualquer tipo, só na própria empresa                                                 |
| Client plans                  | `POST`, `GET` (`?clientId`, `?planId`, `?status`), `GET /:id`, `PATCH /:id/cancel`                                                                                                                                                                  | Qualquer tipo, só na própria empresa                                                 |
| Payments                      | CRUD + `GET` (`?status`, `?appointmentId`, `?clientPlanId`, `?paymentMethodId`, `?clientId`, `?recurringAppointmentId`, `?overdue`, `?dueFrom`, `?dueTo`)                                                                                           | Qualquer tipo, só na própria empresa                                                 |
| Business hours                | CRUD + `GET` (`?weekDay`)                                                                                                                                                                                                                           | Qualquer tipo, só na própria empresa                                                 |
| Anamnesis templates           | `POST`, `GET` (`?name`, `?isActive`), `GET /:id`, `PATCH /:id` (`/anamnesis-templates`)                                                                                                                                                             | Escrita: ADMIN. Leitura: ADMIN e profissional vinculado, só na própria empresa       |
| Anamnesis                     | `POST /anamnesis`, `GET /anamnesis?clientId=`, `GET /anamnesis/:id`, `POST /anamnesis/:id/entries`                                                                                                                                                  | ADMIN e profissional vinculado, só na própria empresa                                |
| Audit logs                    | `GET /audit-logs` (`?clientId`, `?userId`, `?action`, `?from`, `?to`)                                                                                                                                                                               | Só ADMIN, na própria empresa                                                         |
| Notifications                 | `GET` (`?onlyUnread`, `?includeResolved`), `GET /:id`, `PATCH /:id/read`                                                                                                                                                                            | Qualquer tipo, só na própria empresa                                                 |

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
- **Recorrência com data final obrigatória (até 60 dias):** o horizonte de 90 dias, a extensão manual e o aviso de horizonte foram removidos. Recorrências criadas antes dessa regra podem não ter data final; elas continuam existindo e podem ser canceladas.

### 2.10 Pagamento da recorrência (Etapa 3)

- **Sem regeneração:** a edição aceita só `note` e `isActive: false`. Mudar o padrão é encerrar e criar outra recorrência; uma cancelada não é reativada.
- **Pagamento por agendamento:** a criação gera um pagamento `PENDING` por agendamento, na mesma transação, com o preço do serviço e vencimento no dia local do agendamento. Serviço sem preço é recusado.
- **Método na baixa:** `Payment.paymentMethodId` passou a ser opcional; é obrigatório quando o pagamento está `PAID`.
- **Pagamento integral:** `POST /recurring-appointments/:id/payments/settle` dá baixa em todos os `PENDING` da recorrência com o mesmo método.
- **Cancelamento:** cancela os agendamentos futuros em `SCHEDULED` ou `CONFIRMED` (ver 2.26) e, em seguida, os pagamentos `PENDING` deles. Pagamentos `PAID` não mudam.

### 2.11 Remanejamento (Etapa 4)

- **Rota dedicada:** `PATCH /recurring-appointments/:id/appointments/:appointmentId/reschedule` com `startAt`. Remarca o mesmo registro, então a quantidade de agendamentos e o pagamento ficam com ele.
- **Validações:** recorrência ativa; agendamento da própria recorrência; status `SCHEDULED` ou `CONFIRMED`; nova data (dia local) dentro do período; data futura, janela de atendimento e agenda livre, reaproveitadas do `AppointmentService`.
- **Vencimento:** o pagamento `PENDING` passa a vencer no novo dia, na mesma transação.
- **Cancelamento de um agendamento:** `PATCH /recurring-appointments/:id/appointments/:appointmentId/cancel` cancela o agendamento (`SCHEDULED` ou `CONFIRMED`) e o pagamento `PENDING` dele, na mesma transação.
- **PATCH comum bloqueado:** `PATCH /appointments/:id` recusa `startAt`, `serviceId`, `clientId`, `professionalId` e `status: CANCELLED` em agendamentos de recorrência.

### 2.12 Catálogo de planos (Etapa 5)

- **Entidades:** `Plan` (valor mensal próprio, `monthlyPrice`), `PlanItem` (serviço do plano; renomeado de `PlanService` para não colidir com a classe do NestJS) e `PlanPeriod` (meses e os dois percentuais de desconto).
- **Cadastro em um payload:** `POST /plans` recebe `services` (`serviceId` + `sessionsPerWeek`) e `periods`; no `PATCH`, cada lista informada substitui a anterior, como os dias da recorrência.
- **Validações:** ao menos um serviço, sem repetição, todos da empresa e ativos (reaproveita `ServiceService.findActive`); períodos com meses distintos e percentuais de 0 a 100; nome único (409).
- **Resposta:** os itens saem como `services` (`id`, `name`, `isActive`), sem expor a tabela intermediária.
- **Para a contratação (Etapa 6):** recusar plano inativo, sem períodos ou com serviço inativo.

### 2.13 Contratação de plano (Etapa 6)

- **6.1 — Empresa no pagamento:** `Payment.companyId` passou a existir e a ser obrigatório; a migração preenche os pagamentos existentes com a empresa do agendamento antes de tornar a coluna obrigatória. A restrição por empresa usa essa coluna, e não mais o agendamento, porque os pagamentos de plano não terão agendamento.
- **6.2 — Schema e cálculos:** `ClientPlan` (enum `PlanBillingType`), `Payment.clientPlanId` e `RecurringAppointment.clientPlanId` (ambos opcionais, `RESTRICT`). As contas ficam em `client-plan.calculations.ts`, funções puras com `Decimal`: total e pagamentos por modalidade (parcela arredondada antes do total), data final (véspera do mesmo dia N meses depois, ou último dia do mês quando o dia não existe) e vencimentos mês a mês (último dia do mês quando o dia não existe, sem deslocar os seguintes). O valor da parcela não é gravado: no mensal, é `totalAmount ÷ months`.
- **6.3 — Agenda do plano na recorrência:** a criação foi dividida em uma parte comum (`createSchedule`: grava a recorrência e os dias e gera os agendamentos na transação recebida) e dois caminhos. `create` (avulsa) mantém o preço obrigatório, o limite de 60 dias, a transação própria e o pagamento por agendamento. `createForClientPlan` usa a transação da contratação, grava o `clientPlanId` e não tem limite de 60 dias nem pagamento por agendamento. A recorrência de plano não pode ser encerrada pelo `PATCH` (só pelo cancelamento da contratação), e a resposta passou a incluir `clientPlanId`. Ver `technical-debt.md` sobre o tempo da transação em planos longos.
- **6.4 — Contratação:** `POST /client-plans` valida o plano (ativo, com o período escolhido e com todos os serviços ativos; inativo responde 409) e as agendas (exatamente os serviços do plano), resolve a data de início (hoje no fuso da empresa por padrão; futura aceita, passada recusada) e calcula valores, data final e vencimentos com `client-plan.calculations.ts`. Em uma transação de até 30 s grava a `ClientPlan`, cria uma recorrência por serviço (`createForClientPlan`, que também valida cliente e profissional) e gera os pagamentos (`PaymentService.createForClientPlan`: `PENDING`, sem método, sem agendamento). A resposta traz um resumo das agendas; os pagamentos ficam em `GET /payments?clientPlanId=`. Medido localmente: plano mensal de 12 meses com 2 serviços e 2 dias por semana (208 agendamentos) em cerca de 0,5 s.

### 2.14 Cancelamento da contratação (Etapa 7)

- **Sem multa e sem reembolso**, em qualquer modalidade (decisão de 2026-10-10; o efeito sobre o desconto do mensal ficou como pendência pós-MVP no roadmap).
- **`PATCH /client-plans/:id/cancel`:** grava `ClientPlan.cancelledAt`, encerra as recorrências do plano e cancela os agendamentos futuros em `SCHEDULED` ou `CONFIRMED` (`RecurringAppointmentService.endForClientPlan`, o único caminho para encerrar uma agenda de plano). No mensal, as parcelas `PENDING` com vencimento a partir de hoje (fuso da empresa) viram `CANCELLED`; as atrasadas continuam `PENDING`. No integral, o pagamento não muda. Tudo em uma transação.
- **Recusas (400):** contratação já cancelada ou com o período terminado.
- **`firstDueDate` obrigatório no mensal** (validação no DTO): sem vencimento, o cancelamento não teria como separar parcelas atrasadas das futuras. No integral continua opcional.

### 2.15 Cobrança dos avulsos concluídos (Etapa 8, codada em par)

- **Job de cobrança no módulo de pagamento** (`payment/jobs/completed-appointment-charge.job.ts`, a cada 5 minutos): busca os avulsos `COMPLETED` sem pagamento (`AppointmentService.findCompletedStandaloneWithoutPayment`) e cria um `PENDING` para cada um (`PaymentService.createForCompletedAppointments`). Fica no módulo de pagamento para não criar dependência circular, e cobre tanto a conclusão pelo job de status quanto a manual.
- **Regras:** valor = preço do serviço; vencimento = dia local do agendamento; serviço sem preço não gera pagamento; agendamento que já teve pagamento (inclusive excluído) não gera outro; recorrência e plano ficam de fora.
- **Idempotente:** quem já tem pagamento não volta na busca, e o `createMany` usa `skipDuplicates` para o caso de duas execuções simultâneas.
- **Atraso:** continua derivado (pendente com vencimento anterior a hoje); a exposição para o front fica na Etapa 9.

### 2.16 Filtros de pagamento e atraso (Etapa 9)

- **Novos filtros no `GET /payments`:** `clientId` (pagamentos do cliente vindos de agendamento ou de contratação, por relação), `recurringAppointmentId`, `overdue` (`true`/`false`) e `dueFrom`/`dueTo` (período de vencimento, pontas incluídas).
- **`isOverdue` em toda resposta de pagamento** (listagem, consulta, criação e edição): `PENDING` com vencimento anterior a hoje, no fuso da empresa. Vencer hoje não é atraso; sem vencimento nunca é atraso. Nada é gravado.
- **Ordem da listagem:** por vencimento (mais próximo primeiro, sem vencimento no fim) e, no empate, pela criação mais recente.
- O `PaymentModule` passou a importar o `CompanyModule`, para obter o fuso da empresa.

### 2.17 Seed e Swagger (Etapa 10)

- **`seed:demo`:** passa a criar o plano "Bem-estar" (Massagem e Fisioterapia, R$ 400, períodos de 3 e 6 meses) e uma contratação mensal de 3 meses, com uma agenda por serviço. O resumo conta os pagamentos pela empresa do próprio pagamento, incluindo os do plano. Validado do zero em um banco temporário (22 migrações, seed base e seed de demonstração).
- **Swagger com descrições:** o plugin do `@nestjs/swagger` usa `introspectComments`, e os comentários dos campos dos DTOs voltados a quem consome a API passaram para JSDoc (`/** ... */`), virando a descrição do campo em `/docs`. Notas internas (validadores, conversão de query string, normalização) continuam como `//` e não aparecem na documentação.

### 2.18 Perfil do usuário autenticado

- **`GET /auth/me`:** devolve o usuário do access token com a empresa (`id`, `name`, `timezone`, `logoUrl`), para o front montar a sessão. O nome da empresa é o fantasia ou, sem ele, a razão social. A consulta fica no `UserService.findProfile` (leitura da empresa por relação, sem a senha); usuário excluído depois do login responde 401.

### 2.19 Foto de pessoa

- **`People.photoUrl`** (opcional, migração `people_photo_url`): caminho público da foto, preenchido só pelo upload; não entra nos DTOs de criação e edição.
- **`POST /people/:id/photo`** (`multipart/form-data`, campo `photo`): JPEG ou PNG, até 2 MB (acima disso, 413). O formato é conferido pela assinatura do arquivo (`common/storage/image-type.ts`), não pela extensão. Uma nova foto substitui a anterior, que é apagada depois que o banco já aponta para a nova.
- **`DELETE /people/:id/photo`** (204): limpa o `photoUrl` e apaga o arquivo. A exclusão lógica da pessoa mantém a foto.
- **Armazenamento local:** `LocalFileStorage` (`common/storage`) grava em `UPLOADS_DIR` (padrão `uploads/`, fora do Git) com nome UUID e devolve `/uploads/<pasta>/<arquivo>`; a API serve a pasta em `/uploads`. Acesso público e armazenamento local estão em `technical-debt.md`.
- **Agendamento no passado bloqueado**, inclusive em remarcação. Editar status de um atendimento já realizado continua permitido.
- **Cadastro de demonstração:** `npm run seed:demo` cria uma empresa completa (usuários, pessoas, contatos, endereços, serviços, janelas, métodos de pagamento, um agendamento avulso, uma recorrência com os agendamentos gerados e pagamentos), usando os próprios services.

### 2.20 Pessoa com CPF e nascimento opcionais

- **`People.document` e `People.birthDate` opcionais** (migração `people_optional_document_birth_date`), para o futuro cadastro do cliente só com nome e telefone (o telefone é um contato). Vale para todos os tipos de pessoa; endereço já era opcional (entidade separada).
- O CPF continua validado e único na empresa quando informado; pessoas sem CPF não conflitam entre si.

### 2.21 Cadastro completo, observação e inativos (pedido do frontend)

- **`POST /people`** aceita, além dos campos de antes: `note` (até 1000 caracteres), `phone` (telefone principal), `contacts` e `addresses` (até 10 itens cada). Tudo é gravado por uma escrita aninhada do Prisma em uma transação: o telefone principal com `create` (`MAIN`, `isPrincipal: true`) e a lista de contatos com `createMany`, à parte; endereços com `createMany`. Não usa `ContactService`/`AddressService`, que dependem do `PeopleService`.
- **Validações dos itens reaproveitadas** com `OmitType` dos DTOs avulsos (sem `companyId`/`peopleId`); o padrão do telefone foi extraído para `PHONE_PATTERN` e é usado também em `phone`.
- **Principal:** só pela marca `isPrincipal`. Com `phone` informado, nenhum item de `contacts` pode ser principal (400); no máximo um contato e um endereço principais (400). Sem promoção automática.
- **Cidade inexistente:** 404 antes de gravar (`CityService.findOne`, uma vez por cidade distinta); a pessoa não é criada. O `PeopleModule` passou a importar o `CityModule`.
- **`PATCH /people/:id`** continua só com os campos da pessoa (`UpdatePeopleDto` omite `phone`, `contacts` e `addresses`) e passa a aceitar `note`.
- **`GET /people`** deixou de filtrar `deletedAt`: devolve ativas e inativas. Os demais consumidores (agendamentos, recorrências, contatos, endereços) usam `findOne`, que continua recusando inativas. Efeito no frontend: listas de seleção devem ignorar `deletedAt != null`, ou escolher uma inativa dá 404.
- **`PATCH /people/:id/restore`:** limpa `deletedAt`; 404 se não existe, 409 se já ativa, 409 se o CPF está em uso por outra ativa (índice único parcial do banco).

### 2.22 Exclusão de serviço só sem relacionamentos (pedido do frontend)

- **`DELETE /services/:id`** passa a recusar com 409 quando o serviço tem qualquer `Appointment`, `RecurringAppointment` ou `PlanItem`, sem filtrar status (cancelados e encerrados contam): "O serviço possui agendamentos, recorrências ou planos vinculados. Inative-o em vez de excluir." Sem relacionamentos, segue 204 com exclusão lógica; inexistente ou de outra empresa, 404. Inativar continua sendo `PATCH` com `isActive: false`.
- **Leitura por contagem de relações** (`_count`) no próprio `ServiceService`, sem depender dos services de agendamento, recorrência ou plano (que já dependem dele).
- **Plano excluído:** não existe (só `isActive`), e `PlanItem` é apagado fisicamente quando a composição do plano é editada; portanto todo `PlanItem` existente é vínculo real, de plano ativo ou inativo.
- **Janela de corrida:** a verificação e a exclusão não são atômicas; um agendamento criado entre as duas deixaria um serviço excluído com relacionamento. Como a exclusão é lógica e a chave estrangeira continua válida, o dado não se perde, e o efeito é só o serviço sumir da listagem.

### 2.23 Dados relacionados nas respostas de agendamento (pedido do frontend)

- **`GET /appointments`, `GET /appointments/:id`, `POST` e `PATCH`** devolvem o mesmo formato: os campos de antes (incluindo `clientId`, `professionalId` e `serviceId`, sem quebrar quem consome) mais `client` e `professional` (`id`, `name`, `photoUrl`) e `service` (`id`, `name`, `color`, `duration`). Só esses campos, por `include` com `select`.
- **Pessoa ou serviço excluídos:** a relação é lida pela chave estrangeira, sem filtrar `deletedAt`, e a exclusão é lógica; por isso o nome continua no histórico. Um teste contra o banco confirmou com pessoa e serviço excluídos.
- **`findDetail` novo** atende `GET /:id`; o `findOne` continua devolvendo o agendamento puro para pagamento e recorrência, que o usam em validações.
- **Listagem:** ordenada por `startAt` crescente, com `id` como desempate (sem ele, horários iguais podem trocar de lugar entre páginas e repetir ou perder registros). Para a agenda de um dia, `from`/`to` são instantes UTC: início do dia e início do dia seguinte no fuso da empresa (`timezone` vem de `GET /auth/me`); uma data sem hora vale meia-noite UTC.
- **Limite por página:** 100. Uma agenda de um dia com mais de 100 agendamentos exige paginar com `page` (a resposta traz `total`).
- **Fora do escopo, não alterado:** as rotas `.../reschedule` e `.../cancel` da recorrência continuam devolvendo o agendamento sem os dados relacionados.

### 2.24 Encaixe de agendamentos (overBooking)

- **`Appointment.overBooking`** (booleano, padrão `false`; migração `appointment_over_booking`): marca o agendamento avulso feito fora do horário de funcionamento, inclusive em dia fechado.
- **Autorização explícita:** `POST`/`PATCH /appointments` aceitam `overBooking`. Fora do funcionamento sem ele: 400 "O horário está fora do funcionamento da empresa. Para agendar mesmo assim, envie overBooking: true (encaixe)". O valor gravado é o real (`false` se o horário estiver dentro), calculado em `AppointmentService.resolveOverBooking`.
- **`BusinessHourService.isWithinBusinessHours`** responde se cabe na janela, sem recusar; o `ensureWithinBusinessHours` passou a usá-lo e continua recusando onde não há encaixe (geração e remanejamento de recorrência e plano).
- **PATCH:** o encaixe só é reavaliado quando horário ou serviço mudam; sem isso, o valor gravado se mantém e o `overBooking` enviado sozinho não muda nada.
- **Sem sobreposição:** a checagem de conflito de cliente e profissional continua valendo no encaixe.
- **Retrato do momento:** o valor não é recalculado se o horário de funcionamento mudar depois. Os jobs de status e de cobrança tratam o encaixe como qualquer avulso.

### 2.25 Recorrência sem limite de duração

- **Fim do limite de 60 dias** para a recorrência avulsa (pedido de cliente): a data final continua obrigatória e não pode vir antes da inicial, mas o prazo é livre (ex.: um ano); o controle fica com o front. Sem migração.
- **Remanejamento:** continua limitado ao período da própria recorrência; recorrências antigas sem data final passam a ter só o limite inicial (antes, 60 dias a partir do início).
- **Tempo de transação compartilhado:** `LONG_TRANSACTION_TIMEOUT_MS` (30 s) em `src/prisma/transaction-options.ts`, usado na criação da recorrência e na contratação de plano. O padrão global de 5 s foi mantido de propósito: uma transação ocupa uma conexão do pool, e um limite curto faz uma transação comum travada falhar cedo.
- **Consequência:** a recorrência longa gera todos os agendamentos e pagamentos `PENDING` na criação (ver `technical-debt.md`).

### 2.26 Cancelamento só antes de iniciar

- **`PATCH /appointments/:id` com `status: CANCELLED`** só passa para agendamento `SCHEDULED` ou `CONFIRMED` com `startAt` futuro (`AppointmentService.ensureCanBeCancelled`). O horário é conferido além do status por causa do intervalo de 5 minutos do job de status. Recusas (400): "Agendamento que já iniciou não pode ser cancelado" (em andamento, ou início agora ou no passado), "Agendamento concluído não pode ser cancelado", "Agendamento em que o cliente não compareceu não pode ser cancelado" e "O agendamento já está cancelado" (400, como o cancelamento de uma sessão pela recorrência e o da contratação).
- **Estado atual:** a regra olha o agendamento antes das outras mudanças do mesmo `PATCH`; um novo `startAt` não libera o cancelamento de quem já começou. Observação e demais status seguem livres; o agendamento de recorrência continua recusado no `PATCH` comum.
- **Pagamento junto:** cancelar um avulso cancela o pagamento `PENDING` dele na mesma transação (`PAID` não muda). Cobre os casos em que o avulso podia ficar cancelado com cobrança pendente: pagamento lançado à mão antes do atendimento e a ida e volta de status (`COMPLETED` → `SCHEDULED` → `CANCELLED`). O `AppointmentService` grava o pagamento direto pelo Prisma, como exceção à regra do módulo dono, porque não pode usar o `PaymentService` (dependência circular); é o mesmo recurso do cadastro completo de pessoas.
- **`POST /payments` recusa agendamento cancelado:** 409 "Agendamento cancelado não pode receber pagamento", antes de validar o método e de gravar. Os demais status seguem aceitos.
- **Fechado nesta mesma etapa:** o cancelamento de uma sessão pela rota da recorrência (`.../appointments/:id/cancel`) passou a usar a mesma regra do avulso (`ensureCanBeCancelled`), conferindo também o horário e usando as mesmas mensagens; e `CANCELLED` virou estado final do pagamento: `PATCH /payments` não o leva a outro status (409 "Pagamento cancelado não pode mudar de status"), embora repetir `CANCELLED` e editar outros campos continuem aceitos.
- **Também fechado:** o remanejamento de uma sessão da recorrência confere o horário, além do status (400 "Agendamento que já iniciou não pode ser remanejado"), e `CANCELLED` virou estado final do agendamento: o `PATCH` comum não o leva a outro status (400 "Agendamento cancelado não pode mudar de status", inclusive em agendamento de recorrência). Repetir `CANCELLED` cai na regra do cancelamento e a observação segue editável. Isso fecha o caminho de reabrir um agendamento cujo pagamento já foi cancelado.
- **Remarcar o avulso já iniciado é permitido de propósito** (decisão do produto: o cliente que atrasa uns 10 minutos precisa conseguir remarcar). Valem as regras atuais de data futura, horário, encaixe e conflito para o novo horário. A restrição de "só antes de iniciar" vale para cancelar e para remanejar sessão de recorrência.
- **Cancelamento em lote inclui `CONFIRMED`:** cancelar a recorrência (e, por consequência, a contratação do plano) cancela os futuros em `SCHEDULED` **ou** `CONFIRMED` (`cancelFutureFromRecurrence`), e os pagamentos `PENDING` deles. Antes, os confirmados ficavam ativos. Cancelar uma sessão ou a recorrência inteira seguem a mesma regra.
- **Reposição por falta, só em pacote:** o remanejamento (`.../appointments/:id/reschedule`) de uma sessão de **pacote** marcada `NO_SHOW` é aceito (a sessão já passou) e a devolve a `SCHEDULED` na nova data, mantendo as validações da nova data (futura, dentro do período, horário de funcionamento sem encaixe, sem conflito). A recorrência decide pelo `clientPlanId` e autoriza com `{ allowNoShow: true }` em `AppointmentService.rescheduleFromRecurrence`; recorrência avulsa continua só antes de iniciar. `COMPLETED`, `IN_PROGRESS` e `CANCELLED` seguem recusados. A falta é marcada à mão (`PATCH` com `status: NO_SHOW`; sem pagamento próprio, a sessão de pacote concluída pode ser marcada depois). O registro da falta se perde na reposição.
- **Concluído com pagamento não é mais alterado:** `PATCH /appointments/:id` em agendamento `COMPLETED` com pagamento `PENDING` ou `PAID` não excluído responde 400 "Agendamento concluído com pagamento não pode ser alterado", para qualquer campo (`ensureNotLockedByPayment`, que só consulta o pagamento quando o agendamento está concluído). Pagamento cancelado ou excluído libera a edição. Sessão de plano não tem pagamento próprio e não é travada.

### 2.27 Leitura de recorrências (pedido do frontend)

- **Dados relacionados na recorrência:** `GET /recurring-appointments`, `GET /:id`, `POST` e `PATCH` devolvem `client` e `professional` (`id`, `name`, `photoUrl`) e `service` (`id`, `name`, `color`, `duration`), com os ids planos mantidos e o `clientPlanId` já existente. O `include` único (`withDetails`, antes `withDays`) cobre as quatro rotas; a relação é lida pela chave, sem filtrar exclusão lógica, então pessoa e serviço excluídos mantêm o nome. Swagger com `RecurringAppointmentResponseDto`.
- **Origem do agendamento:** a resposta de agendamento ganhou `recurringAppointment: { id, clientPlanId } | null`. Escolhi o objeto aninhado, e não um `clientPlanId` solto no agendamento, por ser só uma relação a mais no `include` existente, sem código de montagem em quatro métodos.
- **Sessões de uma recorrência:** filtro `recurringAppointmentId` em `GET /appointments`, que reaproveita a ordenação, a paginação e os dados relacionados. A empresa continua no `where`: um id de outra empresa devolve lista vazia.
- **Conflito com data e horário:** o `createFromRecurrence` envolve a validação de cada ocorrência e prefixa o erro com `Conflito em dd/MM/aaaa às HH:mm:`, no fuso da empresa (`withOccurrence`). Mantém o tipo do erro (409 de conflito, 400 de horário de funcionamento); outros erros passam sem alteração. O parâmetro `occurrenceLabel` do `ensureSlotIsFree`, que citava a data em UTC no formato ISO, foi removido. O fuso passa a ser parâmetro do `createFromRecurrence` (antes da observação). Vale também para a contratação de plano.
- **Dry-run:** avaliado e adiado. Viável (rota de preview com a mesma validação, coletando todos os conflitos), custo de uma etapa pequena; vale se o front sentir falta com recorrências longas.

### 2.28 Configurações da empresa (pedido do frontend)

- **`PATCH /companies/me`** (ADMIN e SUPER_ADMIN): altera só o `fantasyName` da empresa do token (`UpdateOwnCompanyDto`; qualquer outro campo é recusado com 400). Espaços nas pontas são cortados; texto vazio, só espaços ou `null` removem o nome fantasia (o `/auth/me` volta a mostrar a razão social); até 100 caracteres; corpo `{}` responde 200 sem alterar nada. Os demais dados cadastrais seguem no `PATCH /companies/:id` do SUPER_ADMIN, sem mudança. O USER recebe 403.
- **`POST /companies/me/logo`** (multipart, campo `logo`) e **`DELETE /companies/me/logo`** (204): JPEG ou PNG, até 2 MB (acima disso, 413), formato conferido pelo conteúdo, servida em `/uploads/companies/<arquivo>`; `logoUrl` guarda o caminho relativo. Trocar ou remover apaga o arquivo anterior depois de o banco apontar para o novo, e só se ele estiver na pasta das logos (`removeStoredLogo`): uma URL externa ou o caminho de outra pasta, gravados pelo SUPER_ADMIN, nunca são apagados. O envio repete, de propósito, a lógica da foto de pessoa, sem extrair um helper compartilhado.
- **Rotas `me` antes das `:id` no controller:** o id é validado como UUID, e `me` cairia nele e responderia 400.
- **Leitura da própria empresa:** `GET /companies/:id` já permitia ao ADMIN e ao USER ler a própria empresa (outra empresa responde 404), então não foi criado `GET /companies/me`.
- **`/auth/me` sem mudança:** lê `fantasyName` e `logoUrl` do banco a cada chamada e reflete as duas alterações.
- **Seed:** `seed.ts` e `seed-demo.ts` não têm `logoUrl`; a URL de exemplo existia só na linha da Empresa Teste no banco local.
- Para um SUPER_ADMIN, "a própria empresa" é a empresa da plataforma.

---

## 3. Arquitetura transversal (código compartilhado)

| Arquivo                                 | Papel                                                                                                                                                    |
| --------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `common/authorization/company-scope.ts` | `resolveCompanyScope()`: define em qual empresa o usuário pode agir (SUPER_ADMIN escolhe a empresa; os demais usam a própria, e pedir outra retorna 403) |
| `common/authorization/owner-scope.ts`   | `ownedByCompany()`: filtro de contatos e endereços visíveis para uma empresa (os da própria empresa e os de suas pessoas não excluídas)                  |
| `common/decorators/`                    | `@Public()`, `@Roles()`, `@CurrentUser()`                                                                                                                |
| `common/dto/`                           | Paginação, `OwnerDto` (dono exclusivo), filtro por dono                                                                                                  |
| `common/validators/`                    | `ExactlyOneOf`, `AtLeastOneOf`, `Match`, `IsCpf`, `IsCpfOrCnpj`                                                                                          |
| `common/text/normalize-for-search.ts`   | Normalização usada na busca por nome                                                                                                                     |
| `common/time/time-of-day.ts`            | Conversão entre `"HH:MM"` e as colunas `time`                                                                                                            |
| `common/time/time-zone.ts`              | Conversões entre o relógio da empresa e o instante UTC                                                                                                   |
| `prisma/prisma-errors.ts`               | Detecção de violação de unicidade (P2002 → 409)                                                                                                          |
| `modules/auth/guards/roles.guard.ts`    | Verificação de `@Roles()` (403)                                                                                                                          |

**Convenções de resposta**

- Registros fora do alcance do usuário respondem **404**, para não revelar que existem.
- Pedir explicitamente outra empresa, seja no filtro ou no payload, responde **403**.

**Exceção consciente ao `architecture.md`:** contatos, endereços e usuários são filtrados usando as relações `people` e `company` na própria consulta. É um JOIN só de leitura, e está comentado no código.

---

## 4. Banco de dados

### Migrations

| Migration                                             | Conteúdo                                                                                        |
| ----------------------------------------------------- | ----------------------------------------------------------------------------------------------- |
| `20260916190816_init`                                 | Tabela `users`                                                                                  |
| `20260917134153_create_domain_entities`               | Entidades de domínio, enums e CHECK de dono exclusivo                                           |
| `20260917140435_update_domain_entities`               | User completo, `isActive` em Company, campos obrigatórios e opcionais, CHECK de telefone/e-mail |
| `20260917164530_partial_unique_indexes`               | Índices únicos parciais                                                                         |
| `20260917170003_super_admin_and_company_inactivation` | `SUPER_ADMIN`, remoção de `companies.deletedAt`, CPF com `CHAR(11)`                             |
| `20260917171259_accent_insensitive_name_search`       | `pg_trgm`, `normalizedName` e índices GIN (escrita à mão, em etapas)                            |
| `20260917185855_scheduling_and_payments`              | Serviços, agendamentos, recorrências, métodos de pagamento e pagamentos                         |
| `20260917191312_business_hours_and_recurrence_link`   | Janelas de atendimento e vínculo do agendamento com a recorrência                               |
| `20260917192848_company_timezone_and_notifications`   | Fuso da empresa e entidade de notificações                                                      |

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

- empresa: `SEED_COMPANY_CORPORATE_REASON`, `SEED_COMPANY_DOCUMENT`, `SEED_COMPANY_SUBDOMAIN`, `SEED_COMPANY_FOUNDATION_DATE`;
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

- **Dados provisórios do seed:** empresa "Orari", CNPJ `11111111000191`, `admin@orari.local`. É preciso trocar pelos dados reais antes de usar em outro ambiente e, como o seed não altera registros, atualizar também os registros já existentes.
- **Commit:** todo o trabalho desde a criação das entidades ainda não foi commitado.

**Atenção**

- **Recurso preview `partialIndexes`:** ao atualizar o Prisma, revisar o changelog. As versões estão fixadas propositalmente.
- **Coluna `normalizedName`:** qualquer gravação de nome de pessoa ou cidade fora dos services ou do seed precisa preenchê-la.
- **Extensões:** outros ambientes precisam permitir `pg_trgm` (e `unaccent`, usada durante a migration).
- **Custo por requisição:** cada requisição autenticada faz 2 consultas extras (usuário e empresa), que são o preço da invalidação imediata de tokens.
- **Warning de lint:** há um warning antigo em `test/app.e2e-spec.ts`, fora do escopo do que foi feito.
- **Documentos de acompanhamento:** `progress.md` (estado atual) e `journal.md` (decisões e motivos) foram criados em 2026-10-22. O `CLAUDE.md` continua exigindo confirmação antes de atualizá-los.

## 2.29 Contratações: dados relacionados e filtro de status

- Respostas de `/client-plans` incluem `client`, `plan` e, por recorrência, `service`, `professional`, `days` (HH:MM) e `isActive`, mantendo os ids planos.
- `GET /client-plans?status=active|cancelled|ended` ("hoje" no fuso da empresa); ordem por `createdAt` decrescente, com `id` como desempate.
- Swagger: `src/modules/client-plan/dto/client-plan-response.dto.ts`.

## 2.30 Frequência semanal dos serviços do plano

- `PlanItem.sessionsPerWeek` (1 a 7, migração `20261019120000_plan_item_sessions_per_week`, itens existentes ficam com 1). `serviceIds` foi removido de `POST`/`PATCH /plans`, que agora recebem `services: [{ serviceId, sessionsPerWeek }]`; a resposta devolve `sessionsPerWeek` em cada serviço.
- `POST /client-plans` exige que a agenda de cada serviço tenha exatamente `sessionsPerWeek` dias; a contratação não guarda a frequência, pois as recorrências já guardam os dias.

## 2.31 Comandas do dia e baixa por seleção

- `GET /payments/checkouts` (comandas do dia por cliente, paginadas por cliente, `search` pelo nome) e `PATCH /payments/settle` (baixa de pagamentos escolhidos do mesmo cliente, numa transação), declaradas antes de `:id`.
- Os clientes do dia e a página são resolvidos primeiro (nome ordenado no banco); os dados só são carregados para os clientes da página.
- **Reformulada (2.33):** a comanda parte das visitas do dia (atendimentos de hoje ou pagamento pago hoje), com `appointments`, `previousPayments` e totais por cliente.

## 2.32 Tela de Pagamentos: listagem, resumo e baixa

- `GET /payments` passa a trazer `client`, `paymentMethod`, `appointment.recurringAppointmentId` e `clientPlan.billingType`, sem mudar os campos atuais nem a ordem.
- `GET /payments/summary`: três `aggregate` numa transação (atrasado, a vencer, pago), sem carregar os pagamentos; declarada antes de `:id`.
- `paidAt` no futuro é recusado (400) em `PATCH /payments/settle` e na baixa em lote da recorrência.

## 2.33 Comandas a partir das visitas do dia

- `GET /payments/checkouts` passa a partir das visitas: o cliente tem comanda se tem atendimento hoje (`SCHEDULED`, `CONFIRMED`, `IN_PROGRESS` ou `COMPLETED`) ou pagamento `PAID` hoje. Os clientes saem de uma só consulta em `People` com filtro por relação, ordenada e paginada no banco.
- Resposta por cliente: `appointments` (com `payment` ou `null`), `previousPayments` e `todayPending`, `previousPending` e `paidToday`. `PATCH /payments/settle` não mudou.

## 2.34 Testes da camada HTTP

- `test/http-routes.e2e-spec.ts` (`npm run test:e2e`) sobe os controllers reais com guards, `JwtStrategy`, `@Roles`, `ValidationPipe` e limite de tentativas, com os services simulados e **sem banco**. Complementa os testes unitários dos services.
- Cobre: toda rota não pública recusa requisição sem token (401, descoberta pelos decoradores, então rota nova entra sozinha); token inválido, adulterado, de usuário excluído ou de empresa inativa; `@Roles` (USER recusado, perfis permitidos passam, lista fixa das rotas que devem ser restritas); rotas estáticas antes de `:id`; validação (UUID, campo desconhecido, empresa vinda do corpo, paginação); a empresa chegando ao service sempre a do token; erro 500 sem detalhe interno; e o 429 do login e do refresh.
- `test/support/http-app.ts` monta a aplicação e descobre as rotas.

## 2.35 Correções da revisão de código

- **Início da recorrência e da contratação:** a geração de agendamentos começa no maior dia entre o início contratado e hoje, comparados como dias de calendário no fuso da empresa; à noite não começa mais no dia anterior ao contratado.
- **Concorrência:** o cancelamento da contratação só altera a linha se ela ainda não estiver cancelada, e o cancelamento do agendamento só vale se o status lido ainda for o atual (senão 409).
- **Listagem de recorrências:** desempate por `id`, para a paginação ser estável.
- **Comandas:** os dados são agrupados uma vez por cliente, em vez de filtrar as listas inteiras a cada cliente.
- `POST /payments` também recusa `paidAt` no futuro.

## 2.36 Configuração de produção

- `src/config/env.validation.ts`: a API valida as variáveis na subida e se recusa a iniciar listando o que está errado. Em `NODE_ENV=production` exige `JWT_SECRET` forte (32+ caracteres, diferente do exemplo) e `CORS_ORIGIN`.
- `src/app.setup.ts` (extraído do `main.ts` para ser testável): `helmet` (com `Cross-Origin-Resource-Policy: cross-origin` para as fotos de `/uploads`), CORS por lista, `ValidationPipe` global, `trust proxy` por `TRUST_PROXY` e Swagger desligado em produção (`SWAGGER_ENABLED` força).
- Variáveis novas: `NODE_ENV`, `TRUST_PROXY`, `SWAGGER_ENABLED` (ver `.env.example` e `README.md`).

## 2.37 Documento da empresa: CPF ou CNPJ

- O campo `cnpj` de `Company` virou `document` e aceita CPF (11 dígitos) ou CNPJ (14 caracteres, numérico ou alfanumérico), validado por `IsCpfOrCnpj`. A `foundationDate` passou a ser opcional.
- Migração `20261023120000_company_document`: renomeia a coluna (e o índice único), troca `CHAR(14)` por `VARCHAR(14)` (o `CHAR` completaria um CPF com espaços) e remove o `NOT NULL` da data. Os dados existentes são preservados.
- Seed: `SEED_COMPANY_CNPJ` virou `SEED_COMPANY_DOCUMENT`, e `SEED_COMPANY_FOUNDATION_DATE` passou a ser opcional (não conta como variável ausente).
- Mudança de contrato: o corpo de `POST`/`PATCH /companies` e a resposta usam `document` no lugar de `cnpj`.

## 2.38 Anamnese, etapa 2: vínculo, permissão e auditoria

- **Vínculo usuário × profissional:** `users.peopleId` opcional, com índice único parcial (um profissional por usuário ativo). `POST`/`PATCH /users` aceitam `peopleId` (`null` desfaz). O `UserService` confere que a pessoa é um profissional ativo da empresa do usuário (400) e não está ligada a outro usuário ativo (409); a reativação de um usuário também pode dar 409 pelo mesmo índice.
- **`/auth/me`:** devolve `professional` (`{ id, name }` ou `null`; profissional inativo conta como `null`).
- **Permissão:** `AnamnesisAccessService` (módulo `anamnesis`): ADMIN, ou usuário vinculado a um profissional ativo da empresa. `ensureAccess` recusa com 403. Ainda não é usado por nenhuma rota; as próximas etapas o chamam.
- **Auditoria:** tabela `audit_logs` e módulo global `audit`. `AuditService.record` aceita o cliente da transação, para gravar junto com a operação (a falha da auditoria desfaz a operação). Por ora só a ação `USER_LINK_CHANGED`, gravada ao criar com vínculo ou alterar/desfazer o vínculo; o alvo é o usuário alterado e o registro fica na empresa dele. `GET /audit-logs` é só leitura, paginado do mais recente ao mais antigo, só para o ADMIN (o SUPER_ADMIN recebe 403).
- Migration `20261027120000_anamnese_user_link_audit_log`.

## 2.39 Anamnese, etapa 3: modelos de ficha

- **Tabelas:** `anamnesis_templates` (nome único por empresa em `normalizedName`), `anamnesis_template_versions` (`(templateId, version)` único) e `anamnesis_questions` (`(versionId, position)` único; `options` em `text[]`). Migration `20261027140000_anamnesis_templates`, que também acrescenta `ANAMNESIS_TEMPLATE_CREATED` e `ANAMNESIS_TEMPLATE_UPDATED` ao enum de auditoria.
- **Rotas:** `POST`, `GET`, `GET /:id` e `PATCH /:id` em `/anamnesis-templates`. Criar e editar: `@Roles(ADMIN)`. Ler: o `AnamnesisAccessService.ensureAccess` no service (ADMIN ou profissional vinculado ativo; 403 nos demais, inclusive SUPER_ADMIN).
- **Resposta:** o modelo com `currentVersion` (`id`, `version`, `createdAt`, `questions`). Não há rota para versões antigas: a ficha (próxima etapa) devolverá as perguntas da versão dela.
- **Versões:** `questions` no PATCH cria a versão seguinte (vigente + 1), mesmo que a lista seja igual à anterior; renomear, alterar a descrição e inativar não criam versão. Duas edições simultâneas: uma recebe 409.
- **Perguntas:** a posição vem da ordem da lista. `validateQuestions` (`anamnesis-question-rules.ts`) aplica as regras que dependem do tipo (opções, repetição ignorando acento e maiúsculas, detalhe só em sim ou não) e indica a pergunta pelo número. O DTO limita 1 a 100 perguntas, texto até 400, ajuda até 500 e opção até 100 caracteres.
- **Auditoria:** criação e edição de modelo são gravadas na mesma transação (`entityType` `ANAMNESIS_TEMPLATE`).

## 2.40 Anamnese, etapa 4: fichas, acompanhamentos e criptografia

- **Criptografia:** `AnamnesisCryptoService` (AES-256-GCM, IV novo a cada gravação, formato `v1:<base64 de iv+tag+cifrado>`). A chave é `ANAMNESIS_ENCRYPTION_KEY` (32 bytes em base64), **obrigatória em todo ambiente**: o `validateEnv` recusa a subida sem ela ou malformada. Valor adulterado ou chave errada falham na leitura. Passo a passo da chave em `deploy.md` (5.1).
- **Tabelas:** `anamneses` (única por `(clientId, templateId)`), `anamnesis_entries` e `anamnesis_answers` (única por `(entryId, questionId)`). Migration `20261027160000_anamnesis_records`, que também acrescenta `ANAMNESIS_VIEWED`, `ANAMNESIS_LISTED` e `ANAMNESIS_ENTRY_CREATED` à auditoria.
- **Rotas:** `POST /anamnesis` (ficha + registro inicial), `GET /anamnesis?clientId=` (resumos), `GET /anamnesis/:id` (ficha completa) e `POST /anamnesis/:id/entries` (acompanhamento). Sem PATCH nem DELETE. O acesso é conferido no service (`ensureAccess`).
- **Ficha completa:** `version` (com as perguntas da versão da ficha), `current` (resposta mais recente de cada pergunta) e `entries` (histórico por data da consulta e, no mesmo dia, de gravação), tudo decifrado só na montagem da resposta.
- **Respostas** (`anamnesis-answer-rules.ts`): texto até 5.000 caracteres; sim ou não como `{ answer, detail? }` (detalhe só se a pergunta o prevê e a resposta é "sim"); escolha única (texto), múltipla (lista sem repetição), número, data `AAAA-MM-DD` válida e escala inteira de 0 a 10. Guardadas como JSON cifrado.
- **Regras:** obrigatórias só no registro inicial; acompanhamento com evolução (até 10.000) e só as respostas alteradas; data da consulta padrão hoje no fuso da empresa, não futura nem anterior ao registro inicial; agendamento do mesmo cliente; cliente inativo não recebe registros, mas a ficha continua legível; o autor guarda o usuário e o profissional vinculado.
- **Auditoria:** gravada na mesma transação ao criar (`ENTRY_CREATED`) e antes de devolver os dados nas leituras (`VIEWED`, `LISTED`): se a auditoria falhar, nada é entregue.
- **Para o frontend:** `AnamnesisAccessService.findProfessionalId` alimenta o autor; a resposta do `/auth/me` (`professional`) define o menu.

## 2.41 Anamnese, etapa 5: PDF da ficha

- **Rota:** `GET /anamnesis/:id/pdf?includeHistory=true|false` (padrão: `true`). Mesmo acesso da leitura da ficha (ADMIN ou profissional vinculado; outra empresa, 404). Responde `application/pdf` `inline`, com `Cache-Control: no-store` e nome genérico (`ficha-anamnese-AAAA-MM-DD.pdf`, sem dado pessoal).
- **Biblioteca:** `pdfmake` 0.3.13 (Node puro, sem navegador; traz a fonte Roboto) e `@types/pdfmake`. As políticas de acesso do pdfmake bloqueiam download de recursos e leitura de arquivos, exceto as fontes. A imagem Docker não muda.
- **Estrutura:** `anamnesis-pdf-format.ts` (máscaras, idade, respostas em texto), `anamnesis-pdf-document.ts` (função pura que monta o documento) e `anamnesis-pdf.service.ts` (busca clínica e cliente, gera o arquivo e audita).
- **Conteúdo:** a ficha mostra as respostas do **registro inicial** e a assinatura só do cliente; o histórico vai em página própria, sem assinatura. Cliente com nome, idade (no fuso da empresa), CPF, telefone e endereço principais; clínica com nome, CPF/CNPJ, contato e endereço. Rodapé com emissão no fuso da empresa e paginação.
- **Auditoria:** `ANAMNESIS_PDF_GENERATED` (migration `20261027180000_anamnesis_pdf_audit`), gravada antes da entrega. `AnamnesisService.getView` monta a ficha com o controle de acesso e sem auditar, para que o PDF não registre também uma leitura.
- **Logomarca:** no cabeçalho de todas as páginas, em caixa de 120×30 (mantém a proporção). Só é lida se o `logoUrl` está na pasta de logos (`/uploads/companies/`); o formato é conferido pelo conteúdo (`detectImageExtension`: PNG ou JPEG) e vai ao pdfmake como data URL. Qualquer problema (sem logo, URL externa, arquivo ausente ou de outro formato) gera o PDF sem logo, nunca erro. Para isso o `LocalFileStorage` ganhou `read` (com a mesma proteção contra caminhos fora de `uploads` do `remove`): continua sendo o único ponto a trocar quando as imagens forem para a nuvem.

## 2.42 Vínculo do usuário com funcionário

- **`users.peopleId`** passa a aceitar também uma pessoa `EMPLOYEE` ativa da empresa (antes, só `PROFESSIONAL`). Sem migration: o campo e o índice único parcial já serviam. A mensagem do 400 e a do 409 falam em "pessoa".
- **`/auth/me`:** `professional` só vale para `PROFESSIONAL`; novo `person` (`{ id, name, type, profession }`) traz a pessoa vinculada ativa, profissional ou funcionário.
- **`GET /users`:** cada usuário traz `people: { type, profession } | null`, para a tela mostrar a "Função" sem outra chamada.
- **Permissão da anamnese:** inalterada (`AnamnesisAccessService` continua exigindo `PROFESSIONAL`): o funcionário não acessa fichas.

## 2.43 Auditoria de quem recebe acesso à anamnese

- **Motivo:** o acesso às fichas vem do vínculo com profissional **ou** do tipo ADMIN, mas só o vínculo era auditado. Promover alguém a ADMIN, criar um ADMIN (inclusive o SUPER_ADMIN, em qualquer empresa) ou reativar um usuário com acesso não deixava rastro.
- **Ações novas** (migration `20261027200000_user_type_audit`): `USER_TYPE_CHANGED` (criação com tipo ADMIN e toda mudança de tipo no `PATCH /users/:id`) e `USER_RESTORED` (reativação de usuário ADMIN ou com pessoa vinculada).
- **Como:** mesmo molde do `USER_LINK_CHANGED`, agora num método único (`recordUserChange`), na mesma transação da alteração e na empresa do usuário alterado. O `restore` passou a usar transação interativa (o `revokeSessions` aceita o `tx`) e recebe o IP no controller.
- **Fora do escopo:** guardar o tipo anterior e o novo (exigiria um campo de detalhes no `AuditLog`).

## 2.44 Filtro por nome na listagem de usuários

- **`GET /users?name=`:** busca parcial pelo nome, sem diferenciar maiúsculas (acentos contam: "joao" não acha "João"). O termo é aparado e o filtro vem **somado** à visibilidade de quem consulta (o ADMIN continua sem ver SUPER_ADMINs nem outras empresas). Sem `name`, nada muda.
- **Como:** `name` opcional e não vazio no `FindUsersQueryDto`; `UserService.findAll` usa `contains` com `mode: "insensitive"`. Sem migration.
- **Fora do escopo:** busca sem acento (exigiria uma coluna `normalizedName` em `User`, como a de pessoas, com migration e preenchimento dos existentes).

## 2.45 Falta (NO_SHOW) não cobra

- **Motivo:** o `NO_SHOW` existia como status, mas não havia como usá-lo no dia a dia: o job de status conclui todo atendimento ao fim do horário e o de cobrança gera o pagamento em até 5 minutos, e o concluído com pagamento é travado. A falta só podia ser anotada até uns 5 minutos depois do fim do atendimento, e deixava o pagamento pendente.
- **Regra (decidida com o dono do produto):** a falta **não cobra** e é **definitiva**. Marcar a falta (`PATCH /appointments/:id`, `status: NO_SHOW`) cancela o pagamento `PENDING` na mesma transação, vale também para o concluído, e é recusada se o atendimento ainda não iniciou ou se o pagamento já foi recebido (`PAID`, sem reembolso). Só o status e a observação mudam na mesma requisição. Detalhes em `business-rules.md` (Agendamentos > Falta).
- **Como:** `AppointmentService.update` ganhou o caminho `marksNoShow`: `ensureCanBeMarkedNoShow` no lugar de `ensureNotLockedByPayment`, e a mesma transação do cancelamento (cancela o pagamento pendente), com o filtro de status em `NO_SHOW_FROM_STATUSES` (se o agendamento mudar no meio, 409). `ensureNotReopened` passou a valer também para a falta (estado final); pedir o cancelamento de quem faltou continua respondendo pela regra do cancelamento. Sem migration; os dois jobs não mudam.
- **Verificado:** 23 testes novos no `appointment.service.spec.ts` e conferência numa segunda instância do backend, contra o banco local (futuro recusado, pago recusado, concluído com pendente vira falta e o pagamento fica `CANCELLED`, falta não volta nem cancela).
- **Pagamento na resposta:** `payment: { status, deletedAt } | null` passou a vir em toda resposta de agendamento (`withRelations`), para a tela esconder "Marcar falta" no atendimento já pago (a API continua recusando, 400). Do pagamento só a situação: nada de valor ou método.
- **Fora do escopo:** o botão "Marcar falta" e a reposição de sessão no frontend (próxima etapa); desfazer a falta; cobrar a falta (multa) por empresa ou serviço.

## 2.46 Turmas, etapa 1: serviço que aceita turma e cadastro de turmas fixas

- **Desenho:** `docs/turmas.md` (um agendamento por aluno; a turma agrupa os agendamentos por sessão). Esta etapa cobre só o cadastro das turmas fixas; sessões e encaixes vêm nas próximas.
- **Banco** (migration `20261029120000_class_groups`): `services.allowsClasses` (padrão `false`), `class_groups` (nome opcional com `normalizedName` e índice GIN trigram, serviço, profissional, vagas, `isActive`) e `class_group_days` (dia da semana e início; o fim vem da duração do serviço).
- **Serviço:** aceita `allowsClasses`; desmarcar com turma ativa responde 409; a exclusão passa a contar as turmas como relacionamento.
- **Módulo `class-group`** (`/class-groups`, só ADMIN): criação, listagem (mais recente primeiro; filtros nome, `isActive`, serviço, profissional, `from`/`to` de cadastro em dias inteiros no fuso da empresa), consulta e edição de nome, vagas e situação. Validações: serviço ativo que aceita turma, profissional `PROFESSIONAL`, vagas de 2 a 100, 1 a 21 horários sem sobreposição no mesmo dia, cada horário dentro do funcionamento e sem sobrepor outra turma ativa do mesmo profissional. A reativação repete essas conferências.
- **Funcionamento:** `BusinessHourService.isWeeklySlotWithinBusinessHours` confere um horário semanal sem data; `isWithinBusinessHours` passou a usar a mesma conferência por dentro, sem mudar o comportamento.

## 2.47 Turmas, etapa 2: sessões, encaixe avulso e agendamento que vira turma

- **Banco** (migration `20261029140000_class_sessions`): `class_sessions` (turma opcional, serviço, profissional, início e fim, vagas, `overBooking`, `cancelledAt` para a etapa 4; índice único parcial `(classGroupId, startAt)` nas sessões de turma fixa) e `appointments.classSessionId`.
- **Rotas (só ADMIN):** `POST /class-groups/:id/participants` (encaixe na turma fixa: o horário escolhe a sessão, criada no primeiro encaixe), `POST /class-sessions` (agendamento que vira turma), `GET /class-sessions/:id` (vagas e alunos), `PATCH /class-sessions/:id` (vagas) e `POST /class-sessions/:id/participants` (encaixe numa sessão existente).
- **Vagas com trava:** `ClassSessionService` trava a linha da sessão (`SELECT ... FOR UPDATE`) antes de contar os alunos; a sessão da turma fixa é criada com `INSERT ... ON CONFLICT DO NOTHING` na mesma transação. Primeiro SQL cru do projeto (convenção registrada no `database.md`). Verificado com duas inclusões simultâneas na última vaga: uma passa, a outra recebe 409.
- **AppointmentService:** a resposta traz `classSession`; `ensureSlotIsFree` ignora, para o profissional, os colegas da mesma sessão (inclusive no `PATCH` de observação, que também confere a agenda); `createInClassSession` e `attachToClassSession` (este barra duas conversões simultâneas) mantêm as regras de agenda no módulo de agendamentos, sem depender do de turmas; agendamento de turma não muda horário, serviço, cliente nem profissional pela edição comum.
- **Turma fixa:** mudar as vagas aplica às sessões futuras (travadas) e é recusado se alguma já tiver mais alunos.

## 2.48 Turmas, etapa 3: recorrência e plano encaixados em turma

- **Banco** (migration `20261029160000_recurring_class_group`): `recurring_appointments.classGroupId`.
- **Entrada:** `classGroupId` opcional em `POST /recurring-appointments` e em cada item de `schedules` de `POST /client-plans`. Serviço e profissional continuam no payload e precisam ser os da turma; os dias precisam ser horários dela (`ClassSessionService.ensureRecurrenceFitsClassGroup`).
- **Geração:** `createSchedule` passa as ocorrências por `ClassSessionService.reserveForOccurrences` (sessão criada se faltar, travada e com a vaga conferida, na transação da recorrência/contratação); `createFromRecurrence` grava a sessão em cada agendamento e confere a agenda sem os colegas. O `RecurringAppointmentModule` importa o `ClassGroupModule` (sem ciclo: este só depende do `AppointmentModule`).
- **Remanejamento** (decisão A de `turmas.md`): `rescheduleFromRecurrence` limpa o `classSessionId`; o atendimento vai individual para o novo horário e a vaga fica livre.
- **Respostas:** recorrência e contratação trazem `classGroupId`.

## 2.49 Turmas, etapa 4: cancelamento da sessão, saída da turma e reposição

- **Banco** (migration `20261029180000_class_cancellations`): enum `AppointmentCancelReason` (`CLASS_SESSION_CANCELLED`, `CLASS_LEFT`) e `appointments.cancelReason`; `class_sessions.cancellationNote`; `recurring_appointments.classLeftAt` e `classLeaveNote`.
- **Motivo do cancelamento:** só os cancelamentos feitos pela clínica na turma gravam `cancelReason`; é ele que separa a aula que pode ser reposta da cancelada pelo cliente.
- **`PATCH /class-sessions/:id/cancel`** (ADMIN): `ClassSessionService.cancel` trava a sessão, grava o cancelamento e chama `AppointmentService.cancelForClassSession` e `PaymentService.cancelPendingForClassSession` na mesma transação. O `ClassGroupModule` passa a importar o `PaymentModule` (sem ciclo).
- **`PATCH /recurring-appointments/:id/leave-class`** (ADMIN): `RecurringAppointmentService.leaveClassGroup` grava a saída com o filtro `classLeftAt: null` (duas saídas simultâneas: 409), chama `AppointmentService.cancelFutureFromClassGroup` (só as aulas nas sessões da turma) e, na avulsa, encerra a recorrência e cancela o restante; depois, `cancelPendingForRecurrence`.
- **Reposição:** `rescheduleFromRecurrence` troca a opção `allowNoShow` por `allowReplacement` (falta ou `cancelReason` preenchido) e aceita `classSession` (sessão de destino: grava a sessão e o profissional dela, e confere a agenda sem os colegas).
- **`PATCH /recurring-appointments/:id/appointments/:appointmentId/replace-in-class`** (ADMIN): `ClassSessionService.resolveClassGroupSlot` (turma, serviço, horário e funcionamento, fora da transação) e `reserveSeat` (trava e vaga, dentro); depois o remanejamento e `moveDueDate`, na mesma transação. A conferência de vaga do encaixe foi extraída para `ensureHasSeatFor`, usada pelos dois.
- **Respostas e Swagger:** o agendamento documenta `classSessionId` e `cancelReason`; a recorrência, `classGroupId`, `classLeftAt` e `classLeaveNote`; a sessão traz `cancellationNote`.

## 2.50 Turmas, etapa 5: agenda por sessão

- **`GET /class-sessions`** (ADMIN; `FindClassSessionsQueryDto` com `from` e `to` obrigatórios e filtros de profissional, serviço e turma): `ClassSessionService.findAll` valida o período (até 31 dias, `CLASS_SESSIONS_RANGE_MAX_DAYS`) e devolve uma lista **sem paginação**, já limitada pelo período.
- **Horários vazios** (`findEmptySlots`): percorre o calendário da empresa entre o maior de `from` e agora e `to` (`startsOf`, com `zonedToUtc`), descarta o horário que já tem sessão (inclusive cancelada) e o que se sobrepõe a um agendamento não cancelado do profissional. São três consultas no total (turmas, sessões ocupadas e agendamentos dos profissionais), sem uma por horário. A regra repete a que o frontend aplicava na grade, que passa a vir pronta.
- **Vagas:** a conta foi reunida em `seatsOf`, usada por `findOne` e pela agenda; a sessão cancelada passa a ter `available: 0`. Os alunos trazem `cancelReason`.
- **Agendamento:** `classSession` inclui `cancelledAt`.

## 2.51 Turmas, etapa 6: encaixe em lote e alunos fixos

- **Encaixe em lote:** `POST /class-sessions/:id/participants` e `POST /class-groups/:id/participants` recebem `clientIds` (1 a 100, sem repetidos; o `clientId` foi removido) e devolvem a sessão (`ClassSessionService.findOne`). Tudo ou nada: `findRefusedClients` confere cada cliente fora da transação (sem parar no primeiro); com a sessão travada, `enrollLocked` junta quem já está nela e os conflitos de agenda (`AppointmentService.findClassSessionConflicts`), confere as vagas da lista inteira e grava com `createManyInClassSession`.
- **Erros:** 409 com corpo próprio (`ConflictException` com objeto, levando `statusCode` e `error` explícitos): `errors: [{ clientId, message }]` nas recusas e `available`/`requested` na falta de vaga. O `ensureSlotIsFree` passou a usar `findSlotConflict`, que devolve o motivo em vez de lançar.
- **`GET /class-groups/:id/members`** (ADMIN): `ClassGroupService.findMembers` lê as recorrências da turma direto do Prisma (o `RecurringAppointmentModule` já importa o `ClassGroupModule`) — ativas, sem `classLeftAt` e com `endDate` de hoje em diante (fuso da empresa).
