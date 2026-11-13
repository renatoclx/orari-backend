# Regras de negócio: Empresa e acesso

> Parte de [`business-rules/`](README.md). Perfis, empresas, limites do plano contratado, usuários e senhas.

## Tipos de usuário

Há três tipos, e só eles (o antigo `USER` deixou de existir; a migração `remove_user_type` apagou os que havia):

- **SUPER_ADMIN**: o administrador da plataforma (o Orari). **Existe um só**, criado pelo seed. Cadastra, edita, inativa e reativa empresas, define o plano de cada uma (acessos e limites) e gerencia usuários de qualquer empresa ativa.
- **ADMIN**: o cliente, que usa o sistema web. Administra a própria empresa e gerencia os usuários dela. Cada administrador contratado é um usuário `ADMIN` (limite `admins`).
- **PROFESSIONAL**: profissional que usa só o app (`/app`), sem acesso ao sistema web. Veja "Profissional no app".

## Empresas

- Apenas SUPER_ADMIN cadastra e edita os dados cadastrais das empresas (razão social, documento, data de fundação, subdomínio, fuso e status).
- O ADMIN (e o SUPER_ADMIN, para a própria empresa) altera, na própria empresa, somente o nome fantasia e a logo. A empresa vem do token, nunca da URL. O nome fantasia tem até 100 caracteres; texto vazio ou nulo o remove, e então a razão social passa a ser o nome exibido.
- A logo é opcional, em JPEG ou PNG, com até 2 MB; o formato é conferido pelo conteúdo do arquivo. É servida publicamente e o `logoUrl` guarda o caminho relativo. Enviar uma nova logo substitui a anterior, que é apagada; a logo também pode ser removida. Só se apaga do disco arquivo da pasta das logos: uma URL externa gravada no `logoUrl` pelo SUPER_ADMIN nunca é apagada.
- O ADMIN consulta apenas a própria empresa. O filtro por status (`isActive`) é exclusivo do SUPER_ADMIN.
- Uma empresa é criada ativa, salvo indicação contrária, e com o **modelo padrão de acessos** (ver "Acessos e limites da empresa").
- Empresas não são excluídas: são inativadas.
- Enquanto uma empresa estiver inativa, seus dados relacionados ficam inacessíveis:
  - seus usuários não fazem login e perdem imediatamente o acesso, inclusive com tokens já emitidos;
  - o SUPER_ADMIN não lista, consulta nem cria usuários dessa empresa;
  - a própria empresa continua visível ao SUPER_ADMIN, para que possa ser reativada.
- Ao reativar a empresa, os dados voltam a ficar acessíveis.
- Um SUPER_ADMIN não pode inativar a própria empresa.
- O documento da empresa (`document`) é um CPF (11 dígitos) ou um CNPJ (14 caracteres), válido e sem máscara. O CNPJ pode ser numérico ou alfanumérico (letras são convertidas para maiúsculas). Quem não tem CNPJ usa o CPF, e a razão social passa a ser o nome da pessoa.
- A data de fundação é opcional: não se aplica a quem usa CPF.

## Acessos e limites da empresa

> **Etapas 1 a 4:** a API grava e consulta os acessos e os limites, informa os acessos em `GET /auth/me`, **barra as rotas** de todas as funcionalidades da tabela abaixo e **confere os limites** no cadastro e na reativação de profissionais e administradores.

- O SUPER_ADMIN define, por empresa, o que os administradores dela podem fazer em cada funcionalidade e quantos profissionais e administradores ela pode ter. Não há permissão por usuário: vale para a empresa toda.
- **Funcionalidades** (catálogo no código): `appointments`, `recurrences`, `clients`, `employees`, `professionals`, `users`, `services`, `plans`, `contracts`, `tabs` (comandas), `payments`, `payment-methods`, `anamnesis` (fichas), `anamnesis-templates`, `anamnesis-audit`, `class-groups`, `settings`, `client-portal` (portal do cliente; só `view` e `edit`) `messages` (mensagens automáticas; só `view` e `edit`, exige o Visualiza do `client-portal`) `client-portfolio` (carteira de clientes; só `view`, exige o Visualiza de `clients` e `professionals`) `receivables` (contas a receber; só `view`, exige o Visualiza de `payments` e `clients`) `appointments-report` (relatório de agendamentos; só `view`, exige o Visualiza de `appointments`) e `rankings` (só `view`, exige o Visualiza de `appointments` e `payments`). Os dois são **liberados empresa por empresa** pelo SUPER_ADMIN: ficam **fora do modelo padrão** de empresa nova (desde 2026-11-05) e a migração `20261106100000_client_portal_off` **tirou o `client-portal` de todas as empresas** que o tinham (a `20261104192412_portal_rules` o dera a todas, e o item aparecia no menu de todo ADMIN). Só a liberação foi apagada: as regras do portal de cada clínica, as contas dos clientes e os vínculos ficam, e voltam a valer quando o portal é liberado de novo.
- **Ações** por funcionalidade: `view` (visualiza), `edit` (edita), `create` (cria) e `remove` (exclui ou inativa). Cada funcionalidade só aceita as ações que fazem sentido: `anamnesis-audit` só tem `view` e `settings` só tem `view` e `edit`.
- **Sem linha, sem acesso:** uma funcionalidade nova nasce desmarcada em todas as empresas; o SUPER_ADMIN a libera.
- **Regras da matriz** (400 ao gravar): chave conhecida e sem repetição; `edit`, `create` e `remove` exigem `view`; e algumas funcionalidades exigem ver outras, porque as telas delas listam esses cadastros: `appointments`, `recurrences`, `contracts`, `tabs`, `anamnesis` e `class-groups` exigem `view` em `clients`, `professionals` e `services`.
- **Limites:** `professionals` (profissionais ativos, contando o administrador que atua: o ADMIN que também atende ocupa uma vaga de profissional, porque para vinculá-lo se cadastra uma pessoa `PROFESSIONAL`; os usuários `PROFESSIONAL` do app já entram na conta, pois cada um é ligado a um profissional) e `admins` (administradores), inteiros de 1 a 999. Funcionários (`EMPLOYEE`) não entram na conta. Só os ativos contam: inativar um profissional libera a vaga. Baixar o limite abaixo do uso é permitido: a empresa continua funcionando e apenas não cadastra novos.
- **Conferência dos limites:** só contam os **ativos** (profissional inativo é o excluído logicamente), e o administrador que atua entra como um dos profissionais. A conferência acontece **dentro da transação da gravação**, com a linha de limites da empresa **travada** (`SELECT ... FOR UPDATE`): dois cadastros simultâneos na última vaga não passam juntos (um é gravado e o outro é recusado). Estourado o limite: **403** com `code: "PLAN_LIMIT_REACHED"`, `resource` (`professionals` ou `admins`), `limit` e `used`. Vale para o SUPER_ADMIN também (ele eleva o limite no `PUT`). Sem registro de limites, valem os do modelo padrão.
  - **Profissionais** (`professionals`): criar uma pessoa do tipo `PROFESSIONAL`, **reativar** (`PATCH /people/:id/restore`) um profissional e **trocar o tipo** de uma pessoa para `PROFESSIONAL` (`PATCH /people/:id`). Criar ou reativar cliente ou funcionário não conta.
  - **Administradores** (`admins`): criar um usuário `ADMIN`, **reativar** um `ADMIN` (`PATCH /users/:id/restore`) e **promover** um usuário a `ADMIN` (`PATCH /users/:id` com `type`).
- **Modelo padrão** de uma empresa nova: tudo liberado, exceto `anamnesis`, `anamnesis-templates`, `anamnesis-audit`, `class-groups`, `client-portal` e `messages`, com 3 profissionais e 1 administrador.
- As empresas que já existiam ao implantar este recurso receberam acesso total e limites de 999, para nada mudar para quem já usa; o SUPER_ADMIN ajusta depois.
- **Barreira nas rotas:** uma rota (ou controller) marcada com `@Feature("chave")` só atende a empresa que tem a ação liberada; o `FeatureAccessGuard` global roda depois do `JwtAuthGuard` e do `RolesGuard`. A ação sai do verbo HTTP (GET = `view`, POST = `create`, PATCH e PUT = `edit`, DELETE = `remove`), e `@FeatureAction` a substitui quando o verbo não a diz. O SUPER_ADMIN não é limitado por plano. Sem a ação liberada: 403 com `code: "FEATURE_NOT_IN_PLAN"`.
- **Rotas barradas e a ação que exigem** (o verbo HTTP decide, salvo onde a tabela indica outra):

  | Funcionalidade | Rotas | Exceções à regra do verbo |
  | --- | --- | --- |
  | `appointments` | `/appointments` | |
  | `recurrences` | `/recurring-appointments` | baixar pagamentos (`POST :id/payments/settle`) exige `edit`; cancelar uma aula (`PATCH .../cancel`) exige `remove` |
  | `clients`, `employees`, `professionals` | `/people` (ver "Pessoas por tipo") | restaurar (`PATCH :id/restore`) exige `remove`; enviar e remover a foto exigem `edit` |
  | `users` | `/users` | restaurar exige `remove` |
  | `services` | `/services` | |
  | `plans` | `/plans` | |
  | `contracts` | `/client-plans` | cancelar a contratação exige `remove` |
  | `tabs` (comandas) | `GET /payments/checkouts` e `PATCH /payments/settle` | |
  | `payments` | as demais rotas de `/payments` | |
  | `payment-methods` | `/payment-methods` | restaurar exige `remove` |
  | `settings` | gravar horário de funcionamento (`POST`, `POST /batch`, `PATCH` e `DELETE` de `/business-hours`) e o nome e a logo da própria empresa (`PATCH /companies/me`, `POST` e `DELETE /companies/me/logo`) | todas exigem `edit` |
  | `class-groups` | `/class-groups` e `/class-sessions` | encaixar alunos (`POST .../participants`) exige `edit`; cancelar a sessão exige `remove` |
  | `anamnesis`, `anamnesis-templates`, `anamnesis-audit` | `/anamnesis`, `/anamnesis-templates`, `/audit-logs` | |
  | `client-portal` | `/portal-settings` (e o próprio portal só abre com ela) | ler exige `view`; gravar, `edit` |

- **Pessoas por tipo:** `/people` atende clientes, funcionários e profissionais, então a funcionalidade vem do tipo da pessoa. Em rota com `:id`, vale o tipo **gravado** (o corpo poderia mentir); na criação, o `type` do corpo; na listagem, o filtro `type`. Listagem **sem** tipo exige as três funcionalidades.
- **Rotas sem barreira de propósito** (cada uma está declarada no teste `feature-coverage.spec.ts`, que falha se uma rota nova ficar sem barreira e sem isenção): `/auth/*`, `/cities` e `/states` (dados de referência), `/notifications` (sem uso), `GET /business-hours` e `GET /companies` e `GET /companies/:id` (a agenda e o layout os leem), as rotas exclusivas do SUPER_ADMIN e, por ora, `/contacts` e `/addresses` (ver `technical-debt.md`).
- Cancelar um agendamento avulso é `PATCH /appointments/:id` (muda o status) e por isso exige `edit`, não `remove`.
- `GET /companies/:companyId/access` (só SUPER_ADMIN; empresa inexistente: 404) traz uma entrada por funcionalidade (`feature`, `view`, `edit`, `create`, `remove`), os `limits` (`professionals`, `admins`) e o uso atual (`usage`).
- `GET /auth/me` traz `access.features` com os acessos da empresa do usuário; o SUPER_ADMIN recebe tudo, pois a plataforma não é limitada por plano.
- `PUT /companies/:companyId/access` (só SUPER_ADMIN) **substitui** a matriz e os limites de uma vez, na mesma transação do registro de auditoria `COMPANY_ACCESS_CHANGED`. A funcionalidade que faltar no corpo fica sem acesso. O registro de auditoria pertence à empresa do SUPER_ADMIN, não à empresa alterada: o cliente não vê a gestão do plano dele.

## Usuários e acesso

- Todo usuário pertence a uma empresa, que não pode ser alterada.
- SUPER_ADMIN cria usuários informando a empresa, que deve estar ativa.
- ADMIN cria usuários sempre na própria empresa; informar outra empresa responde 403.
- ADMIN gerencia apenas usuários da própria empresa e não enxerga contas SUPER_ADMIN. Usuários fora do alcance respondem 404.
- **Um único SUPER_ADMIN:** a API não cria nem promove ninguém a esse tipo, nem o próprio SUPER_ADMIN (403 "O tipo SUPER_ADMIN não pode ser atribuído pela API"); quem cria é o seed. Um índice único parcial no banco (`users_single_super_admin_key`) garante no máximo um ativo, mesmo com requisições simultâneas.
- Ninguém pode excluir a própria conta nem alterar o próprio tipo.
- O login é recusado para usuários excluídos e para usuários de empresas inativas, sempre com a mesma mensagem genérica de credenciais inválidas.
- Um usuário autenticado perde o acesso imediatamente quando é excluído ou quando sua empresa fica inativa.
- A exclusão é lógica (inativação): preenche o `deletedAt`. A listagem (`GET /users`) traz ativos e inativos e aceita o filtro opcional `name` (busca parcial, sem diferenciar maiúsculas; acentos contam), que respeita o que o usuário já enxerga; consultar, alterar, trocar a senha e excluir valem só para ativos (inativo responde 404).
- Um usuário inativado pode ser reativado por `PATCH /users/:id/restore` (limpa o `deletedAt`), pelos mesmos perfis e com o mesmo alcance da gestão de usuários. Reativar um usuário já ativo responde 409; se o e-mail dele estiver em uso por outro usuário ativo, também responde 409.
- Um usuário pode ser vinculado a uma pessoa ativa da mesma empresa, do tipo `PROFESSIONAL` ou `EMPLOYEE` (funcionário: recepção, secretaria). Só o vínculo com um **profissional** dá acesso às fichas de anamnese (ver Anamnese); o vínculo com funcionário identifica a função do usuário. O funcionário (`EMPLOYEE`) existe só como **cadastro** (contas a pagar e afins), sem login. Uma pessoa se liga a no máximo um usuário ativo.

## Profissional no app

- Usuário `PROFESSIONAL` exige `peopleId` de um **profissional** ativo da mesma empresa (funcionário não serve) e `phone` (10 ou 11 dígitos, DDD + número). O telefone é o login e é **único entre os usuários ativos** (409 "Já existe um usuário profissional com este telefone"; checagem explícita no service e índice único parcial no banco para a corrida). Os demais tipos não têm telefone de acesso, e sair do tipo apaga o telefone. Não conta no limite de administradores.
- Entra por `POST /auth/professional/login` (público, 5 tentativas por minuto por IP) com **telefone ou e-mail** (campo `login`; com `@` é e-mail do usuário PROFESSIONAL) e senha; credenciais inválidas, usuário excluído ou empresa inativa respondem a mesma mensagem genérica. O login do sistema web (`POST /auth/login`) recusa esse tipo com **403** ("Profissionais entram pelo aplicativo do Orari, não pelo sistema web."), só depois de a senha conferir: nenhum token é emitido.
- **Barreira que nega por padrão:** o `ProfessionalAppGuard` (global) bloqueia com 403 toda rota para o `PROFESSIONAL`, exceto as marcadas com `@ProfessionalApp()`: hoje só `GET /auth/me` e `PATCH /auth/me/password`. Um teste de cobertura fixa a lista exata, e o e2e confere o 403 nas demais. Rota nova para o app precisa ser marcada de propósito.
- Rotas liberadas ao profissional (as únicas): `GET /auth/me`, `PATCH /auth/me/password`, `GET /professional-app/agenda`, `GET /professional-app/home`, `GET /professional-app/clients`, `GET /professional-app/clients/:id` e as quatro rotas de comissões (`/professional-app/commissions`, `/commissions/summary`, `/commission-closings` e `/commission-closings/:id`); as oito últimas só do tipo PROFESSIONAL. O profissional da consulta vem sempre do vínculo do usuário; o parâmetro `professionalId` é recusado (400).
- Funcionalidade `professional-app` (só Visualiza; exige Agenda), liberada em todos os planos e empresas. O app mostra apenas a consulta, só dos clientes do próprio profissional; sem anamnese e sem status de pagamento.
- Troca a própria senha por `PATCH /auth/me/password` (senha atual + nova + confirmação); encerra as outras sessões.

## Senhas

- A senha deve ter entre 8 e 72 caracteres e ser confirmada no cadastro e na redefinição.
- A senha é armazenada apenas como hash (bcrypt) e nunca é retornada pela API.
- A senha não é alterada pela edição do usuário: SUPER_ADMIN ou ADMIN a redefinem por rota própria, sem precisar da senha atual, respeitando o alcance de cada um.
- Redefinir a senha encerra as sessões do usuário: os refresh tokens dele deixam de valer. O mesmo acontece ao inativar ou reativar o usuário.
- O login aceita até 5 tentativas por minuto do mesmo IP, e a renovação do token, até 20; acima disso, a API responde 429.
