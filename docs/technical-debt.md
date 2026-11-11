# Dívida técnica

Pontos conhecidos que foram adiados de forma consciente. Cada item diz o que é,
por que foi adiado e o que fazer quando for tratado.

---

## Validação da agenda consulta o banco a cada ocorrência

**Onde:** `AppointmentService.createFromRecurrence` e
`BusinessHourService.ensureWithinBusinessHours`.

**O que é:** cada ocorrência gerada por uma recorrência consulta o horário de
funcionamento (contagem, fuso e janelas do dia) e a agenda do cliente e do
profissional. São cerca de 4 a 5 consultas por agendamento, todas dentro da
transação de criação.

**Impacto:** uma recorrência ou contratação de plano longa gera muitos
agendamentos. Uma contratação de 12 meses, com 2 serviços e 2 dias por semana,
gera cerca de 200 agendamentos, ou seja, cerca de 1.000 consultas; uma
recorrência avulsa de um ano, 2 dias por semana, cerca de 104. Com o banco em outro
servidor, a transação pode passar do tempo limite do Prisma (5 segundos por
padrão).

**Mitigação atual:** a criação da recorrência avulsa e a contratação de plano usam
um tempo limite maior (30 segundos), definido em um só lugar
(`src/prisma/transaction-options.ts`). As demais transações mantêm o padrão de 5
segundos, que funciona como alarme para uma transação comum que trave.

**Como resolver:** buscar uma vez o horário de funcionamento da empresa e os
agendamentos do cliente e do profissional no período inteiro, e validar as
ocorrências em memória.

**Medição:** no banco local, um plano mensal de 12 meses com 2 serviços e 2 dias
por semana (208 agendamentos) foi contratado em cerca de 0,5 s. Em produção, a
latência de cada consulta é maior; vale medir de novo no ambiente real.

**Registrado em:** 2026-10-09 (Etapa 6.3).

---

## Fotos em pasta local e com acesso público

**Onde:** `src/common/storage/local-file-storage.service.ts` e `main.ts`
(`useStaticAssets`).

**O que é:** as fotos de pessoas ficam numa pasta do próprio servidor
(`UPLOADS_DIR`, padrão `uploads/`) e são servidas em `/uploads` **sem
autenticação**: quem tiver o link abre a imagem. O nome do arquivo é um UUID,
então o link não é adivinhável, mas não expira.

**Impacto:** foto de pessoa é dado pessoal (LGPD). As logos das empresas
(`/uploads/companies`) seguem o mesmo esquema de armazenamento e acesso; por
serem identidade visual pública, o acesso aberto não é problema de privacidade,
mas valem a perda de arquivos e a falta de réplica abaixo. Em produção, com mais de uma
instância do servidor ou com deploy que recria o disco, os arquivos locais
também se perdem ou ficam só em uma das instâncias.

**Mitigação atual:** formato conferido pelo conteúdo (JPEG ou PNG), até 2 MB,
nome aleatório. Em produção, os arquivos ficam num volume do Docker e entram no
backup diário (`uploads-*.tgz`, ver `docs/deploy.md`), então um disco que falha não
os perde de vez; mas o acesso continua público por quem tiver o link.

**Como resolver:** trocar o `LocalFileStorage` por um armazenamento em nuvem
privado (ex.: S3 ou compatível) e servir as fotos por links temporários
assinados. Como o resto do código só conhece `save` e `remove`, a troca fica
concentrada nesse service.

**Registrado em:** 2026-10-13.

---

## Agenda sem trava contra marcações simultâneas

**Onde:** `AppointmentService.ensureSlotIsFree` na edição, na recorrência e na
contratação. **A criação avulsa já foi resolvida** (2026-11-04, com o portal do
cliente): ela trava o profissional com `pg_advisory_xact_lock` antes de conferir e
gravar, na mesma transação.

**O que é:** a conferência de horário livre e a gravação são passos separados.
Duas marcações do mesmo profissional ou cliente, no mesmo horário e no mesmo
instante, passam pela conferência e são gravadas.

**Impacto:** raro com poucos usuários por empresa; o resultado aparece na agenda
e é corrigido à mão. Fica mais provável com agendamento online pelo cliente ou
com mais volume.

**Como resolver:** restrição de sobreposição no PostgreSQL (`EXCLUDE USING gist`,
extensão `btree_gist`) por profissional e por cliente, ignorando cancelados, com o
erro convertido em 409. Conferir antes se já existem sobreposições gravadas.

**Registrado em:** 2026-10-22.

---

## Vulnerabilidade moderada no Swagger

**Onde:** `@nestjs/swagger` (dependência `js-yaml`).

**O que é:** o `npm audit` aponta 2 vulnerabilidades moderadas, corrigidas só no
`@nestjs/swagger` 12 (versão major).

**Impacto:** baixo: o `js-yaml` é usado ao gerar a documentação, não processa
dados enviados por usuários.

**Como resolver:** atualizar para o `@nestjs/swagger` 12 numa branch própria e
conferir a documentação gerada.

**Registrado em:** 2026-10-22.

---

## Regras pendentes de decisão

**O que é:** comportamentos que funcionam, mas sem regra definida:

- **Excluir pessoa com agenda futura:** excluir um cliente ou profissional com
  agendamentos futuros, recorrência ou contratação ativos não mexe na agenda.
  Opções: recusar (409) ou cancelar o que é futuro.
- **Pagamento pago:** qualquer tipo de usuário pode excluir ou alterar o valor de
  um pagamento `PAID`, sem registro de quem fez. Opções: restringir a `ADMIN` ou
  impedir a exclusão de pagamento pago.
- **Notificações:** o módulo lista e marca como lida, mas nada cria notificações;
  a rota responde sempre vazia.

**Registrado em:** 2026-10-22.

---

## Legibilidade

- **Comentários de tutorial** em `appointment-status.job.ts` (ex.: "lte: less
  than or equal"): explicam a ferramenta, não a decisão.
- **Erros do Prisma sem tradução:** registro removido no meio da operação ou chave
  estrangeira inválida respondem 500; um filtro global de exceções os
  converteria em 404 ou 409.

**Registrado em:** 2026-10-22. **Resolvidos em 2026-11-11:** o "hoje no fuso da
empresa" repetido (agora `localDateOf`, em `common/time/time-zone.ts`) e o
`payment.service.ts` extenso (a comanda foi para o `PaymentCheckoutService`).

---

## Acesso de suporte e auditoria do SUPER_ADMIN

**Onde:** `src/common/authorization/company-scope.ts` e os módulos operacionais
(pessoas, agenda, pagamentos), que usam sempre a empresa do próprio token.

**O que é:** o SUPER_ADMIN administra empresas e usuários, mas não opera os dados de
uma clínica: não há como "entrar como" outra empresa para dar suporte, e não existe
registro de auditoria (quem fez o quê, inclusive as ações do SUPER_ADMIN).

**Impacto:** no piloto, com poucos usuários sob controle de quem administra a
plataforma, é aceitável. O suporte hoje depende de entrar com um usuário da clínica
ou de consultar o banco. Com mais clientes, falta rastreabilidade para saber quem
alterou um dado.

**Como resolver:** um acesso de suporte explícito e limitado (por empresa, com prazo
e motivo) e um registro de auditoria das ações sensíveis (cadastro e inativação de
empresas e usuários, baixas e exclusões de pagamento, ações do SUPER_ADMIN).

**Registrado em:** 2026-10-23.

---

## Barreira por funcionalidade: contatos, endereços e leituras entre funcionalidades

**Onde:** `/contacts`, `/addresses` e as telas que leem dados de outra funcionalidade.

**O que é:** o controle de acesso por empresa (ver `business-rules/empresa-e-acesso.md`, "Acessos e limites da empresa") barra por funcionalidade, mas três pontos ficaram de fora:

- `/contacts` e `/addresses` servem a pessoas (clientes, funcionários, profissionais) e à empresa. Não há como saber a funcionalidade só pela rota, e resolver o dono do contato exigiria consultas extras.
- Uma tela que lê dados de outra funcionalidade (ex.: o agendamento que mostra o pagamento) depende de a empresa ter as duas. A matriz só valida as dependências de cadastros (clientes, profissionais e serviços).
- Cancelar um agendamento é uma mudança de status (`PATCH`), então exige `edit`, não `remove`.

**Impacto:** baixo. Contatos e endereços continuam restritos à empresa do usuário; uma empresa sem `clients` ainda consegue ler contatos de clientes se souber o `id`.

**Como resolver:** quando houver necessidade, descobrir o dono do contato pelo registro (como o `/people` faz pelo tipo) e acrescentar as dependências que faltarem à matriz.

---

## Telefone da conta do cliente sem confirmação

**Onde:** `PortalAuthService.register` e `PortalAccessService.use` (conta do
cliente no app, etapa 6a).

**O que é:** quem cria a conta digita o telefone, e nada confirma que o número é
dele. Alguém pode criar uma conta com o número de outra pessoa; quando o dono
tentar se cadastrar, recebe "já existe uma conta com este telefone".

**Impacto:** a conta não enxerga nada de ninguém por causa disso (ela só se liga
a um cadastro existente pelo link da clínica), mas o dono do número fica sem
conseguir criar a conta sozinho. Hoje, a saída é a clínica gerar o link de
acesso: se a ficha do cliente tem esse telefone, o link liga a ficha à conta do
número e cria uma senha nova, tirando quem a criou.

**Como resolver:** confirmar o telefone pelo código no WhatsApp (etapa 3, depende
do canal da Meta). As peças já estão no backend (`portal-code.ts`,
`MessageSenderService`, `PortalVerification`); falta ligá-las à conta: código no
cadastro e um "esqueci a senha" pelo próprio app.

**Registrado em:** 2026-11-05.

---

## Limite do cliente não confirmado sem trava

**Onde:** `PortalAppointmentService.ensureUnconfirmedLimit` (etapa 6b).

**O que é:** o limite de 2 agendamentos futuros conta os agendamentos e depois
grava, em passos separados. A trava da criação é por **profissional**; dois
pedidos do mesmo cliente, ao mesmo tempo e com profissionais diferentes, podem
passar os dois e deixar 3 agendamentos.

**Impacto:** pequeno: o limite é uma barreira contra abuso, não uma regra de
negócio exata, e a clínica vê e cancela o excedente.

**Como resolver:** travar também pelo cliente (`pg_advisory_xact_lock` com a
chave do cliente) na mesma transação da contagem e da gravação.

**Registrado em:** 2026-11-05.

---

## Busca de estabelecimentos filtra o nome fora do banco

**Onde:** `PortalDirectoryService.search` (etapa 6c).

**O que é:** a consulta traz todas as clínicas que aparecem na busca, e o filtro
pelo nome (sem acentos) é feito na API, porque o nome da empresa não tem coluna
normalizada (o banco não tem a extensão `unaccent`).

**Impacto:** nenhum enquanto poucas clínicas aparecem na busca. Com centenas, cada
busca passaria a ler todas.

**Como resolver:** coluna normalizada do nome na empresa (como o `normalizedName`
das pessoas), com índice GIN trigram, e o filtro no banco. Fazer junto da
geolocalização, que também muda a consulta.

**Registrado em:** 2026-11-05.

## Avisos do app enviados na hora, sem fila

**Onde:** `ClientNotifierService` (etapa 8a).

**O que é:** cada aviso é gravado e enviado na própria requisição (ou no job), um
aparelho de cada vez em paralelo, sem fila nem nova tentativa. Uma falha do serviço
de push que não seja "aparelho não existe" só vai para o log; o aviso continua na
caixa de Avisos.

**Impacto:** nenhum para avisos de um cliente. Uma mensagem da clínica para
milhares de clientes (etapa 8e) ocuparia a API por mais tempo.

**Como resolver:** fila de envio (tabela ou Redis) com novas tentativas, se o volume
das mensagens em massa pedir.

**Registrado em:** 2026-11-05.

## Aniversário filtrado fora do banco

**Onde:** `AutoMessageJob.birthdays` (etapa 8c).

**O que é:** às 9h de cada clínica, o job lê todos os clientes com conta no app e
data de nascimento e confere o dia e o mês na API (o banco não tem índice por dia e
mês, e o 29/02 tem regra própria).

**Impacto:** nenhum com centenas de clientes por clínica. Com dezenas de milhares,
a leitura pesaria uma vez por dia.

**Como resolver:** filtrar no banco por `EXTRACT(MONTH/DAY FROM "birthDate")` (com
o caso do 29/02) e um índice de expressão, se o volume pedir.

**Registrado em:** 2026-11-05.

## Relatórios calculados na API, sobre listas inteiras

**Onde:** `rankings`, `packages-report`, `clients-report`, `appointment-report` e
`receivables` (Relatórios, 2026-11-09 e 11-10).

**O que é:** cada relatório lê do banco as linhas do período (ou todos os clientes
ativos) e soma em funções puras na API, em vez de agregar no SQL. As listas
paginadas (`/packages-report/ending`, `/clients-report/birthdays`,
`/receivables/debtors`) também montam a lista inteira antes de cortar a página. Os
aniversariantes conferem dia e mês fora do banco, como o job de aniversário.

**Impacto:** nenhum com o volume de uma clínica (centenas de clientes, milhares de
agendamentos por mês). Períodos longos de clínicas grandes pesariam mais. O
Dashboard chama cada relatório duas vezes (período e anterior).

**Como resolver:** levar as somas para o banco (`groupBy`/SQL) e paginar no banco,
começando pelo relatório que ficar lento; uma rota de resumo própria para o
Dashboard, se ele pesar.

**Registrado em:** 2026-11-10.

## Comissão: job por serviço e profissional, e resumo na API

**Onde:** `CommissionJob` / `CommissionService.generatePending` e
`CommissionService.summary` (Comissão, 2026-11-10).

**O que é:** a cada 5 minutos o job consulta, para cada serviço com comissão e
cada profissional que recebe, os atendimentos concluídos ainda sem comissão
(até 500 por rodada). O resumo da tela lê as comissões do período e soma na API.
O número do recibo é o maior + 1, com a empresa travada (`FOR UPDATE`) durante o
fechamento.

**Impacto:** nenhum com o volume de uma clínica. Com muitos serviços e
profissionais, o job faz muitas consultas pequenas por rodada.

**Como resolver:** uma consulta só por empresa (juntando serviço e profissional
no `where`) e somas no banco (`groupBy`), se o volume pedir; uma sequência no
banco para o número do recibo.

**Registrado em:** 2026-11-10.

## Contas a pagar: categoria "Comissões" achada pelo nome

**Onde:** `createCommissionPayable` (`payable/commission-payable.ts`, Contas a
pagar etapa 5, 2026-11-10).

**O que é:** a conta gerada pelo adiantamento ou pelo fechamento vai para a
categoria ativa com o nome normalizado "comissoes". Se a empresa renomeou ou
inativou essa categoria, uma nova "Comissões" é criada.

**Impacto:** quem renomear "Comissões" para outro nome (ex.: "Comissão") passa a
ter as duas, e as contas novas da comissão vão para a recriada.

**Como resolver:** uma marca de sistema na categoria (ex.: `systemKey`), que a
tela não deixe inativar, e a busca por ela em vez do nome.

**Registrado em:** 2026-11-10.

## Comanda montada pelo dia do cliente

**Onde:** `PaymentCheckoutService.findCheckouts`
(`payment/payment-checkout.service.ts`; venda de produtos, 2026-11-11).

**O que é:** a comanda não é gravada: é tudo o que o cliente tem no dia
(atendimentos e vendas de hoje, o pago hoje e as pendências anteriores). Duas
visitas no mesmo dia caem na mesma comanda; a comanda paga "reabre" quando
entra um atendimento ou uma venda nova.

**Impacto:** não há comandas separadas no mesmo dia nem o registro de quando
uma comanda foi fechada; a tela separa o pago no bloco "Recebidos". Vários
métodos numa comanda, desconto, gorjeta, troco e caixa continuam dependendo de
uma comanda gravada.

**Como resolver:** gravar o fechamento (`CheckoutClosing`, com as colunas
opcionais `checkoutClosingId` em pagamentos e atendimentos) na baixa pela
comanda; a comanda aberta passa a ser o que ainda não entrou em fechamento.
Avaliado em 2026-11-11 e deixado de fora.

**Registrado em:** 2026-11-11.

## Movimentação de estoque sem data própria

**Onde:** `StockMovementService.create` (`stock/stock-movement.service.ts`,
2026-11-11).

**O que é:** a movimentação vale pelo momento do lançamento (`createdAt`); uma
compra que chegou ontem é lançada hoje. O saldo depois de cada movimentação
(`balanceAfter`) segue a ordem de lançamento.

**Impacto:** o histórico mostra quando foi lançado, não quando aconteceu. A
conta a pagar da compra tem as próprias datas (vencimento e pagamento).

**Como resolver:** um campo de data da movimentação (até hoje), com o histórico
ordenado por ele e o `balanceAfter` recalculado a partir da data, se a clínica
precisar lançar no passado.

**Registrado em:** 2026-11-11.
