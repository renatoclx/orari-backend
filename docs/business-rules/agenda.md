# Regras de negócio: Agenda

> Parte de [`business-rules/`](README.md). Agendamentos avulsos, status, fuso, funcionamento e bloqueios.

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

## Status dos Agendamentos

- SCHEDULED - Quando o agendamento é criado na aplicação, status inicial.
- CONFIRMED - Quando o cliente confirma o agendamento (feature futura).
- IN_PROGRESS - Quando o agendamento começa a ser válido através do dia e horário agendado.
- COMPLETED - Quando o atendimento é encerrado, baseado no horário final do agendamento.
- CANCELLED - Quando o agendamento é encerrado manualmente pelo usuário.
- NO_SHOW - Quando o cliente não compareceu. É marcado manualmente pela empresa (não há automação), só depois de o atendimento iniciar. Não cobra: o pagamento pendente é cancelado, e a falta é definitiva (ver Agendamentos > Falta). Em sessão de pacote, permite a reposição da sessão (ver Planos).

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
