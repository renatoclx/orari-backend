# Regras de Negócio

## Tipos de usuário

- **SUPER_ADMIN**: Cadastra, edita, inativa e reativa empresas, e gerencia usuários de qualquer empresa ativa.
- **ADMIN**: administra a própria empresa. Gerencia os usuários dela.
- **USER**: opera os dados da própria empresa (pessoas, contatos e endereços), sem gerenciar usuários.

## Empresas

- Apenas SUPER_ADMIN cadastra e edita os dados cadastrais das empresas (razão social, documento, data de fundação, subdomínio, fuso e status).
- O ADMIN (e o SUPER_ADMIN, para a própria empresa) altera, na própria empresa, somente o nome fantasia e a logo. A empresa vem do token, nunca da URL. O USER não altera nada. O nome fantasia tem até 100 caracteres; texto vazio ou nulo o remove, e então a razão social passa a ser o nome exibido.
- A logo é opcional, em JPEG ou PNG, com até 2 MB; o formato é conferido pelo conteúdo do arquivo. É servida publicamente e o `logoUrl` guarda o caminho relativo. Enviar uma nova logo substitui a anterior, que é apagada; a logo também pode ser removida. Só se apaga do disco arquivo da pasta das logos: uma URL externa gravada no `logoUrl` pelo SUPER_ADMIN nunca é apagada.
- ADMIN e USER consultam apenas a própria empresa. O filtro por status (`isActive`) é exclusivo do SUPER_ADMIN.
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
- **Limites:** `professionals` (profissionais ativos, contando o administrador que atua) e `admins` (administradores), inteiros de 1 a 999. Funcionários (`EMPLOYEE`) não entram na conta. Só os ativos contam: inativar um profissional libera a vaga. Baixar o limite abaixo do uso é permitido: a empresa continua funcionando e apenas não cadastra novos.
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

## Portal do cliente

> **Estado:** regras do portal por clínica, vitrine pública, profissionais de cada serviço, horários livres, e o cliente lista, agenda e cancela os próprios agendamentos. Desde a etapa 6a (2026-11-05), o cliente tem uma **conta no app** com telefone e senha, válida em todos os estabelecimentos. A confirmação do telefone pelo código no WhatsApp volta quando houver canal de envio (etapa 3).

- O portal de cada clínica é `/portal/:slug`, em que `slug` é o **subdomínio** da empresa. O portal só existe quando a clínica está ativa, **a clínica o ligou** e a funcionalidade `client-portal` está liberada no plano; nos demais casos, toda rota do portal responde 404 (inclusive o pedido de código), sem dizer o motivo, e as sessões abertas deixam de valer (401).
- **Regras do portal** (`GET` e `PUT /portal-settings`, só ADMIN, funcionalidade `client-portal`: ler exige `view`, gravar `edit`): `enabled` (portal ligado), `minAdvanceMinutes` (antecedência mínima para agendar, 0 a 7 dias), `maxDaysAhead` (até quantos dias à frente, 1 a 365) e `cancelUntilHours` (até quantas horas antes o cliente cancela, 0 a 30 dias). Padrão de quem nunca gravou: **desligado**, 60 minutos, 30 dias e 24 horas. O `PUT` substitui tudo, exceto os campos da busca abaixo quando não vêm.
- **Busca de estabelecimentos** (desde 2026-11-05):
  - Nas regras do portal, `listed` (**aparecer na busca**, padrão desligado) e `segment` (ramo: `BARBERSHOP` barbearia, `BEAUTY_SALON` salão de beleza, `AESTHETICS` estética, `NAIL_SALON` esmalteria, `EYEBROW_DESIGN` design de sobrancelhas, `PHYSIOTHERAPY` fisioterapia, `PILATES`, `PSYCHOLOGY` psicologia, `NUTRITION` nutrição, `DENTISTRY` odontologia, `OTHER` outros). Os dois são opcionais no `PUT`: sem eles, ficam como estão. **Aparecer na busca exige o segmento** (400 "Escolha o segmento…").
  - `GET /portal-directory?q=` (sem login): pelo **nome fantasia ou pela razão social**, sem diferença de acentos e maiúsculas (`q` com 2 a 100 caracteres). Só entram as clínicas **ativas**, com o **portal ligado**, com a funcionalidade no **plano** e que **escolheram aparecer** (com segmento). Até **20**, em ordem alfabética, cada uma com `slug`, nome (o fantasia, ou a razão social), logo, `segment` e `city` ("Cidade - UF", do endereço principal da empresa; nula se não houver). O id interno não vai para o app. Limite: 60 buscas por minuto por IP (o app busca enquanto o cliente digita).
  - Geolocalização ("Próximas") e filtro por cidade ficam para depois.
- **Profissionais de cada serviço** (`GET` e `PUT /services/:id/professionals`, funcionalidade `services`): a clínica diz quem atende cada serviço. Só profissionais **ativos** da empresa (senão, 400 sem gravar); lista vazia tira todos. Também servirá à comissão e aos relatórios.
- **Vitrine, sem login:** `GET /portal/:slug` (nome, logo, segmento, cidade, fuso e as regras, sem o id interno) e `GET /portal/:slug/services` (serviços **ativos** com ao menos um **profissional ativo** ligado, cada um com seus profissionais, em ordem de nome). Não há outra marca de "agendamento online": ter profissional ligado é o que põe o serviço no portal.
- **Horários livres** (`GET /portal/:slug/availability?serviceId&professionalId&date`, sem login): o dia (`AAAA-MM-DD`) é o do relógio da clínica. O serviço precisa estar ativo e ligado a esse profissional ativo (senão, 404); data impossível, 400. Cada horário traz `time` (HH:MM, no fuso da clínica) e `startAt` (o instante em UTC, pronto para agendar).
  - **Candidatos:** a grade de 15 minutos, o começo de cada janela de atendimento e o fim de cada compromisso do profissional (o "horário quebrado"). Vale o horário em que o atendimento inteiro cabe em **uma** janela do dia, sem sobrepor compromisso. É a mesma regra da tela da clínica.
  - **Compromissos do profissional:** agendamentos não cancelados que tocam o dia (inclusive os de turma) e **os horários das turmas fixas ativas dele, mesmo sem alunos**: o cliente do portal não marca no horário de uma turma.
  - **Regras da clínica:** nada antes de agora + a **antecedência mínima** (que pode passar para o dia seguinte); só datas de hoje até hoje + **dias à frente**. Fora disso, lista vazia.
  - **Sem horário de funcionamento** cadastrado no dia, a lista vem vazia: no portal, as janelas são obrigatórias (diferente da tela da clínica, em que empresa sem janela não é restringida).
- **Agendamentos do cliente** (com o token do portal):
  - `GET /portal/:slug/appointments`: `upcoming` (de agora em diante, não cancelados, em ordem de início) e `past` (os 20 mais recentes já iniciados, inclusive cancelados). Cada item traz serviço (nome e duração), profissional (nome), início, fim, status, origem, `kind` (`SINGLE` avulso, `RECURRENCE`, `PLAN` ou `CLASS` turma) e `canCancel`.
  - `POST /portal/:slug/appointments` (`serviceId`, `professionalId`, `startAt`): o `startAt` precisa estar entre os **horários livres no momento do pedido** (mesma regra da lista; senão, **409** "Este horário não está mais disponível"). A gravação é a mesma da clínica (cliente = a pessoa da sessão, sem encaixe), com a origem `PORTAL`.
  - `PATCH /portal/:slug/appointments/:id/cancel` (204): só agendamento do **próprio cliente** (de outro, 404), **avulso** (recorrência, pacote e turma: 400, a clínica cancela) e até **`cancelUntilHours` antes** do início (depois, 400 "Fale com a clínica"). As demais regras (já iniciado, concluído, pagamento) são as do cancelamento da clínica.
- Pelo portal só se fazem **agendamentos avulsos**; recorrências, pacotes e turmas continuam sendo feitos na clínica. O agendamento guarda a **origem** (`source`: `CLINIC` ou `PORTAL`).
- **Conta do cliente no app** (desde 2026-11-05): o cliente tem **uma conta só no Orari**, com **telefone e senha**, e com ela usa todos os estabelecimentos. Em cada clínica, o cliente continua sendo o **cadastro dela** (pessoa CLIENT), **ligado à conta**; uma conta tem no máximo um cadastro ativo em cada clínica. Uma clínica nunca vê o que outra guardou.
  - **Telefone:** com DDD, 10 ou 11 dígitos, como nos contatos; a API aceita máscara e o código do país (55). É o login e é único entre as contas.
  - **Senha:** a mesma regra dos usuários da clínica (8 a 72 caracteres, com confirmação), guardada com bcrypt.
  - **Ainda não há confirmação do telefone:** quem cria a conta digita o número. Por isso, a conta **só se liga a um cadastro que já existe pelo link da clínica**, e nunca porque o telefone é igual.
- **Rotas da conta** (`/portal-account`, fora do `/portal/:slug` para não disputar o endereço com as clínicas):
  - `POST /portal-account/register` (`name`, `phone`, `password`, `passwordConfirmation`): cria a conta, sem nenhum estabelecimento, e já abre a sessão. Telefone de outra conta: **409**.
  - `POST /portal-account/login` (`phone`, `password`): telefone sem conta ou senha errada dão o mesmo **401** "Telefone ou senha inválidos", no mesmo tempo de resposta.
  - `GET /portal-account`: a conta (nome e telefone), `unreadMessages` (avisos não lidos, ver "Avisos do app") e os **locais** dela (`slug`, nome, logo e fuso), só os de portal aberto, em ordem alfabética.
  - `PATCH /portal-account/password` (`currentPassword`, `newPassword`, `newPasswordConfirmation`; 204): senha atual errada, 400. Os **outros aparelhos saem** (e deixam de receber os avisos do app); este continua.
  - `POST /portal-account/logout` (204): encerra a sessão deste aparelho e apaga a inscrição dos avisos dele (quem entrar depois no aparelho não recebe os da conta).
  - Cadastro, login, troca de senha e link têm limite de tentativas por IP (429).
- **Sessão:** devolvida uma única vez (`token` e `expiresAt`), vale **90 dias**, é de um aparelho e é **da conta**. Nas rotas de um estabelecimento (`/portal/:slug/...`), a API procura o cadastro ativo da conta naquela clínica; sem cadastro, **403 `NOT_A_CLIENT`** "Você ainda não é cliente deste estabelecimento" (o app oferece entrar nele). Portal fechado: 404.
- **Link de acesso gerado pela clínica:** `POST /people/:id/portal-access` (funcionalidade `clients`, ação `edit`) gera, para um **cliente ativo** da empresa, um link de **uso único** que vale **24 horas**. A clínica o envia pelo WhatsApp dela ou mostra em QR code. Um link novo invalida o anterior ainda não usado. Com o portal desligado, 409. Usar o link **confirma** o cadastro (ver "Entrar sozinho"). Só o hash do token é gravado, e a geração fica na **auditoria** (`PORTAL_ACCESS_LINK_CREATED`). A resposta traz `token`, `expiresAt` e `path` (`/app/acesso/<token>`, o caminho no app).
  - É o **único caminho que liga a conta a um cadastro que já existe**: quem prova a identidade é a clínica, que conhece o cliente.
  - `POST /portal-account/link/check` (`token`) confere o link **sem usá-lo** e devolve o estabelecimento, o nome do cliente, `needsPhone` (o cadastro não tem telefone) e `hasAccount` (a senha será a nova senha de uma conta que já existe).
  - `POST /portal-account/link` (`token`; `password` e `passwordConfirmation`; `phone` só quando `needsPhone`) usa o link uma vez só:
    - **com a conta entrada** (token do portal no cabeçalho): liga o cadastro da clínica a ela. Cadastro já ligado a outra conta: 409.
    - **cadastro já ligado a uma conta:** a senha passa a ser a **senha nova** dessa conta, e os aparelhos dela saem. É o **"esqueci a senha"**: o cliente pede um link à clínica.
    - **telefone da clínica com conta:** liga o cadastro a essa conta e troca a senha (a clínica garantiu que o telefone é do cliente).
    - **sem conta:** cria a conta com o nome do cadastro e o telefone da clínica (ou o digitado, quando o cadastro não tem) e liga.
    - **telefone digitado que já tem conta:** 409 (pode ser de outra pessoa); o cliente entra nela e abre o link de novo.
    - Link inexistente, usado, vencido, de cliente inativo ou de portal fechado: 400. Dois cliques ao mesmo tempo: só um vale.
  - A conta já ter outro cadastro na mesma clínica: 409.
- **Entrar sozinho num estabelecimento** (`POST /portal-account/places/:subdomain`, com a conta entrada): cria um **cadastro novo** de cliente na clínica, com o nome e o telefone da conta (o telefone vira o contato principal). **Nunca junta** com um cadastro que já existe, mesmo com o telefone igual, porque o telefone da conta não foi conferido. Já sendo cliente: nada muda (`joined: false`). Portal fechado: 404.
  - Esse cadastro nasce **não confirmado** (`portalConfirmed = false`). Até a clínica confirmar, o cliente pode ter **no máximo 2 agendamentos futuros** (não cancelados, de qualquer origem) naquela clínica; o terceiro pelo app é recusado com **403 `UNCONFIRMED_LIMIT`**. Agendamentos feitos pela clínica não são barrados.
  - **A clínica confirma** pelo `PATCH /people/:id/portal-confirm` (funcionalidade `clients`, ação `edit`; 204; já confirmado, nada muda; fica na **auditoria**, `PORTAL_CLIENT_CONFIRMED`). O cadastro também passa a confirmado quando é ligado ou recebe senha nova **pelo link da clínica**.
  - Os cadastros da clínica (inclusive os antigos) nascem confirmados.
- **Agendamentos de todos os estabelecimentos** (`GET /portal-account/appointments`): `upcoming` (do mais perto ao mais longe) e `past` (os 20 mais recentes) de todos os cadastros da conta em clínicas de portal aberto. Cada item é o mesmo da lista de um estabelecimento, com `place` (`slug`, nome, logo e fuso, para mostrar o horário no relógio da clínica).
- **Meus dados** (desde 2026-11-05): a conta guarda o **cadastro do cliente** e o copia para o cadastro dele em **cada clínica** ligada à conta.
  - `GET /portal-account/city?name=&state=`: a cidade pelo nome (sem acentos) e pela UF, para o app preencher o endereço pelo CEP (não achou: 404).
  - `GET /portal-account/profile`: nome, telefone, e-mail, CPF, nascimento, profissão, foto e o endereço principal (`address` nulo sem endereço).
  - `PUT /portal-account/profile` substitui tudo (campo opcional que não vem fica vazio) e copia para cada cadastro ativo da conta, numa transação: nome, CPF, nascimento e profissão; telefone e e-mail no **contato principal** (criado se não houver); o **endereço principal** (criado se não houver). **Sem endereço no app, o da clínica fica** (não é apagado). As **observações** da clínica nunca são tocadas nem mostradas ao cliente.
  - Trocar o **telefone** (o login) pede `currentPassword` (sem ela ou errada: 400); telefone de outra conta: 409.
  - **CPF** em outro cadastro ativo de alguma das clínicas (lá ele é único): 409 "Este CPF já está em outro cadastro de <clínica>. Fale com o estabelecimento.", sem salvar nada.
  - **Foto** (`POST /portal-account/photo`, multipart `photo`, JPEG ou PNG conferidos pelo conteúdo, até 2 MB; `DELETE` tira): grava a da conta e **uma cópia para cada clínica** (se a clínica trocar a foto no painel, as outras não perdem a sua); os arquivos antigos só são apagados depois que o banco aponta para os novos.
  - **Vale o último a salvar:** a clínica continua podendo corrigir o cadastro dela no painel; o próximo "Salvar" do app sobrescreve com Meus dados.
  - **Ao entrar sozinho** num estabelecimento, o cadastro novo já nasce com Meus dados (o CPF só se não estiver em outro cadastro da clínica; a foto vai na próxima troca). **Ao criar a conta pelo link**, ela nasce com o que a clínica tem (CPF, nascimento, profissão e e-mail).
- **Pacotes e recorrências, só para ver** (desde 2026-11-05), de todos os estabelecimentos de portal aberto:
  - `GET /portal-account/plans`: cada pacote contratado com o nome do plano, `startDate`/`endDate` (aaaa-mm-dd), `status` pela mesma regra da clínica (`cancelled`; `finished` quando a data final já passou; senão `active`) e `place`. **Sem valores.** Ativos primeiro, depois os mais recentes.
  - `GET /portal-account/recurrences`: as recorrências **em vigor** (ativas, sem saída da turma, sem data final ou com ela de hoje em diante): `kind` (`RECURRENCE` horário fixo, `PLAN` de pacote, `CLASS` turma), serviço, profissional, `days` (dia da semana, início e fim em HH:MM), período e `place`. Quem marca e muda é a clínica.
- **Código pelo WhatsApp:** as peças continuam no backend (cálculo e hash do código, limites, tabela `PortalVerification`, envio), mas **sem rotas** desde a etapa 6a. Voltam quando houver canal de envio, para **confirmar o telefone da conta**.

## Avisos do app

> **Estado:** desde a etapa 8a (2026-11-05), a base: inscrição dos aparelhos, interruptores do cliente, aviso de teste e a caixa de Avisos. Os avisos automáticos estão em "Mensagens automáticas" (8c); as mensagens escritas pela clínica vêm na 8e.

- **Canal:** notificação **push** do navegador (padrão Web Push, chaves VAPID), para o app do cliente (`/app`). Não depende do WhatsApp nem tem custo por mensagem. Sem as chaves no ambiente (`VAPID_*`, ver `deploy.md`), o push fica **desligado**: nada é enviado e o app não oferece ativar; o resto da API funciona.
- **Quem recebe:** a **conta** do cliente, nos aparelhos em que ele **ativou os avisos** (no iPhone, só com o app instalado na tela de início, iOS 16.4+). A inscrição é do aparelho e fica **ligada à sessão**: ao sair do app ela é apagada, e sessão vencida ou revogada (troca de senha) não recebe. Quando o serviço de push responde que o aparelho não existe mais (404/410), a inscrição é apagada.
- **Endereços aceitos:** só os dos serviços de push dos navegadores (Google, Apple, Mozilla, Microsoft), em HTTPS; outro endereço: 400. Assim a API nunca envia para um endereço qualquer.
- **Interruptores do cliente** (ligados por padrão): `notifyAppointments` (**lembretes e agendamentos**: lembrete de horário; agendamento marcado, alterado ou cancelado pela clínica) e `notifyPromotions` (**novidades e promoções**: aniversário, sentimos sua falta e mensagens da clínica). Com o interruptor desligado, o aviso daquele tipo **nem é gravado nem enviado**. O aviso de teste não depende deles.
- **Caixa de Avisos:** todo aviso enviado fica gravado para a conta (`ClientMessage`), **mesmo sem aparelho inscrito**, com a clínica que enviou, o tipo, título (até 100), texto (até 500) e o caminho do app aberto ao tocar.
- **Envio:** um ponto só (`ClientNotifierService`), que nunca falha para quem chamou: um agendamento salvo não dá erro porque o aviso não saiu; a falha vai para o log.
- **Rotas** (com o token do portal):
  - `GET /portal-account/push`: `publicKey` (nula com o push desligado) e os dois interruptores.
  - `POST /portal-account/push/subscriptions` (204): o `PushSubscription.toJSON()` do navegador (`endpoint`, `keys.p256dh`, `keys.auth`). O mesmo aparelho que já estava inscrito passa para esta conta e sessão. Push desligado: 503.
  - `DELETE /portal-account/push/subscriptions` (`endpoint`; 204): desativa neste aparelho (só a inscrição da própria conta).
  - `PUT /portal-account/push/preferences` (`notifyAppointments`, `notifyPromotions`): os dois interruptores.
  - `POST /portal-account/push/test`: aviso de teste aos aparelhos da conta; devolve `devices` (para quantos saiu). Até 5 a cada 10 minutos por IP (429). Push desligado: 503.
  - `GET /portal-account/messages` (`page`, `limit` até 100): dos mais novos aos mais antigos, com `place` (nome e logo da clínica; nulo no teste), `total` e `unread`.
  - `PATCH /portal-account/messages/read` (204): marca todos como lidos.
  - `DELETE /portal-account/messages` (204): limpa a caixa (o **Limpar** do app), apagando todos os avisos da conta. Não afeta a clínica: o `recipients` das mensagens enviadas fica gravado na campanha, e os automáticos não saem de novo (o registro que impede repetir é outra tabela).

## Mensagens automáticas

> **Estado:** backend na 8c (2026-11-05); tela da clínica (Mensagens → Automáticas) na 8d (2026-11-06). As mensagens escritas pela clínica estão em "Mensagens da clínica".

- Avisos que a **clínica** manda ao cliente do app, por push (ver "Avisos do app"), conforme a situação. Funcionalidade **Mensagens** (`messages`) no Acessos e limites: **Visualiza** = ler a configuração; **Edita** = ligar, desligar e mudar os textos. Exige o Visualiza do Portal do cliente. Fica **fora do modelo padrão** de empresa nova, como o Portal do cliente (o SUPER_ADMIN libera).
- **Quem recebe:** o cliente **ativo** da clínica que tem **conta no app**, e só se a clínica está ativa, com o **portal ligado** e com o Portal do cliente e as Mensagens no **plano**. Os interruptores do cliente valem (lembretes e agendamentos; novidades e promoções). O título da notificação é o nome da clínica; nas situações de agendamento, tocar abre a aba Agendamentos do app.
- **Situações** (`GET` e `PUT /auto-messages`, só ADMIN). Quem nunca salvou recebe os padrões:

  | Situação (`kind`) | Padrão | Quando sai |
  | --- | --- | --- |
  | Lembrete (`REMINDER`) | ligada; 24h e 30 min antes | nos tempos escolhidos (`reminderOffsets`, em minutos: 30, 60, 120, 1440, 2880; vários). Sai até **15 minutos** depois do momento certo; mais tarde, não sai (ex.: o "24h antes" de um horário marcado com 2h de antecedência) |
  | Agendamento marcado (`APPOINTMENT_CREATED`) | ligada | a clínica marca um **avulso** |
  | Agendamento alterado (`APPOINTMENT_RESCHEDULED`) | ligada | a clínica muda a **data ou o horário** (alterar o avulso; remanejar ou repor uma sessão de recorrência ou pacote). Só a observação ou o status: sem aviso |
  | Agendamento cancelado (`APPOINTMENT_CANCELLED`) | ligada | a clínica cancela um avulso, **uma** sessão de recorrência ou uma **sessão de turma** (cada aluno dela) |
  | Aniversário (`BIRTHDAY`) | desligada | às **9h** do fuso da clínica, no dia do aniversário (data do cadastro na clínica). 29/02 comemora em 28/02 fora dos anos bissextos |
  | Sentimos sua falta (`MISS_YOU`) | desligada; 30 dias | às **10h**, quem teve o último atendimento concluído **exatamente X dias atrás** (`missYouDays`: 15, 30, 45, 60 ou 90) e não voltou nem tem horário marcado. O dia exato, e não "X ou mais": ligar a opção não manda a mensagem a todos os clientes antigos de uma vez |

- **Sem aviso:** o que o **próprio cliente** faz pelo app (agendar, cancelar); as sessões criadas **em lote** (criar uma recorrência, contratar um pacote, turmas); cancelar uma recorrência, turma ou contratação **inteira**. Os **lembretes valem para todas as sessões**.
- **Texto** (`body`, até 500 caracteres) com variáveis trocadas no envio: `{nome}` (primeiro nome do cadastro), `{estabelecimento}` (o nome exibido da clínica) e, nas situações de agendamento, `{data}` (dd/mm), `{hora}` (HH:MM, no fuso da clínica), `{servico}` e `{profissional}`. Variável que não existe na situação: **400** "<Situação>: {x} não existe nesta mensagem", sem gravar. Lembrete ligado sem nenhum tempo: 400.
- O `PUT` grava só as situações enviadas (cada uma no máximo uma vez), tudo ou nada, e devolve as seis.
- **Sem repetir:** cada envio grava um registro com chave única antes de sair (`AutoMessageLog`): o lembrete de cada tempo de cada horário, cada mudança de horário, o cancelamento, o aniversário do ano, a falta do dia. O job rodando de novo ou a API reiniciando não repetem; remarcado, o horário ganha lembretes novos.
- **Como os agendamentos avisam:** o módulo de agendamentos só **anuncia**, depois de gravar, o que a clínica fez (marcou, mudou, cancelou); o módulo de mensagens escuta e envia fora da requisição. Uma falha no aviso nunca impede salvar o agendamento (vai para o log).
- **Jobs:** lembretes a cada 5 minutos; aniversário e falta a cada 10 minutos, conferindo a hora local de cada clínica (se a API reiniciar às 9h05, o aniversário do dia ainda sai).

## Mensagens da clínica

> **Estado:** desde a etapa 8e (2026-11-06): Mensagens → Enviar.

- A clínica escreve um **título** (até 100; é o título da notificação) e um **texto** (até 500) e envia a **todos os clientes ativos com conta no app** (`POST /message-campaigns`, só ADMIN, funcionalidade `messages` com **Edita**). Mesmas condições das automáticas: clínica ativa, portal ligado, Portal do cliente e Mensagens no plano; senão, **409** e nada sai.
- **Uma por dia** por clínica, no dia do **fuso da clínica**; a segunda do dia: **409** "Hoje já foi enviada uma mensagem. A próxima pode ser enviada amanhã." As automáticas não contam. O registro nasce numa transação **travada por clínica** (`pg_advisory_xact_lock`): dois envios ao mesmo tempo não passam juntos.
- **Variáveis:** só `{nome}` (primeiro nome do cadastro) e `{estabelecimento}`, no título e no texto; outra variável: **400**. Cada cliente recebe com o próprio nome.
- O aviso é do tipo `CAMPAIGN`: quem desligou **novidades e promoções** no app não recebe (nem na caixa de Avisos). Tocar abre a tela Avisos.
- **Resposta e histórico:** `recipients` = quantos receberam na caixa de Avisos. `GET /message-campaigns` (paginado, mais recentes primeiro) traz título, texto (como foi escrito), `recipients`, data e quem enviou (`createdBy.name`).
- `GET /message-campaigns/audience`: `clients` (ativos com o app), `promotionsOff` (desses, quantos desligaram as promoções) e `canSendToday`.
- Envio na hora, em lotes de 10 (ver `technical-debt.md`, "Avisos do app enviados na hora, sem fila").

## Usuários e acesso

- Todo usuário pertence a uma empresa, que não pode ser alterada.
- SUPER_ADMIN cria usuários informando a empresa, que deve estar ativa.
- ADMIN cria usuários sempre na própria empresa; informar outra empresa responde 403.
- ADMIN gerencia apenas usuários da própria empresa e não enxerga contas SUPER_ADMIN. Usuários fora do alcance respondem 404.
- Apenas SUPER_ADMIN pode criar contas SUPER_ADMIN ou promover alguém a esse tipo.
- Ninguém pode excluir a própria conta nem alterar o próprio tipo.
- O login é recusado para usuários excluídos e para usuários de empresas inativas, sempre com a mesma mensagem genérica de credenciais inválidas.
- Um usuário autenticado perde o acesso imediatamente quando é excluído ou quando sua empresa fica inativa.
- A exclusão é lógica (inativação): preenche o `deletedAt`. A listagem (`GET /users`) traz ativos e inativos e aceita o filtro opcional `name` (busca parcial, sem diferenciar maiúsculas; acentos contam), que respeita o que o usuário já enxerga; consultar, alterar, trocar a senha e excluir valem só para ativos (inativo responde 404).
- Um usuário inativado pode ser reativado por `PATCH /users/:id/restore` (limpa o `deletedAt`), pelos mesmos perfis e com o mesmo alcance da gestão de usuários. Reativar um usuário já ativo responde 409; se o e-mail dele estiver em uso por outro usuário ativo, também responde 409.
- Um usuário pode ser vinculado a uma pessoa ativa da mesma empresa, do tipo `PROFESSIONAL` ou `EMPLOYEE` (funcionário: recepção, secretaria). Só o vínculo com um **profissional** dá acesso às fichas de anamnese (ver Anamnese); o vínculo com funcionário identifica a função do usuário, e o acesso dele será tratado à parte. Uma pessoa se liga a no máximo um usuário ativo.

## Senhas

- A senha deve ter entre 8 e 72 caracteres e ser confirmada no cadastro e na redefinição.
- A senha é armazenada apenas como hash (bcrypt) e nunca é retornada pela API.
- A senha não é alterada pela edição do usuário: SUPER_ADMIN ou ADMIN a redefinem por rota própria, sem precisar da senha atual, respeitando o alcance de cada um.
- Redefinir a senha encerra as sessões do usuário: os refresh tokens dele deixam de valer. O mesmo acontece ao inativar ou reativar o usuário.
- O login aceita até 5 tentativas por minuto do mesmo IP, e a renovação do token, até 20; acima disso, a API responde 429.

## Pessoas

- Uma pessoa pertence à empresa do usuário que a cadastrou; a empresa não é informada no payload.
- Usuários só acessam pessoas da própria empresa. Pessoas de outra empresa respondem 404.
- Só o nome e o tipo da pessoa são obrigatórios; CPF e data de nascimento são opcionais, para qualquer tipo de pessoa. Assim um cliente pode ser cadastrado só com o nome e um telefone (contato).
- O documento da pessoa, quando informado, é um CPF válido, sem máscara.
- Pessoas podem ser filtradas por nome (busca parcial que ignora acentos e maiúsculas), por CPF (exato) e por tipo.
- A observação da pessoa é opcional, de texto livre, com até 1000 caracteres.
- O cadastro da pessoa pode trazer, de uma vez, um telefone principal, uma lista de contatos e uma lista de endereços (até 10 de cada). Pessoa, contatos e endereços são criados juntos: se qualquer parte falhar, nada é criado.
  - O telefone principal tem 10 ou 11 dígitos (DDD + número) e é gravado como o contato principal da pessoa, de tipo principal (`MAIN`). A lista de contatos é gravada à parte, em lote.
  - Contatos e endereços enviados seguem as mesmas validações dos cadastrados avulsos, sem informar o dono: ele é a pessoa criada.
  - O principal é definido apenas pela marca `isPrincipal`, sem relação com o tipo do contato. Quando o telefone principal é informado, nenhum contato da lista pode ser principal. Há no máximo um contato principal e um endereço principal.
  - Nenhum item é marcado como principal automaticamente.
  - Uma cidade inexistente em qualquer endereço recusa o cadastro inteiro (404), sem criar a pessoa.
  - Depois do cadastro, telefone, contatos e endereços são mantidos pelas rotas de contatos e endereços; a edição da pessoa não os altera.
- A listagem de pessoas traz ativas e excluídas (inativas): o status é derivado da data de exclusão (`deletedAt`). O filtro opcional `isActive` traz só as ativas (`true`) ou só as inativas (`false`).
- Uma pessoa excluída continua na listagem e pode ser consultada (`GET /people/:id`, só leitura, com o `deletedAt`; ex.: o histórico do cliente), mas não pode ser editada nem excluída de novo (404), nem ser usada em agendamentos.
- Uma pessoa excluída pode ser reativada. A reativação é recusada quando a pessoa não existe (404), já está ativa (409) ou quando o CPF dela está em uso por outra pessoa ativa da empresa (409). Ao reativar, os contatos e endereços dela voltam a ser acessíveis.
- A foto da pessoa é opcional e enviada por uma rota própria, em JPEG ou PNG, com até 2 MB. O formato é conferido pelo conteúdo do arquivo, e não só pela extensão.
- O caminho da foto (`photoUrl`) é preenchido pelo sistema; não é informado no cadastro nem na edição da pessoa.
- Enviar uma nova foto substitui a anterior, que é apagada. A foto também pode ser removida.
- A exclusão (lógica) da pessoa mantém a foto.

## Contatos e endereços

- Contatos e endereços pertencem a exatamente um dono: uma empresa ou uma pessoa, nunca ambos.
- O dono precisa ser a empresa do usuário ou uma pessoa dela; caso contrário, responde 404.
- O dono é definido na criação e não pode ser alterado.
- Usuários só acessam contatos e endereços da própria empresa e de suas pessoas.
- Contatos e endereços de uma pessoa excluída deixam de ser acessíveis junto com ela.
- Um contato deve ter ao menos um meio de contato: telefone e/ou e-mail. Uma edição não pode remover o último deles.
- Cada dono tem no máximo um contato principal e um endereço principal (`isPrincipal`), considerando apenas os registros não excluídos.
- Marcar um contato ou endereço como principal desmarca automaticamente o principal anterior do mesmo dono.
- Excluir o principal não promove outro: o dono fica sem principal até que um seja marcado.
- A listagem de pessoas traz o contato principal de cada uma (`principalContact`); o detalhe da pessoa traz também o endereço principal (`principalAddress`). Sem principal marcado, o campo vem `null`.

## Unicidade

- São únicos:
  - o documento (CPF ou CNPJ) e o subdomínio da empresa;
  - entre os registros não excluídos, o e-mail do usuário;
  - entre os registros não excluídos, o documento da pessoa dentro da mesma empresa, quando informado.
- E-mails e documentos de registros excluídos podem ser reutilizados.

## Serviços

- Um serviço pertence à empresa do usuário que o cadastrou; a empresa não é informada no payload.
- O nome do serviço é único entre os serviços não excluídos da mesma empresa.
- A duração é informada em minutos e é o que define o fim dos agendamentos desse serviço.
- Serviços inativos não podem ser usados em novos agendamentos nem em recorrências.
- A cor (`color`), quando informada, deve ser uma string hexadecimal válida (`#RGB` ou `#RRGGBB`).
- O serviço pode aceitar atendimento em turma (`allowsClasses`, padrão: não aceita). Um serviço com turma ativa não pode deixar de aceitar turma (409): as turmas precisam ser inativadas antes.
- Um serviço só pode ser excluído se não tiver nenhum relacionamento: agendamentos, agendamentos recorrentes, itens de plano ou turmas. Contam todos os registros, inclusive cancelados ou encerrados, porque o histórico precisa continuar apontando para o serviço.
- Com relacionamento, a exclusão é recusada (409), nada é alterado, e o caminho é inativar o serviço (`isActive` falso). Serviço inexistente ou de outra empresa responde 404.
- Um plano não é excluído (só inativado), e os serviços de um plano editado deixam de ser seus itens: por isso um serviço que consta na composição de qualquer plano, ativo ou não, não pode ser excluído.
- **Comissão** (2026-11-10, etapa 1 da comissão): o serviço pode ter a comissão do profissional por atendimento, em `commissionType` (`PERCENT`, do valor cobrado, de 0,01 a 100; ou `FIXED`, valor por atendimento, maior que zero, até duas casas) e `commissionValue`. Os dois andam juntos: tipo sem valor ou valor sem tipo é 400; `commissionType: null` tira a comissão (o valor sai junto); na alteração, o que não for enviado vem do que está gravado. Serviço sem comissão não gera comissão. **Só o ADMIN** define (os demais recebem 403 ao enviar esses campos) e vê (as respostas de serviço não trazem os dois campos para os demais). A comissão vale do momento em que for definida em diante: atendimentos concluídos antes não geram comissão.

## Agendamentos

- Um agendamento pertence à empresa do usuário, e cliente, profissional e serviço precisam ser dessa mesma empresa.
- O `clientId` precisa ser uma pessoa do tipo `CLIENT`, e o `professionalId`, do tipo `PROFESSIONAL`.
- O fim (`endAt`) é sempre calculado somando a duração do serviço ao início; não é aceito no payload.
- Não pode haver sobreposição de horário para o mesmo profissional nem para o mesmo cliente. Horários que apenas se encostam (fim de um igual ao início do outro) são permitidos.
- Agendamentos cancelados não ocupam horário e liberam a agenda.
- Não há exclusão de agendamento: o ciclo de vida é controlado pelo status (`SCHEDULED`, `CONFIRMED`, `COMPLETED`, `CANCELLED`, `NO_SHOW`), e um agendamento novo começa como `SCHEDULED`.
- Não é possível agendar em data e hora que já passaram, nem remarcar um agendamento para o passado. Alterar status ou observação de um agendamento já realizado continua permitido, exceto cancelá-lo e exceto quando ele está concluído com pagamento (a única mudança que esse caso admite é marcar a falta, enquanto o pagamento não foi recebido).
- Um agendamento só pode ser cancelado antes de iniciar: em `SCHEDULED` ou `CONFIRMED` e com início ainda no futuro. Vale o horário, e não só o status, porque o status é atualizado periodicamente e um agendamento que já começou pode ainda constar como agendado ou confirmado.
- Não podem ser cancelados: o que já iniciou ("Agendamento que já iniciou não pode ser cancelado"), o concluído, aquele em que o cliente não compareceu e o já cancelado. Nesses casos nada é alterado. A regra vale também quando o cancelamento vem junto com outras alterações, considerando o estado do agendamento antes delas. Se o agendamento mudar de situação entre a leitura e a gravação (ex.: o job de status o inicia no mesmo instante), o cancelamento é recusado com 409 e nada é alterado.
- Ao cancelar um agendamento avulso, o pagamento dele ainda `PENDING` também é cancelado; o pagamento `PAID` não muda (não há reembolso).
- Um agendamento concluído que tem pagamento (pendente ou pago) não sofre mais nenhuma alteração: nem observação, nem status, nem serviço, cliente ou horário (400). O pagamento foi gerado a partir dele, e mudar o agendamento o deixaria divergente. Pagamento cancelado ou excluído libera a edição. Agendamento de plano não tem pagamento próprio e não é travado por esta regra. Exceção: marcar a falta (`NO_SHOW`), que vale enquanto não houver pagamento recebido e cancela o pendente (ver "Falta").
- `CANCELLED` é o estado final do agendamento: um agendamento cancelado não volta a nenhum outro status (400). Para marcar de novo, cria-se outro agendamento. A observação de um cancelado continua editável.
- **Falta (`NO_SHOW`: o cliente não compareceu) não cobra e é definitiva.** Marcada pelo `PATCH /appointments/:id` com `status: NO_SHOW`:
  - só se marca o que **já iniciou** (vale o horário, e não só o status, porque o job de status roda a cada 5 minutos); antes disso, 400 ("Só se marca falta de atendimento que já iniciou");
  - vale também depois de **concluído**, que é quando a recepção costuma anotá-la (o job de cobrança gera o pagamento até 5 minutos depois da conclusão, e o travamento por pagamento não se aplica a esta mudança);
  - o pagamento **pendente** do agendamento é **cancelado** na mesma transação (a falta não cobra); o pagamento já **recebido** (`PAID`) impede a falta (400, "Agendamento com pagamento recebido não pode ser marcado como falta"), porque não há reembolso;
  - só o status (e a observação) mudam: junto com cliente, profissional, serviço ou horário, 400;
  - a falta é **estado final**, como o cancelamento: não volta a nenhum outro status (400) nem é cancelada. A observação continua editável. O job de cobrança só gera pagamento para o `COMPLETED`, então a falta não gera pagamento. A sessão de pacote tem a reposição (ver Planos), que é um caminho próprio e não passa por este `PATCH`;
  - vale para agendamento avulso e para sessão de recorrência (cujo pagamento pendente nasce com a recorrência); a sessão de pacote não tem pagamento próprio.
- O agendamento precisa caber inteiro em uma janela de atendimento da empresa (ver "Horário de funcionamento"), exceto quando é um encaixe autorizado. Cancelar um agendamento não passa por essa verificação.
- Toda resposta de agendamento (listagem, consulta, criação e alteração) traz, além dos códigos, o cliente e o profissional (`id`, `name`, `photoUrl`) e o serviço (`id`, `name`, `color`, `duration`), e nenhum outro dado deles. Traz também a origem (`recurringAppointment`: `id` e `clientPlanId`) e a situação do pagamento (`payment`: só `status` e `deletedAt`, ou `null` quando não há; a sessão de pacote não tem pagamento próprio), que a tela usa para não oferecer a falta de quem já pagou. E a sessão da turma (`classSession`: `id`, `classGroupId` e `capacity`, ou `null` fora de turma).
- Uma pessoa ou serviço excluídos depois continuam aparecendo com o nome nos agendamentos que já os usavam: o histórico não perde o nome.
- A listagem é ordenada pelo início do agendamento, do mais antigo para o mais novo; com `order=desc`, do mais novo para o mais antigo (ex.: atendimentos anteriores do cliente). Horários iguais seguem uma ordem fixa, na mesma direção, para a paginação não repetir nem perder registros.
- A resposta do agendamento informa a origem: `recurringAppointment` com o `id` da recorrência e o `clientPlanId` (preenchido quando ela é de um pacote), ou nulo no agendamento avulso.
- A listagem de agendamentos pode ser filtrada por recorrência (as sessões de uma recorrência ou de um pacote), mantendo a ordem, a paginação e o escopo da empresa. Sem o filtro, nada muda.
- A agenda de um dia usa o período `from` e `to` (início incluído, fim excluído) com instantes em UTC: o início do dia e o início do dia seguinte, no fuso da empresa.

## Fuso horário

- Cada empresa tem um fuso (`timezone`, padrão `America/Sao_Paulo`).
- Todos os instantes são gravados em UTC. O fuso é usado para interpretar horários "de relógio": janelas de atendimento e horários reservados por recorrências.
- Datas puras, como início e fim de uma recorrência, valem pelo calendário e não sofrem conversão de fuso.

## Horário de funcionamento

- Cada empresa define janelas de atendimento por dia da semana, e pode ter mais de uma no mesmo dia (ex.: manhã e tarde), desde que não se sobreponham.
- Dias sem janela cadastrada são considerados fechados.
- Enquanto a empresa não cadastrar nenhuma janela, o horário não é restringido: a regra passa a valer a partir do primeiro cadastro.
- Um atendimento precisa começar e terminar dentro da mesma janela.
- `POST /business-hours/batch` cadastra várias janelas de uma vez (ex.: a semana inteira no setup da empresa). É tudo ou nada: valem as mesmas regras do cadastro individual, tanto contra janelas já existentes quanto entre os itens do próprio lote.
- Encaixe de agendamentos:
  - O expediente do dia são as janelas de atendimento cadastradas. Estar "fora do funcionamento" é não caber inteiro em uma janela, e inclui antes da abertura, depois do fechamento, dias sem janela e o intervalo entre duas janelas (almoço, por exemplo). O intervalo não tem regra própria: é só um horário fora de qualquer janela.
  - Agendamentos sem recorrência podem ser feitos nos horários em que a empresa estiver fechada, inclusive em dias sem janela e no intervalo entre janelas.
  - Um atendimento que começa dentro de uma janela e termina fora dela (ex.: 17:30 às 18:30, com fechamento às 18:00) também não cabe em uma janela: com a autorização, é marcado como encaixe.
  - O encaixe precisa ser autorizado no pedido (`overBooking: true`). Sem a autorização, um horário fora do funcionamento continua recusado, para um erro de horário não virar encaixe sem ninguém perceber.
  - O agendamento registra se é encaixe (`overBooking`). O valor registrado é o real: um pedido autorizado em horário dentro do funcionamento não fica marcado como encaixe.
  - O registro é o retrato do momento em que o agendamento foi marcado: mudar depois o horário de funcionamento não o altera.
  - **Marcações simultâneas:** a criação de um agendamento avulso (pela clínica ou pelo portal) trava o profissional até gravar (advisory lock do Postgres por profissional): duas marcações no mesmo horário ao mesmo tempo não passam juntas; a segunda é recusada pelo conflito. Edição, recorrência e contratação ainda não têm essa trava (ver `technical-debt.md`).
- O encaixe libera só o horário de funcionamento: continuam valendo a ausência de conflito para cliente e profissional e a proibição de horário no passado.
  - Ao remarcar um agendamento (mudar horário ou serviço), o encaixe é reavaliado: levar para fora do funcionamento exige a mesma autorização, e trazer de volta para dentro desfaz a marcação. Mudar só status ou observação não altera a marcação.
  - Enquanto a empresa não cadastrar nenhuma janela, nada é restringido e não há encaixe.
  - **Encaixe sobre uma turma:** com a autorização (`overBooking: true`), o atendimento avulso também pode ser marcado no horário de uma sessão de turma do profissional, dividindo o horário com ela, **sem ocupar vaga**. Vale para qualquer serviço (ex.: uma massagem enquanto a turma de pilates treina). O `overBooking` registrado é `true` quando o horário está fora do funcionamento **ou** sobre uma sessão de turma do profissional. Sem a autorização, a turma continua conflitando com o profissional.
  - Agendamentos de recorrência e de plano, inclusive o remanejamento deles, não têm encaixe: continuam precisando caber em uma janela.
- **Horário bloqueado** na agenda conta como fora do funcionamento (ver "Bloqueio de horários").

## Bloqueio de horários

> **Estado:** desde 2026-11-09. Bloqueio da empresa toda (não por profissional).

- A clínica bloqueia um intervalo de **um dia** da agenda (ex.: um treinamento, uma reforma). O horário bloqueado **conta como fora do funcionamento**, mesmo na empresa que ainda não cadastrou janelas:
  - o agendamento avulso é recusado sem a autorização de encaixe (400 "O horário está bloqueado na agenda. Para agendar mesmo assim, envie overBooking: true (encaixe)"); **com o encaixe, entra**, marcado como `overBooking`;
  - recorrência, plano (criar, remanejar, repor) e turma (encaixe de alunos) não têm encaixe: são recusados ("O horário está bloqueado na agenda"). Como no horário fora do funcionamento, a recorrência que cai num dia bloqueado é recusada **inteira**, com a data do problema;
  - no **portal**, o horário sai da lista de livres de todos os profissionais;
  - quem encosta no bloqueio conta: um atendimento das 09:30 às 10:30 encosta num bloqueio das 10:00 às 11:00.
- **Agendamentos que já existem** no horário continuam marcados. Bloquear um horário com agendamentos pede confirmação: sem `confirmed: true`, a API responde **409** com `code: AGENDA_BLOCK_HAS_APPOINTMENTS`, `appointments` (quantos) e a mensagem "Há N agendamentos neste horário. Eles continuam marcados." (cancelados não contam).
- Rotas (funcionalidade `appointments`: ler = Visualiza, bloquear = Cria, desbloquear = Exclui):
  - `GET /agenda-blocks?from=&to=` (AAAA-MM-DD no relógio da empresa, as duas pontas incluídas; sem `from`, de hoje em diante): `id`, `startAt`, `endAt`, `createdAt` e `createdBy.name`, do mais cedo ao mais tarde;
  - `POST /agenda-blocks` (`date`, `startTime` e `endTime` em HH:MM no relógio da empresa, `confirmed` opcional): fim antes do início, data inexistente ou horário que já começou: 400; sobreposto a outro bloqueio: 409. Devolve o bloqueio e `appointments`;
  - `DELETE /agenda-blocks/:id` (204): desbloqueia (apaga o registro). Bloqueio que já terminou: 400; de outra empresa: 404.
- Bloquear e desbloquear ficam na **auditoria** (`AGENDA_BLOCK_CREATED` e `AGENDA_BLOCK_REMOVED`, `entityType` `AGENDA_BLOCK`).

## Agendamentos recorrentes

- Valem as mesmas regras de empresa, tipos de pessoa e serviço ativo dos agendamentos.
- A recorrência precisa de ao menos um dia; cada dia tem dia da semana, horário inicial e final, e o fim deve ser posterior ao início.
- Dois dias da mesma recorrência não podem se sobrepor no mesmo dia da semana.
- A data final é obrigatória e não pode ser anterior à inicial.
- Não há limite de duração entre a data inicial e a final (ex.: uma recorrência de um ano); o prazo é definido por quem cria a recorrência. A data final não pode ser anterior à inicial.
- Todos os agendamentos e pagamentos do período são gerados na criação: uma recorrência longa gera muitos registros de uma vez.
- Informar a lista de dias em uma edição substitui todos os dias anteriores.
- Não há exclusão: a recorrência é desativada por `isActive`.
- Cada dia precisa reservar ao menos a duração do serviço, que é o que define o fim dos agendamentos gerados.

### Geração de agendamentos

- Ao criar uma recorrência ativa, os agendamentos são gerados até a data final. Ocorrências no passado não são geradas.
- Os agendamentos gerados seguem todas as regras de um agendamento avulso: janela de atendimento e ausência de conflito para cliente e profissional.
- A criação é tudo ou nada: se qualquer ocorrência conflitar, a recorrência não é criada.
- O erro informa a data e o horário, no fuso da empresa, da ocorrência que impediu a criação (a primeira encontrada), seja conflito de agenda do profissional ou do cliente, seja horário fora do funcionamento. Ex.: "Conflito em 28/10/2026 às 09:00: O profissional já possui um agendamento neste horário". Vale também na contratação de plano, que cria as agendas da mesma forma.
- Toda resposta de recorrência (listagem, consulta, criação e edição) traz, além dos códigos, o cliente e o profissional (`id`, `name`, `photoUrl`), o serviço (`id`, `name`, `color`, `duration`), o `clientPlanId` (preenchido quando a recorrência é de um pacote) e o `classGroupId` (preenchido quando ela está encaixada numa turma). Pessoa ou serviço excluídos depois continuam aparecendo com o nome.
- A agenda de uma recorrência não é regenerada. Para mudar dias, período, serviço, cliente ou profissional, encerra-se a recorrência e cria-se outra.
- Alterar apenas a observação não mexe na agenda.
- Cancelar a recorrência (`isActive` = falso) cancela os agendamentos futuros em `SCHEDULED` ou `CONFIRMED`, sem gerar novos, e seus pagamentos `PENDING` passam para `CANCELLED` (ver Cancelamento). Uma recorrência cancelada não é reativada.

### Valor e pagamento

- O valor de cada agendamento é o preço vigente do serviço no momento da criação da recorrência. Não há descontos.
- Um serviço sem preço não pode ser usado em uma recorrência.
- A recorrência não é fidelização nem pacote.
- Cada agendamento gerado tem um pagamento `PENDING`, com vencimento na data do agendamento.
- O cliente pode optar por pagar integralmente a recorrência, somente na contratação e sem desconto. Os pagamentos continuam nascendo `PENDING`; a baixa para `PAID` é feita pagamento a pagamento ou de uma vez, em lote, com o mesmo método de pagamento.

### Remanejamento

- O cliente pode remanejar agendamentos da recorrência para outros dias e horários. Remanejar é remarcar o mesmo agendamento, que mantém seu pagamento.
- Remanejar só é permitido desde que:
  - a quantidade de serviços contratados seja mantida;
  - a nova data, no calendário da empresa, fique entre a data inicial e a final da recorrência;
  - haja dia e horário disponíveis, pelas regras de agendamento.
- Só agendamentos `SCHEDULED` ou `CONFIRMED` que ainda não iniciaram (início no futuro) podem ser remanejados, e o status não muda. Vale o horário, e não só o status, porque o status é atualizado periodicamente. Uma recorrência cancelada não tem agendamentos remanejados.
- Data, serviço, cliente e profissional de um agendamento de recorrência não mudam pela edição comum do agendamento; data e horário mudam só pelo remanejamento. Observação e os demais status continuam editáveis.
- Se o pagamento do agendamento estiver `PENDING`, o vencimento passa para a nova data.
- Remanejar não gera nova cobrança nem reembolso.
- Remanejar (inclusive a reposição de uma falta de pacote) uma sessão de turma **tira o aluno da sessão**: o agendamento vai para o novo horário como atendimento individual e a vaga fica livre (ver "Turmas").

### Cancelamento

- Um único agendamento da recorrência pode ser cancelado pela própria recorrência, com a mesma regra do agendamento avulso: só antes de iniciar (`SCHEDULED` ou `CONFIRMED` com início no futuro). O horário fica livre e o pagamento `PENDING` dele passa para `CANCELLED`. Pagamento já pago não muda. Esse cancelamento não é feito pela edição comum do agendamento.
- Cancelar a recorrência não gera reembolso de pagamentos já pagos.
- Os pagamentos `PENDING` dos agendamentos futuros cancelados passam para `CANCELLED`.
- Após o cancelamento, as novas datas negociadas diretamente com a empresa passam a ser agendamentos avulsos.

## Planos

### Catálogo de planos

- Um plano pertence à empresa do usuário que o cadastrou; a empresa não é informada no payload.
- O nome do plano é único entre os planos da mesma empresa.
- Um plano é o pacote de serviços; os períodos (ex.: 3, 6 ou 12 meses) são opções de contratação do mesmo plano.
- Um plano é composto por um ou mais serviços da própria empresa, ativos no momento do cadastro ou da edição.
- Um serviço não pode aparecer mais de uma vez no mesmo plano.
- Cada serviço do plano define `sessionsPerWeek`, a quantidade de atendimentos por semana (inteiro de 1 a 7, obrigatório). O cadastro e a edição recebem `services: [{ serviceId, sessionsPerWeek }]`.
- Os serviços e os períodos de um plano podem ser editados; a lista informada substitui a anterior. Contratações já feitas não mudam.
- O valor mensal do plano (`monthlyPrice`) é definido pela empresa no cadastro e não depende dos preços dos serviços.
- Não há exclusão: o plano é desativado por `isActive` e pode ser reativado.
- Planos inativos não podem ser contratados.
- Um plano pode ser cadastrado sem períodos, mas só pode ser contratado se tiver ao menos um.
- Um plano com algum serviço inativo não pode ser contratado.

### Descontos por período

- Cada plano define, por período (ex.: 3, 6 ou 12 meses), dois percentuais fixos de desconto, ambos obrigatórios:
  - `discountPercent`: para pagamento integral (uma única cobrança do total do período);
  - `monthlyDiscountPercent`: para pagamento mensal.
- O número de meses é inteiro, a partir de 1, e não se repete no mesmo plano.
- Os percentuais vão de 0 a 100, com até duas casas decimais.
- No pagamento integral, o total do período é o valor mensal × número de meses, com `discountPercent` aplicado.
- No pagamento mensal, cada parcela é o valor mensal com `monthlyDiscountPercent` aplicado, e o total é a parcela × número de meses.
- Os valores são arredondados para duas casas decimais, com a metade arredondada para cima. No mensal, a parcela é arredondada antes de calcular o total, para que a soma das parcelas feche com o total.
- Alterar os percentuais de um plano não altera contratações já feitas.

### Serviços e horários

- Cada serviço do plano tem seus próprios dias, horários e profissional, informados na contratação. A contratação informa exatamente os serviços do plano, nem mais nem menos.
- A agenda de cada serviço precisa ter exatamente `sessionsPerWeek` horários por semana (cada item de `days` é um atendimento semanal; o mesmo dia pode ter dois horários que não se sobrepõem). Quantidade diferente é recusada (400), com a mensagem indicando o serviço e a quantidade prevista.
- A frequência vale só no momento da contratação: as recorrências guardam os dias, então alterar o plano depois não muda contratações já feitas.
- Cada serviço gera uma recorrência própria, com o período da contratação. Seus agendamentos seguem todas as regras de agendamentos recorrentes.
- Os agendamentos de um plano podem ser remanejados dentro do período da contratação, e um agendamento pode ser cancelado individualmente; a sessão cancelada não é reposta.
- Reposição por falta: quando o cliente não comparece a uma sessão do plano e a empresa a marca como `NO_SHOW`, a sessão pode ser remanejada para uma nova data dentro do período da contratação, desde que haja horário disponível (funcionamento da empresa, sem conflito). Ela volta a `SCHEDULED` e a quantidade de sessões do plano se mantém; o registro da falta deixa de existir, porque é a mesma sessão que muda de data. Só sessões `NO_SHOW` entram: concluídas e em andamento continuam não podendo ser remanejadas. A regra vale só para pacotes; recorrências avulsas seguem remanejando apenas antes de iniciar.
- A recorrência de um serviço do plano não é encerrada isoladamente: o encerramento acontece pelo cancelamento da contratação.

### Contratação

- Só podem ser contratados planos ativos, com o período escolhido cadastrado e com todos os serviços ativos. O cliente precisa ser do tipo `CLIENT`.
- Ao contratar um plano, são definidos a modalidade de pagamento (integral ou mensal) e o número de meses, que precisa corresponder a um período do plano. São congelados o valor mensal, o percentual de desconto aplicado conforme a modalidade e o total do período.
- A data de início é, por padrão, a data atual no fuso da empresa. Pode ser futura, mas não passada. A agenda nunca começa antes dela, inclusive à noite, quando em UTC já é o dia seguinte.
- A data final é a data de início somada ao número de meses, menos um dia (ex.: 3 meses a partir de 15/10 terminam em 14/01).
- A contratação, as recorrências dos serviços e os pagamentos são criados juntos: se qualquer horário conflitar, nada é gravado.
- Alterar preços de serviços ou o plano depois da contratação não altera o valor da contratação.
- Ao fim do período contratado, a continuidade exige uma nova contratação, como nas recorrências.

### Consulta das contratações

- As respostas de contratação (listagem, consulta, criação e cancelamento) trazem o cliente (`id`, `name`, `photoUrl`), o plano (`id`, `name`) e, em cada recorrência, o serviço, o profissional, os dias (`weekDay`, `startTime`, `endTime` em HH:MM), `isActive` e `classGroupId` (a turma em que o serviço está encaixado, ou `null`). Os ids continuam planos. Cliente, plano, serviço ou profissional excluídos ou inativados depois continuam aparecendo com o nome.
- A listagem aceita o filtro opcional `status`, com "hoje" no fuso da empresa: `active` (não cancelada e com data final de hoje em diante, inclusive as que ainda vão começar), `cancelled` (com data de cancelamento) e `ended` (não cancelada e com data final anterior a hoje). Sem o filtro, todas são listadas.
- A listagem vem da contratação mais recente para a mais antiga (data de criação decrescente).

### Troca de serviços

- O plano fecha o contrato com os serviços contratados: não há troca de serviço durante a contratação.

### Pagamento da contratação

- A contratação tem uma modalidade: **integral** ou **mensal**.
- Na modalidade integral, é gerado um único pagamento com o valor total do período. O sistema registra apenas esse valor total, sem o número de parcelas nem os juros do cartão. O meio de pagamento (ex.: cartão) é um método de pagamento da empresa.
- Na modalidade mensal, é gerado um pagamento por mês contratado, cada um com o valor da parcela.
- Os pagamentos de uma contratação pertencem à contratação, não a um agendamento.
- O vencimento é definido na contratação por uma data de primeiro vencimento, obrigatória no mensal e opcional no integral. No integral, é o vencimento do pagamento único; no mensal, é o da primeira parcela, e as seguintes vencem no mesmo dia dos meses seguintes. Quando o dia não existe no mês, vale o último dia do mês. No integral sem essa data, o pagamento fica sem vencimento.
- Os pagamentos da contratação nascem `PENDING` e sem método de pagamento; a baixa para `PAID` é manual.
- Um pagamento pendente cujo vencimento é anterior à data atual, no fuso da empresa, consta como **atrasado**. O status do pagamento continua `PENDING` até ser pago.

### Cancelamento da contratação

- O cancelamento não gera multa nem reembolso, em qualquer modalidade.
- A contratação cancelada registra a data do cancelamento e não pode ser cancelada de novo (também quando dois cancelamentos chegam ao mesmo tempo: só o primeiro vale). Uma contratação cujo período já terminou não pode ser cancelada.
- Ao cancelar a contratação, as recorrências de todos os serviços do plano são encerradas, e os agendamentos futuros em `SCHEDULED` ou `CONFIRMED` passam para `CANCELLED`; os horários voltam a ficar disponíveis.
- Na modalidade mensal, as parcelas `PENDING` com vencimento na data do cancelamento ou depois passam para `CANCELLED`. As parcelas atrasadas continuam `PENDING`, e as pagas não mudam.
- Na modalidade integral, o pagamento não muda: ele é feito no ato da contratação.

## Notificações

- São avisos por empresa, criados e resolvidos pela própria API; não são criadas nem excluídas pelo cliente.
- Uma notificação pode ser marcada como lida. Ao ser resolvida, sai da lista padrão, mas continua no histórico.

## Pagamentos

- Cada agendamento tem no máximo um pagamento. Excluir o pagamento libera o agendamento para um novo.
- O pagamento pertence à empresa do usuário, assim como o agendamento e o método de pagamento. O agendamento não muda depois da criação.
- Todo pagamento pertence a um agendamento ou a uma contratação de plano, nunca aos dois.
- Um pagamento gerado pelo sistema nasce como `PENDING` e sem método de pagamento; a baixa para `PAID` é manual.
- O método de pagamento é opcional enquanto o pagamento não está `PAID`, e obrigatório quando está.
- Quando o valor não é informado, assume o preço do serviço do agendamento. Se o serviço não tiver preço, o valor passa a ser obrigatório. Valores diferentes do preço continuam permitidos.
- `paidAt` é obrigatório quando o status é `PAID` e recusado nos demais status. Sair de `PAID` limpa a data.
- O nome do método de pagamento é único entre os métodos não excluídos da mesma empresa, sem diferenciar maiúsculas nem acentos ("PIX" e "Pix" são o mesmo método).
- A exclusão do método de pagamento é lógica (inativação). A listagem (`GET /payment-methods`) traz ativos e inativos; com `isActive=true`, só os ativos (ex.: escolher o método na baixa de um pagamento). Consultar, alterar, excluir e usar na baixa valem só para ativos.
- Um método inativado pode ser reativado por `PATCH /payment-methods/:id/restore` (limpa o `deletedAt`). Reativar um método já ativo responde 409; se o nome estiver em uso por outro método ativo da empresa, também responde 409.
- A listagem de pagamentos (`GET /payments`) traz a origem de cada um, para a tela descrevê-lo: o atendimento (`appointment`, com a data, o serviço e o `recurringAppointmentId`, nulo no avulso) ou a contratação (`clientPlan`, com o nome do plano e a modalidade `billingType`). Traz também o cliente (`client`: o do atendimento ou o da contratação) e o método de pagamento (`paymentMethod`, preenchido quando pago). Cliente, serviço e plano são lidos pela chave, sem filtrar exclusão: o nome continua aparecendo depois de inativados. A ordem é o vencimento crescente, com os sem vencimento no fim, e os filtros combinam entre si (ex.: `status=PENDING&overdue=true`).
- `GET /payments/summary` devolve os totais da tela de Pagamentos, cada um com `total` (texto com duas casas) e `count`: `overdue` (pendentes com vencimento antes de hoje, no fuso da empresa), `upcoming` (pendentes com vencimento de hoje em diante ou sem vencimento) e `paid` (pagos). Cancelados e excluídos ficam de fora. Só `clientId`, `dueFrom` e `dueTo` filtram; `status` e os demais filtros da listagem são recusados (400). Com período, os três usam o vencimento nele (inclusive os pagos) e o pagamento sem vencimento não entra.
- A baixa (`PATCH /payments/settle` e a baixa em lote da recorrência) e a criação de um pagamento (`POST /payments`) não aceitam `paidAt` no futuro (400, comparando com o instante da requisição). Data passada é aceita, para lançar uma baixa esquecida. A edição de um pagamento (`PATCH /payments/:id`) não tem essa checagem.
- Quando um agendamento avulso (não gerado por recorrência ou contratação de plano) passa para o status `COMPLETED`, gera um novo pagamento como `PENDING` para aquele agendamento, seja a conclusão feita pelo job de status ou manualmente.
- Cancelar um agendamento avulso cancela o pagamento `PENDING` dele (ex.: um sinal lançado antes do atendimento); o `PAID` não muda.
- Não é possível registrar pagamento para um agendamento cancelado (409): não há atendimento a cobrar.
- Não é possível registrar pagamento para uma sessão de pacote (409): ela já é cobrada pela contratação. Agendamento de recorrência avulsa continua aceitando um novo pagamento quando o anterior foi excluído.
- `CANCELLED` é o estado final do pagamento: um pagamento cancelado não volta a `PENDING` nem vai para `PAID` (409). Repetir `CANCELLED` é aceito, sem efeito, e os demais campos (ex.: valor) continuam editáveis.
  - O pagamento é gerado por um job de cobrança, que roda periodicamente; pode haver alguns minutos entre a conclusão e o pagamento.
  - O valor é o preço do serviço, e o vencimento é a data do agendamento no fuso da empresa.
  - Serviço sem preço é considerado gratuito e não gera pagamento.
  - Um agendamento que já teve pagamento, inclusive excluído, não gera outro.
- Agendamentos gerados por recorrência já nascem com pagamento `PENDING`, com vencimento na data do agendamento, e não geram novo pagamento ao serem concluídos (ver Agendamentos recorrentes).
- Agendamentos gerados por contratação de plano não geram pagamento por agendamento: os pagamentos pertencem à contratação (ver Planos).
  - Esses pagamentos deverão ser registrados como `PENDING`, onde deverá ser alterado manualmente para `PAID` quando este for pago;

### Comandas do dia (Financeiro)

- `GET /payments/checkouts` lista as comandas do dia, uma por cliente, a partir das visitas. "Dia" é hoje no fuso da empresa.
- Tem comanda o cliente que tem um atendimento que começa hoje em `SCHEDULED`, `CONFIRMED`, `IN_PROGRESS` ou `COMPLETED` (cancelado e não comparecimento ficam de fora), ou que tem algum pagamento `PAID` com `paidAt` hoje (a comanda paga continua na lista). Cliente só com pendência, sem atendimento nem pagamento hoje, não entra. Pessoa inativada continua aparecendo.
- A paginação é por cliente, em ordem alfabética, e `search` filtra pelo nome do cliente sem diferenciar acentos nem maiúsculas.
- Cada comanda traz: `appointments` (os atendimentos de hoje, por horário, com serviço, profissional, `recurringAppointmentId`, `clientPlanId` quando é sessão de pacote e `payment`, que é o pagamento do atendimento ou `null` quando ainda não existe, como na sessão de pacote); `previousPayments` (pagamentos do cliente, de atendimento ou de contratação, que não são dos atendimentos listados: `PENDING` com vencimento até hoje, inclusive; `PENDING` de contratação integral sem vencimento; e `PAID` hoje, por vencimento crescente e sem vencimento por último, cada um com a origem); e os totais em texto com duas casas.
- Totais: `todayPending` (pendentes dos atendimentos de hoje), `previousPending` (pendentes dos anteriores) e `paidToday` (pagos hoje, nas duas listas). Um atendimento de hoje já pago em outro dia aparece com o pagamento pago, mas não entra em nenhum total. Pagamentos `CANCELLED` e excluídos nunca entram em lista nem total.
- `PATCH /payments/settle` dá baixa nos pagamentos escolhidos (`paymentIds`, ao menos um, sem repetir), com um `paymentMethodId` e `paidAt` opcional (padrão: o momento da requisição), tudo numa só transação. Todos precisam ser da empresa, não excluídos, `PENDING` e do mesmo cliente: inexistente (pagamento ou método) responde 404, algum fora de `PENDING` responde 409 e clientes diferentes respondem 400. O método precisa existir (não excluído) na empresa.
- **Receber antes da conclusão** (desde 2026-11-09): a mesma baixa aceita `appointmentIds` (atendimentos avulsos ainda sem pagamento; `paymentIds` e `appointmentIds` somam ao menos um item, senão 400). Cada atendimento ganha, na mesma transação, um pagamento já `PAID` com o **preço do serviço**, o método e a data da baixa e o vencimento no dia local do atendimento. O job de conclusão não cobra de novo (só gera para atendimento sem pagamento). Recusa: atendimento inexistente na empresa (404); cancelado ou com falta, sessão de pacote ou já com pagamento ativo (409); serviço sem preço (400, o valor é lançado depois da conclusão); cliente diferente dos demais itens (400). Valor inteiro só: sinal parcial exigiria mais de um pagamento por atendimento. Recebido antes, o atendimento segue as regras de pago: cancelar não devolve (não há reembolso) e a falta é recusada. Na comanda, `appointments[].service` traz também o `price`.

## Carteira de clientes

> **Estado:** backend em 2026-11-09 (Relatórios → Carteira de clientes). Funcionalidade `client-portfolio`, só Visualiza, **marcada no modelo padrão** de empresa nova (desde 2026-11-09); as empresas existentes não ganharam linha (liberar em Acessos e limites).

- Relatório só de leitura, **por profissional**, só do **ADMIN** (mostra o faturamento): quais clientes ele atende e como está cada um. Tudo sai dos agendamentos e pagamentos; não há "profissional responsável" no cadastro.
- **Na carteira:** cliente **ativo** (não inativado) com ao menos um agendamento **não cancelado** com o profissional (avulso, recorrência, pacote ou turma). Um cliente pode estar na carteira de vários profissionais. Profissional inexistente, de outra empresa ou que não é profissional: 404.
- **Período:** `from` e `to` em dias do fuso da empresa (AAAA-MM-DD, pontas incluídas); sem eles, o mês atual. Fim antes do início: 400.
- **Situação** (uma só, nesta ordem):
  - `NEW` (Novo): o **primeiro** atendimento `COMPLETED` com o profissional caiu no período;
  - `ACTIVE` (Ativo): atendimento `COMPLETED` nos últimos **60 dias** ou agendamento futuro (`SCHEDULED`/`CONFIRMED`, começando de agora em diante) com o profissional;
  - `LAPSED` (Sem retorno): nenhum dos dois. Inclui quem nunca concluiu e não tem nada marcado.
  - Novo vale para o período; Ativo e Sem retorno, para hoje. Os 60 dias são fixos (sem configuração por empresa).
- `GET /client-portfolio?professionalId=&from=&to=` (resumo): `clients`, `newClients`, `lapsedClients`; `completed` (atendimentos `COMPLETED` no período) e, deles, `packageSessions` (sessões de pacote, contadas **sem valor**: o pagamento é da contratação; o rateio por sessão fica para a comissão); `received` e `pending` (pagamentos `PAID` e `PENDING`, não excluídos, dos concluídos no período); `averageTicket` = (recebido + pendente) ÷ quantidade desses pagamentos, ou `null` sem nenhum. Valores em texto com duas casas. `series`: o gráfico do período, `unit` `day` (até 62 dias) ou `week` (acima disso, semanas de 7 dias contadas do início do período, a última podendo ser menor) e `points` com todos os intervalos, inclusive os vazios: `date` (primeiro dia do intervalo, AAAA-MM-DD no fuso da empresa), `completed`, `received` e `pending`, pelo dia do atendimento.
- `GET /client-portfolio/clients` (mesmos filtros, mais `status`, `search` pelo nome sem acentos nem caixa, `page` e `limit` até 100): cada item traz `id`, `name`, `photoUrl`, `phone` (do contato principal), `status`, `lastCompleted` (`startAt` e `serviceName` do último concluído, ou `null`), `nextAt` (próximo agendamento futuro, ou `null`), `completedInPeriod` e `pending` (pagamentos `PENDING` dos agendamentos não cancelados do cliente com o profissional, **qualquer vencimento**).
- **Ordem da lista:** quem precisa de contato primeiro: sem atendimento concluído e sem nada marcado; depois pelo último atendimento, do mais antigo ao mais recente; quem só tem agendamento futuro, por último. Empate: nome.

## Contas a receber

> **Estado:** backend em 2026-11-09 (Relatórios → Contas a receber). Funcionalidade `receivables`, só Visualiza, **marcada no modelo padrão** de empresa nova; as empresas existentes não ganharam linha (liberar em Acessos e limites).

- Relatório só de leitura da **empresa inteira**, só do **ADMIN**: o que há para receber, o que está atrasado e há quanto tempo. Tudo sai dos **pagamentos** (atendimento avulso, recorrência e contratação de plano); `CANCELLED` e excluídos ficam de fora. Atrasado segue a regra de Pagamentos: `PENDING` com vencimento **antes de hoje** no calendário da empresa.
- `GET /receivables?from=&to=` (resumo). Período como na carteira (AAAA-MM-DD, fuso da empresa, pontas incluídas; padrão: o mês atual; fim antes do início: 400).
  - Hoje, sem período: `open` (todo `PENDING`, inclusive sem vencimento), `overdue` (atrasado, com `clients`, quantos clientes devem) e `aging` (o atrasado por dias de atraso: `1-30`, `31-60`, `61-90` e `90+`; todas as faixas, mesmo vazias).
  - No período: `received` (`PAID` com `paidAt` no período) e `default` (inadimplência: `due` = pagamentos `PAID` ou `PENDING` com vencimento no período **até ontem**; `unpaid` = os que seguem `PENDING`; `rate` = `unpaid` ÷ `due`, de 0 a 1, ou `null` sem nada vencido).
  - `months`: gráfico fixo de 9 meses (os 5 anteriores, o atual e os 3 seguintes), pelo **vencimento**: `month` (AAAA-MM), `paid`, `overdue` e `upcoming`. Sem vencimento não entra no gráfico.
  - Totais com `total` (texto com duas casas) e `count`.
- `GET /receivables/debtors` (`search` pelo nome sem acentos nem caixa, `page`, `limit` até 100): um item por cliente com atraso, também cliente inativado (a dívida continua): `id`, `name`, `photoUrl`, `phone` (contato principal), `overdue` (soma em atraso), `count` e `oldestDueDate` (vencimento mais antigo em atraso). Ordem: maior valor em atraso primeiro; empate pelo nome.

## Relatório de agendamentos

> **Estado:** backend em 2026-11-10 (Relatórios → Agendamentos). Funcionalidade `appointments-report`, só Visualiza, marcada no modelo padrão de empresa nova.

- Relatório só de leitura, só do **ADMIN**, da empresa toda ou de um profissional (`professionalId` opcional; inexistente, de outra empresa ou que não é profissional: 404). Período como nos demais relatórios (`from`/`to`, AAAA-MM-DD no fuso da empresa, pontas incluídas; padrão: o mês atual; fim antes do início: 400), pelo **início** do agendamento.
- `GET /appointment-report`:
  - `total`: agendamentos **não cancelados** (concluídos, faltas e os ainda sem desfecho); `open`: agendado, confirmado ou em andamento; `fromPortal`: dos não cancelados, os marcados pelo cliente no app.
  - `completed`, `noShow` e `cancelled`. O cancelamento de aula pela clínica (sessão cancelada, saída da turma) também conta como cancelado. Na turma, cada aluno é um agendamento.
  - `noShowRate` = faltas ÷ (concluídos + faltas), só o que já deveria ter acontecido; `cancelRate` = cancelados ÷ todos (com os cancelados). De 0 a 1; `null` sem base.
  - `series`: `unit` `day` (até 62 dias) ou `week`, com todos os intervalos: `date`, `completed`, `noShow`, `cancelled` e `open`.
  - `peak`: os não cancelados por dia da semana (`weekDay`, 0 = domingo) e hora de início no fuso da empresa (`hour`), só as células com algum agendamento.
  - `byProfessional` e `byService`: `id`, `name`, `total` (não cancelados), `completed`, `noShow`, `cancelled`; no serviço, também `minutes` (duração somada dos não cancelados). Ordem: maior total; empate pelo nome.
- **Ocupação** (horas marcadas ÷ horas disponíveis) fica de fora: o horário de funcionamento é da empresa, não de cada profissional, e a conta sairia errada.

## Rankings

> **Estado:** backend em 2026-11-10 (Relatórios → Rankings). Funcionalidade `rankings`, só Visualiza, marcada no modelo padrão de empresa nova.

- Relatório só de leitura, só do **ADMIN**, da empresa toda. Período como nos demais relatórios (padrão: o mês atual).
- Base: atendimentos `COMPLETED` no período (pelo início) e o **pagamento próprio** de cada um, quando `PAID` ou `PENDING` e não excluído. **Faturado** é a soma desses pagamentos (a mesma conta da Carteira de clientes). A sessão de pacote conta na quantidade, **sem valor** (o pagamento é da contratação; o rateio fica para a comissão).
- `GET /rankings?from=&to=&sort=`: `summary` (`amount`, `completed`, `average` = faturado ÷ concluídos com pagamento, e `packages`: quantidade e valor dos pacotes contratados no período); `services` (com `share`, a parte do faturado, de 0 a 1), `professionals` (com `clients`, clientes distintos atendidos) e `clients` (com `packages` e `lastVisit`, o último concluído no período).
- **Clientes** somam ao faturado os **pacotes contratados no período** (pela data da contratação; o valor é a soma dos pagamentos `PAID` ou `PENDING` não excluídos da contratação, então a parte cancelada não conta). O ticket médio do cliente continua só dos atendimentos.
- Listas inteiras, ordenadas por `sort`: `amount` (padrão: faturado, depois quantidade) ou `count` (quantidade, depois faturado); empate pelo nome. A tela mostra os 10 primeiros; a impressão, todos. `sort` inválido: 400.

## Relatório financeiro

> **Estado:** backend em 2026-11-10 (Relatórios → Financeiro). Funcionalidade `financial-report`, só Visualiza, exige ver Pagamentos; marcada no modelo padrão de empresa nova.

- Relatório só de leitura, só do **ADMIN**, da empresa toda: o que **entrou no caixa**. Complementa o Contas a receber (o que falta receber) e os Rankings (o faturado pelos atendimentos).
- Base: pagamentos `PAID`, não excluídos, pela **data do pagamento** (`paidAt`) no período, no fuso da empresa (padrão: o mês atual). Filtro opcional por método de pagamento (`paymentMethodId`; de outra empresa: 404).
- `GET /financial-report?from=&to=&paymentMethodId=`: `received` (total), `appointments` e `packages` (pela origem: pagamento de atendimento ou de contratação), `series` (por dia até 62 dias, senão por semana, separando atendimentos e pacotes) e `byMethod` (valor, quantidade e `share`, do maior para o menor; pagamento sem método fica numa linha com `id` null).
- `GET /financial-report/payments` (paginado, mesmos filtros): o extrato, do pagamento mais recente para o mais antigo, com data, valor, origem, descrição (serviço do atendimento ou nome do pacote), cliente e método.

## Relatório de pacotes

> **Estado:** backend em 2026-11-10 (Relatórios → Pacotes). Funcionalidade `packages-report`, só Visualiza, exige ver Contratações; marcada no modelo padrão de empresa nova.

- Relatório só de leitura, só do **ADMIN**, da empresa toda: a vida das contratações de pacote. Os valores recebidos e em atraso ficam no Financeiro e no Contas a receber.
- No período (padrão: o mês atual, no fuso da empresa): **novas** (pela data da contratação, com o valor contratado, `totalAmount`) e **canceladas** (pela data do cancelamento).
- Hoje: **ativas** (não canceladas e com data final de hoje em diante, inclusive as que ainda vão começar; vale o período contratado, mesmo sem sessões restantes) e **terminando em breve** (ativas com data final até hoje + 30 dias, quando o cliente não tem outra contratação ativa terminando depois, ou seja, ainda não renovou).
- `GET /packages-report?from=&to=`: `created` (quantidade e valor), `active`, `cancelled`, `ending` e `byPlan` (os mesmos números por pacote, só os pacotes com algum deles, do maior valor contratado para o menor).
- `GET /packages-report/ending` (paginado): as contratações terminando, do fim mais próximo ao mais distante (empate pelo nome do cliente), com o cliente (e o celular principal), o pacote, a data final e as **sessões**: concluídas de quantas a contratação tem (os agendamentos das recorrências dela, sem os cancelados).

## Perfil do cliente

> **Estado:** backend em 2026-11-10 (Relatórios → Perfil do cliente). Funcionalidade `clients-report`, só Visualiza, exige ver Clientes e Agendamentos; marcada no modelo padrão de empresa nova.

- Relatório só de leitura, só do **ADMIN**, da empresa toda. A base são os clientes **ativos no cadastro** (não inativados); os inativados ficam fora de tudo.
- Hoje: **ativo** (atendimento `COMPLETED` nos últimos **60 dias** ou agendamento futuro `SCHEDULED`/`CONFIRMED`; a mesma regra da Carteira de clientes) e **sem retorno** (o resto, inclusive quem nunca foi atendido); **com o app** (cadastro ligado a uma conta do app).
- No período (padrão: o mês atual, no fuso da empresa): **novos** (o primeiro atendimento concluído na empresa caiu no período); **atendidos** (com concluído no período) e **frequência** (concluídos ÷ atendidos).
- **Tipo de atendimento**, sobre os atendidos: avulso, recorrência, pacote (recorrência de uma contratação) e turma (sessão de turma). Não são exclusivos: o pacote numa turma conta nos dois, e um cliente pode ter vários tipos.
- **Por onde agendam:** os concluídos do período pela origem (clínica ou app).
- **Cadastro:** faixas de idade (até 17, 18 a 29, 30 a 44, 45 a 59, 60 ou mais, em anos completos hoje) e cidades (pelo endereço principal: as 5 mais comuns, "Outras" e sem endereço). Sem o dado, conta como não informado.
- `GET /clients-report?from=&to=`: os números acima, cada um com a quantidade e a parte da base (`share`, de 0 a 1).
- `GET /clients-report/birthdays` (paginado, mesmo período): **aniversariantes**, pela data do aniversário (empate pelo nome), com a data de nascimento, a idade que completa e o celular principal. Quem nasceu em 29/02 comemora em 28/02 nos anos que não são bissextos.

## Dashboard

> **Estado:** 2026-11-10. Funcionalidade `dashboard`, só Visualiza, marcada no modelo padrão de empresa nova. Não tem rota própria na API.

- Tela do **ADMIN** que junta os números dos relatórios, só com métricas e gráficos. Os dados vêm das rotas dos relatórios (Financeiro, Contas a receber, Agendamentos, Rankings, Pacotes, Perfil do cliente), então os números são sempre os mesmos dos relatórios.
- Cada bloco só aparece quando a empresa tem a funcionalidade do relatório de origem; a API de cada relatório continua conferindo a sua.
- As métricas do período comparam com o **período anterior**: um mês inteiro com o mês anterior inteiro (ex.: novembro com outubro); qualquer outro período com os dias imediatamente antes, do mesmo tamanho. A tela consulta as mesmas rotas com as datas anteriores.

## Comissão

> **Estado:** 2026-11-10, etapas 1 (regra no serviço), 2 (geração na conclusão), 3 (consulta) e 4 (adiantamentos). O fechamento entra na etapa 5. Funcionalidade `commissions` (Visualiza, Cria = lançar adiantamento, Exclui/Inativa = excluir adiantamento), exige ver Profissionais e Pagamentos; marcada no modelo padrão.

- A regra fica no **serviço** (ver "Serviços"): percentual do valor cobrado ou valor fixo por atendimento. `commissionSince` marca quando a comissão passou a valer (ao sair de "sem comissão"; tirar a comissão limpa a data; trocar tipo ou valor mantém). Só os atendimentos que **terminam depois** dessa data geram comissão: **nada retroativo**.
- **Profissional que não recebe** (2026-11-10): cada profissional tem `receivesCommission` (padrão: sim). O profissional **vinculado a um usuário ADMIN** (o dono que atende) nasce **sem** comissão: o vínculo (na criação ou na alteração do usuário) desliga a chave, e a migração desligou a dos que já estavam vinculados. Depois disso, mudar o tipo do usuário não mexe na chave; quem administra liga ou desliga no cadastro do profissional. Só o **ADMIN** envia o campo (403 para os demais); em quem não é profissional, 400. **Religar vale dali em diante** (`commissionSince` do profissional): o tempo desligado não gera nada retroativo. Desligado, os atendimentos dele não geram comissão em nenhum serviço.
- **Uma comissão por atendimento concluído** (`Commission`, única por agendamento), do profissional do atendimento. **Cancelado não gera** (nunca chega a concluído). Na turma, cada aluno é um atendimento, com a sua comissão.
- Gerada pelo `CommissionJob` a cada 5 minutos, por serviço e profissional que recebe, para os concluídos ainda sem comissão que terminaram depois da data mais recente entre as duas (`commissionSince` do serviço e do profissional); uma rodada que falhar é coberta pela seguinte, e rodar de novo não duplica.
- **Base** (congelada na geração):
  - **sessão de pacote**: o total contratado ÷ as sessões geradas na contratação (todas, inclusive as canceladas depois), em duas casas (decisão de 2026-11-10: o cancelamento do pacote não muda o valor por sessão; as sessões canceladas simplesmente não geram);
  - **demais** (avulso, recorrência, turma avulsa): o valor do pagamento do atendimento, se não estiver cancelado nem excluído; sem ele, o **preço do serviço** (o avulso que ainda vai ser cobrado na comanda).
- **Valor**: percentual × base (duas casas, metade para cima) ou o valor fixo. Base, tipo, taxa e valor ficam gravados: mudar a regra do serviço depois não mexe no que já foi gerado.
- A comissão nasce **mesmo que o cliente ainda não tenha pago**; o quanto o cliente já pagou aparece na consulta.
- **Consulta** (só o **ADMIN**): pela **data do atendimento** no período (padrão: o mês atual, no fuso da empresa), com profissional opcional (de outra empresa: 404).
  - `GET /commissions/summary`: quantidade, base, comissão e **pago pelo cliente**, no total e por profissional (do maior valor de comissão para o menor).
  - `GET /commissions` (paginado): atendimento a atendimento, do mais recente para o mais antigo, com data, cliente, serviço, se é sessão de pacote, base, regra, valor e o pago pelo cliente.
  - **Pago pelo cliente**: avulso com o pagamento `PAID` = a base inteira (senão zero); sessão de pacote = a base na proporção do que a contratação já recebeu (`PAID` ÷ total), sem passar da base.
  - O resumo traz também, **em aberto** (ainda não fechado) e **sem depender do período**, o `advanced` (adiantado) e o `toPay` (comissão em aberto − adiantado), no total e por profissional; quem só tem saldo em aberto aparece mesmo sem atendimento no período. Até o fechamento existir, tudo o que foi gerado e adiantado está em aberto.
- **Adiantamentos** (`/commission-advances`, só o **ADMIN**): `POST` lança para um profissional da empresa (404 se não for), com valor maior que zero, data no calendário da empresa (pode ser passada; **futura é 400**) e observação opcional (até 200 caracteres). O valor não passa do **disponível para adiantar** (comissão em aberto − adiantamentos em aberto; 400 com o disponível na mensagem); o profissional fica travado durante a conta, para dois lançamentos simultâneos não passarem juntos do limite. Grava quem lançou. `GET ?professionalId=` lista os do profissional (data mais recente primeiro, com quem lançou); `GET /available?professionalId=` dá o disponível. `DELETE /:id` exclui um lançamento errado (exclusão física, 204), enquanto não houver fechamento.

## Turmas

> O desenho completo e as decisões estão em `turmas.md`. As regras abaixo valem na API (etapa 1: cadastro de turmas fixas; etapa 2: sessões e encaixe avulso; etapa 3: recorrência e plano na turma; etapa 4: cancelamento da sessão, saída da turma e reposição; etapa 5: agenda por sessão; etapa 6: encaixe em lote e alunos fixos).

- Uma turma fixa é um horário semanal de atendimento em turma, com vagas: serviço, profissional, um ou mais dias e horários, quantidade de vagas e um nome opcional (não único, até 100 caracteres). Pertence à empresa do usuário; a empresa não é informada no payload.
- **Só o ADMIN** cadastra, consulta, altera, inativa e reativa turmas. Os demais perfis, inclusive o SUPER_ADMIN, recebem 403. Turma de outra empresa responde 404.
- O serviço precisa ser da empresa, estar ativo e aceitar turma (400). O profissional precisa ser uma pessoa ativa da empresa do tipo `PROFESSIONAL` (400).
- As vagas vão de 2 a 100. A turma tem de 1 a 21 horários. Cada horário informa o dia da semana e o início (`HH:MM`); o fim é o início somado à duração do serviço.
- Dois horários da mesma turma não podem se sobrepor no mesmo dia da semana (podem se encostar) (400).
- Cada horário precisa caber inteiro em uma janela de atendimento da empresa: a turma fixa não tem encaixe (400). Enquanto a empresa não cadastrar janelas, o horário não é restringido.
- O profissional não pode ter duas turmas **ativas** com horários que se sobreponham no mesmo dia da semana (409, citando a outra turma).
- Serviço, profissional e dias não mudam depois do cadastro (400): para mudá-los, inativa-se a turma e cria-se outra. Nome (`null` remove) e vagas podem ser alterados.
- Não há exclusão: a turma é inativada (`isActive`) e pode ser reativada. A reativação confere de novo o serviço, o profissional, o funcionamento e as outras turmas ativas do profissional.
- A listagem é paginada, da turma cadastrada mais recentemente para a mais antiga, e filtra por nome (parcial, sem diferenciar acentos nem maiúsculas), situação (`isActive`), serviço, profissional e período de cadastro (`from` e `to`, datas AAAA-MM-DD; dias inteiros no fuso da empresa, os dois incluídos).
- Toda resposta de turma traz o serviço (`id`, `name`, `color`, `duration`), o profissional (`id`, `name`, `photoUrl`) e os dias (`weekDay`, `startTime` e `endTime` em HH:MM).
- Mudar as vagas da turma vale também para as **sessões futuras** dela (não iniciadas e não canceladas). Se alguma já tiver mais alunos do que as novas vagas, a mudança é recusada (409, citando a data da sessão) e nada muda.

### Sessões e encaixe

- Cada aluno tem o **próprio agendamento**, ligado a uma **sessão** da turma (`classSessionId`): pagamento, falta, plano e comanda continuam sendo de cada aluno, com as regras atuais.
- A sessão é uma ocorrência com serviço, profissional, início, fim e vagas. Na turma fixa, nasce no primeiro encaixe daquele horário (uma por horário) com as vagas da turma; a sessão avulsa nasce de um agendamento que vira turma.
- Só o ADMIN encaixa alunos, transforma agendamento em turma, consulta a sessão e altera as vagas dela (os demais recebem 403).
- **Encaixe na turma fixa** (`POST /class-groups/:id/participants`, com `clientIds`, `startAt` e `note` opcional): o início precisa cair num dia e horário da turma, no fuso da empresa (400); a turma precisa estar ativa (409) e a sessão precisa caber numa janela de atendimento (400). Cria um agendamento avulso para cada aluno; a sessão do dia nasce no primeiro encaixe, na mesma transação.
- **Encaixe numa sessão existente** (`POST /class-sessions/:id/participants`, com `clientIds` e `note` opcional), de turma fixa (que precisa estar ativa) ou avulsa.
- **Vários alunos de uma vez, tudo ou nada:** `clientIds` tem de 1 a 100 clientes, sem repetidos (400); o antigo `clientId` não é aceito. A `note` vale para todos. O encaixe responde 201 com a **sessão atualizada**, no formato de `GET /class-sessions/:id`.
- Em todo encaixe: a sessão ainda não começou (400) e não está cancelada (409), e o serviço continua ativo e aceitando turma.
- **Recusa de alunos:** cada cliente precisa ser uma pessoa ativa da empresa do tipo `CLIENT`, não estar já na sessão e ter a agenda livre no horário. Se algum for recusado, nenhum é encaixado: 409 com `message` ("Nenhum aluno foi encaixado: 2 recusados") e `errors: [{ clientId, message }]`, na ordem do pedido, com o motivo de cada um ("Cliente não encontrado", "A pessoa não é do tipo CLIENT", "O cliente já está nesta sessão", "O cliente já possui um agendamento neste horário").
- **Vagas:** conferidas para a lista inteira, com a sessão travada, depois das recusas (que precisam ser corrigidas de qualquer jeito e mudam a conta). Sem vaga para todos: 409 com `available` (vagas livres) e `requested` (alunos pedidos), ex.: "A sessão tem 1 vaga livre e foram pedidos 3 alunos". Dois encaixes simultâneos não ultrapassam o limite.
- **Vagas:** ocupam vaga todos os agendamentos da sessão, menos os cancelados (a falta ocupa). A conferência trava a sessão até o fim da gravação: dois encaixes ao mesmo tempo na última vaga não passam juntos.
- **Agenda do profissional:** os agendamentos da mesma sessão não conflitam entre si; com qualquer outro compromisso do profissional, o conflito continua. Exceção: o avulso encaixado sobre a turma (`overBooking`, sem sessão) não bloqueia as inclusões na sessão, e a sessão não bloqueia o encaixe; dois avulsos, ou o encaixe e outro avulso, continuam conflitando. Para o cliente, a regra de conflito não muda.
- **Agendamento que vira turma** (`POST /class-sessions`, com `appointmentId` e `capacity` de 2 a 100): o agendamento precisa estar em `SCHEDULED` ou `CONFIRMED`, não ter começado, ter serviço ativo que aceita turma e ainda não ser de uma sessão (409). A sessão avulsa copia o horário, o serviço, o profissional e o encaixe (`overBooking`) dele, e os alunos encaixados depois herdam esse encaixe. Se o agendamento original for cancelado, a sessão continua com os demais alunos.
- **Vagas da sessão** (`PATCH /class-sessions/:id`, `capacity` de 2 a 100): só antes do início e nunca abaixo do número de alunos dela (409). Vale para sessão fixa e avulsa; uma mudança posterior nas vagas da turma fixa sobrescreve as das suas sessões futuras.
- **Agendamento de turma:** pela edição comum (`PATCH /appointments/:id`), não muda horário, serviço, cliente nem profissional (400); status, observação, cancelamento e falta seguem as regras atuais. O aluno sai da sessão cancelando o agendamento, o que libera a vaga.
- A consulta da sessão (`GET /class-sessions/:id`) traz a turma (`id`, `name`, ou `null` na avulsa), o serviço, o profissional, as vagas (`capacity`, `occupied`, `available`) e os agendamentos dos alunos (`id`, `status`, `cancelReason` e cliente), inclusive os cancelados. A sessão cancelada não tem vaga livre (`available: 0`).
- A resposta do agendamento traz `classSession` com `id`, `classGroupId`, `capacity` e `cancelledAt` (preenchido quando a sessão inteira foi cancelada), ou `null`.

### Agenda por sessão

- `GET /class-sessions`, **só o ADMIN**, com `from` e `to` obrigatórios (instantes ISO 8601 em UTC, `from <= startAt < to`, como em `GET /appointments`) e filtros opcionais `professionalId`, `serviceId` e `classGroupId`. O fim precisa vir depois do início e o período tem no máximo **31 dias** (400). Por isso a lista **não é paginada**.
- Traz as sessões do período, de turma fixa e avulsas, inclusive as canceladas (com `cancelledAt` e `cancellationNote`), com a turma, o serviço, o profissional, as vagas e os alunos, como na consulta de uma sessão.
- Traz também os **horários vazios**: os horários futuros das turmas fixas ativas que ainda não têm sessão, com `id: null`, as vagas da turma livres e sem alunos (a sessão só é criada no primeiro encaixe). Um horário vazio fica de fora quando o profissional tem, nele, outro agendamento não cancelado, de turma ou individual (o encaixe seria recusado). O avulso encaixado sobre a turma (`overBooking`) não esconde o horário vazio.
- Ordem: pelo início e, no mesmo horário, pelo nome do profissional.

### Alunos fixos

- `GET /class-groups/:id/members`, **só o ADMIN** (turma de outra empresa: 404): as recorrências ativas encaixadas na turma, avulsas ou de plano, em que o aluno não saiu da turma e que ainda estão no período (data final a partir de hoje, no fuso da empresa; a recorrência antiga sem data final entra). Sem paginação, em ordem pelo nome do cliente.
- **Um item por recorrência** (um cliente pode estar duas vezes, ex.: uma recorrência avulsa e um plano em dias diferentes): `recurringAppointmentId`, o cliente (`id`, `name`, `photoUrl`), a origem (`origin`: `RECURRENCE` ou `PLAN`), a contratação (`clientPlan`: `id` e `planName`, ou `null` na avulsa) e os dias da turma em que ele está (`weekDay`, `startTime` em HH:MM).
- O aluno avulso, encaixado sessão a sessão, não é aluno fixo.

### Recorrência e plano na turma

- A recorrência avulsa (`classGroupId` em `POST /recurring-appointments`) e cada serviço de uma contratação de plano (`classGroupId` no item de `schedules`) podem ser encaixados numa turma fixa. Num mesmo plano, um serviço pode ir para a turma e outro ficar com horário individual.
- Com turma: `serviceId` e `professionalId` continuam obrigatórios e precisam ser os da turma (400); cada dia precisa ser um dos horários da turma, com o mesmo dia da semana e o mesmo início (400); a turma precisa estar ativa (409) e o serviço continuar aceitando turma (400). No plano, a quantidade de dias continua sendo o `sessionsPerWeek` (ex.: 2 dos horários de uma turma de segunda, quarta e sexta).
- Cada agendamento gerado nasce na sessão do seu horário (criada se ainda não existir), com a vaga conferida com a sessão travada, como no encaixe avulso. Continua tudo ou nada: sem vaga ou com a sessão cancelada em alguma data, nada é gravado e o erro informa a data ("Sem vaga na turma em 02/11/2026 às 08:00").
- Pagamentos não mudam: a recorrência avulsa gera um pagamento por agendamento; o plano é cobrado pela contratação.
- A turma da recorrência não muda depois da criação (a edição só aceita observação e cancelamento). Encerrar a recorrência ou cancelar o plano cancela os agendamentos futuros, o que libera as vagas.
- Remanejar uma sessão de turma tira o aluno da sessão (atendimento individual no novo horário, vaga livre). Para levar a aula a uma sessão de turma, usa-se a reposição em turma (abaixo).

### Cancelamento da sessão, saída da turma e reposição

- **Cancelamento da sessão** (`PATCH /class-sessions/:id/cancel`, com `note` opcional, só ADMIN): só antes do início (400) e uma única vez (409). Grava a data e o motivo (`cancelledAt`, `cancellationNote`) e cancela, na mesma transação, os agendamentos dos alunos ainda em `SCHEDULED` ou `CONFIRMED`, com o motivo `CLASS_SESSION_CANCELLED` (`cancelReason`), e os pagamentos `PENDING` deles; o `PAID` não muda. A sessão cancelada não recebe novos encaixes (409).
- **Saída da turma** (`PATCH /recurring-appointments/:id/leave-class`, com `note` opcional, só ADMIN): a recorrência precisa estar ativa (400), estar encaixada numa turma (400) e o aluno ainda não ter saído (409). Grava a data e o motivo (`classLeftAt`, `classLeaveNote`) e cancela as aulas futuras da recorrência nas sessões da turma, com o motivo `CLASS_LEFT`, e os pagamentos `PENDING` delas.
  - Recorrência **avulsa**: é encerrada (`isActive: false`), e as demais aulas futuras dela também são canceladas. Para entrar em outra turma, cria-se uma recorrência nova.
  - Recorrência de **plano**: continua ativa (só o cancelamento da contratação a encerra). As aulas remanejadas para fora da turma continuam, e as canceladas pela saída ficam para reposição.
- **Reposição de sessão de plano:** além da falta, a aula cancelada pela clínica na turma (com `cancelReason`) pode ser remanejada para outra data dentro do período da contratação e volta a `SCHEDULED`, sem o motivo. A aula cancelada pelo cliente (sem motivo) não é reposta (400), nem a de recorrência avulsa.
- **Reposição em turma** (`PATCH /recurring-appointments/:id/appointments/:appointmentId/replace-in-class`, com `classGroupId` e `startAt`, só ADMIN): aceita as mesmas aulas do remanejamento (futuras e, no plano, as que podem ser repostas). A turma precisa ser da empresa (404), estar ativa (409) e ser do **mesmo serviço** da aula (400); o `startAt` precisa ser um horário dela (400), no futuro, dentro do período e do funcionamento. A vaga é conferida com a sessão travada: sessão cancelada, cheia ou com o cliente já nela respondem 409. A aula entra na sessão com o **profissional da turma** (a recorrência mantém o dela), e o vencimento do pagamento pendente acompanha a nova data.

## Anamnese

> **Em desenho:** estas regras descrevem o que será implementado. Ainda não valem na API.
> O item marcado com **(adiado)** fica para uma atualização futura da funcionalidade.

A anamnese guarda **dados de saúde**, que a LGPD trata como dados pessoais sensíveis. Por
isso o acesso é restrito, as respostas são criptografadas e toda ação fica registrada.

### Modelos de ficha

- Um modelo pertence à empresa do usuário que o cadastrou; a empresa não é informada no payload.
- O nome do modelo é obrigatório, com até 100 caracteres, e único entre os modelos da mesma empresa, sem diferenciar maiúsculas nem acentos. A descrição é opcional, com até 1000 caracteres.
- Não há exclusão: o modelo é inativado (`isActive`) e pode ser reativado. Um modelo inativo não inicia novas fichas; as fichas já existentes continuam acessíveis e recebendo acompanhamentos.
- Cada modelo tem **versões** numeradas a partir de 1. Criar o modelo cria a versão 1. Editar as perguntas cria uma nova versão (a lista informada substitui a anterior); reenviar a mesma lista também cria uma nova versão. Uma versão existente nunca muda. Renomear ou inativar o modelo não cria versão.
- Quem cria, edita e inativa modelos é **somente o ADMIN**. Os profissionais consultam os modelos e os usam para preencher fichas.

### Perguntas

- Um modelo precisa de ao menos uma pergunta. A ordem é a da lista enviada: o servidor numera as perguntas de 1 em diante, e o cliente não informa posição.
- A ordem das perguntas pode ser alterada no frontend antes de enviar para salvar.
- O texto da pergunta é obrigatório. O texto de ajuda é opcional.
- Tipos: texto curto, texto longo, sim ou não, escolha única, escolha múltipla, número, data e escala de 0 a 10.
- Escolha única e múltipla exigem ao menos 2 opções, sem repetir; os demais tipos não aceitam opções.
- A pergunta de sim ou não pode ter um texto de detalhe (ex.: "Qual?"); o detalhe só vale quando a resposta é "sim".
- Cada pergunta é obrigatória ou opcional.
- Limites: texto da pergunta até 400 caracteres, ajuda até 500, opção até 100, até 100 perguntas por modelo, resposta de texto até 5.000 caracteres e evolução até 10.000.
- Não há perguntas condicionais, anexos nem imagens nesta versão.

### Fichas e acompanhamentos

- Existe **uma ficha por cliente e por modelo**. O cliente deve ser do tipo `CLIENT` e estar ativo; o modelo deve estar ativo.
- Criar a ficha é gravar o **registro inicial**, com as respostas. A ficha fica presa à versão do modelo vigente nesse momento, e todos os registros seguintes respondem às mesmas perguntas. Uma edição posterior do modelo vale só para fichas novas.
- Pergunta obrigatória sem resposta é recusada (400). Cada resposta é validada pelo tipo da pergunta: tamanho do texto, sim ou não (com detalhe só se a pergunta o permite e a resposta é "sim"), opções existentes, número, data válida e escala de 0 a 10.
- O **acompanhamento** registra o que o profissional observou na consulta: a evolução (texto obrigatório) e, se algo mudou, as respostas atualizadas, **só das perguntas alteradas**.
- O acompanhamento pode apontar o agendamento da visita; ele deve ser do mesmo cliente e da mesma empresa.
- A **data da consulta** é informada no registro: o padrão é hoje no fuso da empresa, pode ser passada (para lançar um acompanhamento esquecido), não pode ser futura nem anterior à data do registro inicial.
- Os registros são **imutáveis**: não há edição nem exclusão pela API. Para corrigir, cria-se um novo acompanhamento. Um acompanhamento atualiza respostas, mas não as apaga: não há como limpar uma resposta já dada.
- As fichas de um cliente são listadas pelo cliente (`clientId` obrigatório): não existe listagem geral de fichas da empresa.
- Os **clientes que têm ficha** podem ser listados com a quantidade de fichas de cada um (`GET /anamnesis/clients`, paginado, com busca por nome sem diferenciar acentos nem maiúsculas, em ordem alfabética): só entram os clientes da empresa com ao menos uma ficha (inclusive inativos), e a resposta traz apenas o nome e a contagem, nenhum conteúdo. Exige o acesso da anamnese e grava **uma** auditoria de listagem por consulta (alvo: a empresa, sem cliente), e não uma por cliente.
- É possível consultar **quais agendamentos já têm acompanhamento** (`GET /anamnesis/appointments-with-entry?appointmentIds=a,b,c`, de 1 a 100 ids, da empresa do usuário): a resposta traz só os ids de agendamento que têm acompanhamento, sem nenhum conteúdo da ficha, cliente ou modelo. Exige o mesmo acesso da anamnese (os demais recebem 403) e **não entra na auditoria**, por não expor dado de saúde e por ser chamada a cada carregamento da agenda do frontend, que avisa os atendimentos ainda sem acompanhamento.
- A **situação atual** da ficha é a resposta mais recente de cada pergunta; o histórico completo, em ordem de data, continua disponível.
- Cliente inativo: as fichas continuam legíveis, mas não recebem novos registros.
- Cada registro guarda o usuário que o gravou e, se ele for vinculado a um profissional, esse profissional.

### Acesso

- Veem e registram fichas: o **ADMIN** e o usuário **vinculado a um profissional ativo** da empresa. Os demais recebem 403.
- Quem tem acesso vê as fichas de **todos os clientes da empresa**.
- O SUPER_ADMIN não acessa fichas, salvo se estiver vinculado a um profissional da própria empresa. Fichas de outras empresas respondem 404, como os demais dados.
- O **vínculo** entre usuário e profissional é opcional e único: um usuário se liga a uma pessoa do tipo `PROFESSIONAL` (ou `EMPLOYEE`, sem acesso à anamnese), ativa e da mesma empresa, e uma pessoa se liga a no máximo um usuário ativo. ADMIN e SUPER_ADMIN definem e alteram o vínculo. O `/auth/me` informa o profissional vinculado (`professional`) e a pessoa vinculada (`person`).
- O acesso por vínculo vale enquanto o profissional estiver ativo.

### Segurança e privacidade

- As respostas e o texto da evolução são **criptografados** no aplicativo (AES-256-GCM), com uma chave guardada no servidor (`ANAMNESIS_ENCRYPTION_KEY`). A API não sobe em produção sem ela.
- A chave **não** entra no backup do banco e precisa ser guardada à parte: sem ela, as fichas não podem ser lidas. O backup do banco contém só dados criptografados.
- Toda ação sensível é gravada na **auditoria**: leitura de ficha, histórico e lista de fichas do cliente, criação de registro, geração de PDF, criação e edição de modelo e alteração do vínculo. O registro de auditoria não é alterado nem excluído pela API. A consulta a ela está descrita abaixo.
- Também são auditadas as ações que dão ou tiram o acesso aos dados de saúde: a **criação de usuário do tipo ADMIN**, **toda mudança de tipo** de um usuário (inclusive a retirada do ADMIN) e a **reativação** de um usuário ADMIN ou vinculado a uma pessoa. Valem para o ADMIN e para o SUPER_ADMIN, e o registro fica na empresa do usuário alterado: o ADMIN dela vê, por exemplo, quando o SUPER_ADMIN cria um administrador. O registro diz quem alterou, qual usuário, quando e de qual IP; o tipo anterior e o novo não são guardados.
- Não há exclusão de ficha pela API. O prazo de guarda e a exclusão a pedido do titular (LGPD) dependem de definição com o conselho da categoria ou com um jurídico **(adiado)**: ficam para uma atualização futura da funcionalidade.

### Consulta à auditoria

- A API lista os registros de auditoria, só leitura, **apenas para o ADMIN**, que vê somente os da própria empresa. Os demais perfis recebem 403, inclusive o SUPER_ADMIN.
- A lista é paginada, da mais recente para a mais antiga, e filtra por cliente, usuário, ação e período.
- Cada item informa quem (usuário), o quê (ação, tipo e código do alvo), a qual cliente se refere, o IP e quando. A própria consulta não é auditada.
- Não há edição nem exclusão de registros de auditoria.

### PDF para impressão

- A ficha é exportada em PDF, **gerado no backend**; a impressão é feita pelo frontend.
- O PDF tem duas partes. A **ficha** é o que o cliente assina: traz os dados da clínica (nome, CPF/CNPJ, contato e endereço principais), os do cliente (nome, idade, CPF, telefone e endereço principais), o modelo e a versão, e as respostas do **registro inicial** (não as atualizações posteriores, para que o papel assinado reflita o que o cliente declarou), com a linha de assinatura **só do cliente**. A assinatura é conferida manualmente.
- O **histórico de acompanhamento** vem em página própria: cada registro com a data da consulta, o profissional (ou o usuário, sem vínculo), a evolução e as respostas atualizadas. É controle do profissional, anotado conforme a evolução do cliente, e **não leva assinatura**. A ficha continua como foi assinada: o histórico só cresce, com novos acompanhamentos.
- Como o histórico é do profissional, o PDF pode ser emitido **sem ele** (`includeHistory=false`), para a via do cliente. O padrão é incluí-lo.
- Todas as páginas trazem o nome da clínica, a data e hora da emissão no fuso da empresa e a paginação. A **logomarca** da clínica aparece no cabeçalho de todas as páginas, quando existe e é PNG ou JPEG (o único formato aceito no upload). Sem logo, ou com um valor que não seja um arquivo de logo válido, o PDF sai só com o nome da clínica, sem erro.
- Cada geração de PDF fica registrada na auditoria, e o arquivo só é entregue se o registro for gravado. O PDF não é guardado em cache.

### Fora desta versão

- Banco de perguntas reutilizáveis entre modelos (duplicar um modelo existente é uma possibilidade, ainda não decidida).
- Atualizar uma ficha para uma versão nova do modelo.
- Perguntas condicionais, anexos e imagens, assinatura digital.

## Estados e cidades

- Estados e cidades são mantidos via seed (base do IBGE) e são somente leitura pela API.
- A busca de cidades por nome é parcial e ignora acentos e maiúsculas (ex.: "sao paulo" encontra "São Paulo"). A mesma regra vale para as buscas por nome de pessoas, serviços e métodos de pagamento.

## Status dos Agendamentos

- SCHEDULED - Quando o agendamento é criado na aplicação, status inicial.
- CONFIRMED - Quando o cliente confirma o agendamento (feature futura).
- IN_PROGRESS - Quando o agendamento começa a ser válido através do dia e horário agendado.
- COMPLETED - Quando o atendimento é encerrado, baseado no horário final do agendamento.
- CANCELLED - Quando o agendamento é encerrado manualmente pelo usuário.
- NO_SHOW - Quando o cliente não compareceu. É marcado manualmente pela empresa (não há automação), só depois de o atendimento iniciar. Não cobra: o pagamento pendente é cancelado, e a falta é definitiva (ver Agendamentos > Falta). Em sessão de pacote, permite a reposição da sessão (ver Planos).
