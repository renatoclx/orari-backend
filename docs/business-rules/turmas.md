# Regras de negócio: Turmas

> Parte de [`business-rules/`](README.md). Regras vigentes do atendimento em turma (o desenho e as decisões estão em `docs/turmas.md`).

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
