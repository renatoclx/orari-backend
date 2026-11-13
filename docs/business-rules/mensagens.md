# Regras de negócio: Mensagens

> Parte de [`business-rules/`](README.md). Mensagens automáticas, mensagens da clínica e notificações.

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

## Notificações

> **Estado:** 2026-11-13. Troca da antiga notificação por empresa (nunca teve uso) pela **notificação por usuário** (o sino).

- **A caixa de cada usuário** (ADMIN e PROFESSIONAL): as notificações são criadas pela própria API e cada um só lê e altera as próprias (a de outro usuário responde 404 ao marcar). Não há exclusão: ficam lidas. **Limpar** (`DELETE /notifications`) tira tudo da lista e do contador, mas a linha fica (`clearedAt`): a chave de deduplicação continua valendo, e um evento repetido não volta a avisar.
- **Rotas** (`/notifications`, qualquer usuário da empresa, sem depender de plano): `GET` (10 por página, mais novas primeiro; `onlyUnread`; traz `unread`, o total de não lidas), `GET /unread-count` (o número do sino, mais `latestAt`: quando chegou a notificação mais nova que não foi limpa, para o painel avisar na tela), `PATCH /read-all`, `DELETE /` (**limpar** a caixa), `PATCH /:id/read`, `GET` e `PUT /preferences` e `POST` e `DELETE /push/subscriptions`.
- **Push:** a caixa recebe tudo; só o push tem interruptor, por categoria (padrão ligado). Um aparelho é único por endereço: quem ativa depois no mesmo aparelho fica com ele. Só endereços dos serviços de push conhecidos (400); push desligado no servidor: 503. O texto do push é genérico, **sem o nome do cliente** (a tela bloqueada é pública); a caixa leva os nomes.
- **Sem repetir:** cada evento tem uma `dedupeKey` única por usuário; o mesmo evento não grava duas vezes nem repete o push.
- **Quem recebe:** só usuários ativos da empresa do evento.
- **Fonte atual: o cliente no app.** Quando o cliente **marca** ou **cancela** um avulso pelo app (o agendamento nasce com a origem `PORTAL`), os **ADMIN** da empresa e o usuário **ligado ao profissional** do horário recebem "Novo agendamento pelo app" ou "Agendamento cancelado pelo cliente". Não há aviso do que a clínica faz (ela mesma fez).
- **Categorias:** `APPOINTMENT`, `REMINDER` (lembrete) e `DAILY_SUMMARY` (resumo da manhã). As próximas (pendências do dia do ADMIN, boas-vindas, avisos dos jobs) entram como categorias novas pelo mesmo despachante. `GET` e `PUT /notifications/preferences` devolvem e aceitam só as do tipo do usuário: o **ADMIN** vê `APPOINTMENT`; o **PROFESSIONAL**, as três (a outra categoria responde 400).

### Avisos ao profissional (2026-11-13)

- **O que a clínica faz nos horários dele:** marcar, remarcar ou cancelar um **avulso** avisa o usuário **PROFESSIONAL** ligado ao profissional do horário ("Novo agendamento", "Agendamento remarcado", "Agendamento cancelado"). A **sessão de turma cancelada** avisa uma vez só ("Turma cancelada"), e não uma por aluno. Não avisa quem faz a ação (o ADMIN) nem o que é criado em lote (recorrência, pacote, turma). Chaves: `appointment:<id>:created`, `:rescheduled:<início>` (cada remarcação tem a sua) e `:cancelled`; `class-session:<id>:cancelled`.
- **Lembrete do próximo atendimento:** 30 minutos antes, para o usuário PROFESSIONAL do profissional, em `SCHEDULED` ou `CONFIRMED` (não avisa o já iniciado, o cancelado nem a falta). A conferência roda a cada 5 minutos, com a tolerância de 15 min dos lembretes do cliente. **Uma sessão de turma gera um lembrete só**, qualquer que seja o número de alunos. Chave `reminder:appointment:<id>` ou `reminder:class-session:<id>`.
- **Resumo da manhã:** às **7h30** no relógio da clínica (e até as 11h: um reinício da API ainda entrega o do dia), com o número de atendimentos (a mesma conta do Início: turma conta uma vez, cancelado fora) e o primeiro horário. **Dia sem atendimento não manda nada.** Chave `summary:AAAA-MM-DD`.
- **Quem configura (Mensagens → Automáticas):** são duas situações novas, `PROFESSIONAL_REMINDER` e `PROFESSIONAL_SUMMARY` (agora **oito** situações no `GET` e no `PUT /auto-messages`): a clínica **liga ou desliga** e **edita o texto** (padrão: ligadas). O tempo (30 min) e a hora (7h30) são **fixos**, sem opção. Variáveis: as do agendamento no lembrete (`{nome}` e `{profissional}` são o nome do profissional; **não há** `{cliente}`) e, no resumo, `{nome}`, `{estabelecimento}`, `{data}`, `{hora}` e `{quantidade}` ("5 atendimentos"). O texto não leva o nome do cliente: serve à caixa e ao push.
- **Quem envia:** só **clínicas ativas com a funcionalidade Mensagens no plano**; **não dependem do portal do cliente ligado**. Cada profissional ainda tem o interruptor do push dele por categoria (Agendamentos, Lembretes e Resumo da manhã).

### Resumo de pendências do administrador (2026-11-13)

- **Situação `ADMIN_SUMMARY`** em Mensagens (agora **nove** situações no `GET` e no `PUT /auto-messages`): a clínica liga ou desliga, edita o texto (padrão ligado), escolhe a **hora do envio** (`summaryHour`: 7, 8, 9 ou 10; padrão **8**) e os **itens** que entram (`summaryItems`; padrão: todos). Ligado sem nenhum item: 400. As opções só existem nesta situação (as outras gravam hora nula e itens vazios).
- **Itens** (calendário e fuso da clínica; cada um só conta se o plano libera a funcionalidade que o alimenta, `payables`, `payments`, `tabs` ou `clients`):
  - `PAYABLE_TODAY`: contas a pagar **pendentes com vencimento hoje**;
  - `PAYABLE_OVERDUE`: contas a pagar pendentes com vencimento **antes de hoje**;
  - `RECEIVABLE_OVERDUE`: pagamentos de clientes `PENDING`, não excluídos, com vencimento antes de hoje (a regra da Análise de recebíveis);
  - `OPEN_TABS`: **comandas do dia**, os clientes distintos com atendimento hoje em `SCHEDULED`, `CONFIRMED`, `IN_PROGRESS` ou `COMPLETED` (a regra da tela Comandas);
  - `BIRTHDAYS`: clientes **ativos** que fazem aniversário hoje.
- **Envio:** o job confere a cada 5 minutos e manda **uma vez por dia** a cada usuário **ADMIN** ativo, a partir da hora escolhida e **até o meio-dia** (um reinício da API ainda entrega). **Se nenhum item tem número, não manda nada.** Chave `pending:AAAA-MM-DD`. Categoria `PENDING_SUMMARY`, só do ADMIN nas preferências de push.
- **Texto:** variáveis `{nome}`, `{estabelecimento}`, `{data}` e `{resumo}` (a frase pronta: "3 contas a pagar hoje, 5 recebimentos atrasados e 2 comandas hoje"; só os itens com número). O **push é genérico** ("Há itens para ver hoje no painel.", sem números nem dinheiro); a caixa leva o resumo. Destino: o Dashboard.
- **Bloco do Dashboard:** `GET /pending-summary` (só **ADMIN**) devolve `date` e `items` (`item` e `count`), **na hora** e com todos os itens que o plano libera (independe das opções do resumo enviado). Sem a funcionalidade, o item não vem.
