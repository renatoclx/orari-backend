# Atendimento em Turma

> **Implementado:** as cinco etapas valem na API. As entidades estão no `domain.md` e as
> regras vigentes no `business-rules.md` ("Turmas"); este documento guarda o desenho e as
> decisões.

- Certos serviços podem ser realizados em turma: vários clientes, no mesmo horário, com
  o mesmo serviço e o mesmo profissional (ex.: Pilates às 08:00 com 3 alunos).
- Há dois jeitos de uma turma existir:
  - **turma fixa:** um horário cadastrado com vagas (ex.: Pilates, segunda e quarta às
    08:00, Prof. Paula, 5 vagas), em que os clientes são encaixados;
  - **atendimento que vira turma:** um agendamento comum de um serviço que aceita turma
    recebe outros clientes e passa a ser atendido em turma.
- A turma não é exclusiva: é um grupo de clientes da aplicação, cada um com seu plano,
  recorrência ou agendamento avulso. Quem encaixa os clientes é o ADMIN.

## Decisão: um agendamento por aluno

A turma **agrupa** agendamentos; ela não é um agendamento com vários clientes. Cada aluno
continua com o próprio agendamento, ligado à sessão da turma.

**Por quê:** pagamento, falta, plano, recorrência, reposição, comanda do dia e
acompanhamento da anamnese são todos de um cliente. Com um agendamento só para a turma,
cada participante precisaria de status, pagamento e plano próprios dentro dele, o que
recriaria o agendamento e mudaria agenda, pagamentos, planos, comandas e anamnese. Com um
agendamento por aluno, essas regras continuam valendo sem mudança, e a turma só acrescenta
as regras de vagas e de agenda do profissional.

Para quem usa a aplicação, a turma continua aparecendo como um único atendimento: a agenda
mostra um cartão por sessão (ex.: "Pilates 08:00 · Prof. Paula · 3/5"), com os alunos ao
abrir.

---

## Entidades

### Services (alteração)

| Nome          | Descrição                                        |
| ------------- | ------------------------------------------------ |
| allowsClasses | Aceita atendimento em turma (padrão: não aceita) |

### ClassGroup (turma fixa)

- Representa um horário fixo de atendimento em turma, com vagas.

| Nome           | Descrição                                          |
| -------------- | -------------------------------------------------- |
| id             | Identificador único                                |
| companyId      | Código da empresa                                  |
| name           | Nome da turma (opcional)                           |
| serviceId      | Serviço da turma (que aceita turma)                |
| professionalId | Profissional da turma (deriva de pessoa)           |
| capacity       | Quantidade máxima de alunos por sessão (2 ou mais) |
| isActive       | Turma ativa ou inativa                             |

- Uma turma pertence a uma empresa, realiza um serviço e tem um profissional.
- Uma turma possui um ou mais dias e horários (ClassGroupDay).
- Uma turma origina várias sessões.
- Uma turma pode ter várias recorrências encaixadas.

### ClassGroupDay

- Representa um dia e horário da turma fixa.

| Nome         | Descrição                |
| ------------ | ------------------------ |
| id           | Identificador único      |
| classGroupId | Código da turma          |
| weekDay      | Dia da semana (WeekDays) |
| startTime    | Horário de início        |

- O fim é o início somado à duração do serviço, como nos agendamentos.

### ClassSession (sessão da turma)

- Representa uma ocorrência de atendimento em turma: um dia e horário com vagas.

| Nome             | Descrição                                                  |
| ---------------- | ---------------------------------------------------------- |
| id               | Identificador único                                        |
| companyId        | Código da empresa                                          |
| classGroupId     | Turma fixa que a originou (vazio na sessão avulsa)         |
| serviceId        | Serviço da sessão                                          |
| professionalId   | Profissional da sessão                                     |
| startAt          | Início                                                     |
| endAt            | Fim                                                        |
| capacity         | Quantidade máxima de alunos                                |
| cancelledAt      | Data e hora do cancelamento (vazio enquanto não cancelada) |
| cancellationNote | Motivo do cancelamento (opcional)                          |

- Uma sessão pertence a uma empresa e pode ter sido originada por uma turma fixa.
- Uma sessão contém os agendamentos dos alunos.
- Na turma fixa, há no máximo uma sessão por turma e horário de início.

### Appointments (alteração)

| Nome           | Descrição                                               |
| -------------- | ------------------------------------------------------- |
| classSessionId | Sessão da turma a que pertence (opcional)               |
| cancelReason   | Motivo do cancelamento pela clínica na turma (opcional) |

### RecurringAppointment (alteração)

| Nome           | Descrição                                                 |
| -------------- | --------------------------------------------------------- |
| classGroupId   | Turma fixa em que a recorrência está encaixada (opcional) |
| classLeftAt    | Data e hora da saída da turma (opcional)                  |
| classLeaveNote | Motivo da saída da turma (opcional)                       |

---

## Regras

### Serviços

- Um serviço só é usado em turma se aceitar turma (`allowsClasses`).
- Um serviço com turma fixa ativa ou com sessão futura não cancelada não pode deixar de
  aceitar turma (409).

### Turma fixa

- Só o ADMIN cadastra, altera, inativa e consulta turmas; a empresa vem do token.
- Serviço e profissional precisam ser da empresa; o serviço precisa estar ativo e aceitar
  turma; o profissional, ser do tipo `PROFESSIONAL`.
- A turma tem ao menos um dia e horário; dois horários do mesmo dia não podem se
  sobrepor. Cada horário precisa caber em uma janela de atendimento (a turma fixa não
  tem encaixe).
- O profissional não pode ter duas turmas ativas com horários que se sobreponham no
  mesmo dia da semana (409).
- As vagas vão de 2 a 100; a turma tem de 1 a 21 horários; o nome tem até 100
  caracteres e não é único. Reduzir as vagas para menos do que o número de alunos de
  uma sessão futura é recusado (409). A mudança de vagas vale para as sessões futuras.
- Serviço, profissional, dias e horários não mudam: para mudá-los, inativa-se a turma e
  cria-se outra. O nome e as vagas podem mudar.
- Não há exclusão: a turma é inativada e pode ser reativada. Turma inativa não recebe
  novos encaixes; as sessões já marcadas continuam. A reativação confere de novo
  serviço, profissional, funcionamento e as outras turmas ativas do profissional.
- A listagem vem da turma cadastrada mais recentemente para a mais antiga, com filtros
  por nome, situação, serviço, profissional e período de cadastro.
- A sessão de um dia é criada quando o primeiro aluno é encaixado nele; não há geração
  antecipada nem data final da turma.

### Sessão e vagas

- Ocupam vaga todos os agendamentos da sessão que não estão cancelados, inclusive a falta
  (`NO_SHOW`): a vaga já estava reservada.
- Um aluno só é encaixado **antes do início** da sessão.
- A conferência de vaga é protegida contra encaixes simultâneos (trava da sessão): duas
  inclusões ao mesmo tempo não ultrapassam o limite.
- O mesmo cliente não aparece duas vezes na mesma sessão.
- Os agendamentos da mesma sessão não conflitam entre si para o profissional; com
  qualquer outro compromisso dele, o conflito continua valendo. Para o cliente, a regra
  de conflito não muda.
- Cada aluno tem seu agendamento, com o serviço, o profissional e o horário da sessão, e
  segue as regras atuais de status, falta, pagamento, plano e recorrência.

### Encaixe em turma fixa

- **Avulso:** o ADMIN encaixa um cliente numa sessão da turma, criando um agendamento
  avulso naquele horário (pagamento como o de qualquer agendamento avulso).
- **Recorrência:** na criação da recorrência, em vez de dias livres, informa-se a turma
  e os dias escolhidos **entre os da turma**.
- **Plano:** na contratação, cada serviço do plano pode ser encaixado numa turma, com os
  dias escolhidos entre os da turma; a quantidade continua sendo o `sessionsPerWeek` do
  plano (ex.: aluno de 2x por semana em turma de segunda, quarta e sexta).
- A geração liga cada agendamento à sessão do dia e confere a vaga. Continua tudo ou nada:
  sem vaga em alguma data, nada é gravado e o erro informa a data e o horário.
- Na recorrência e no plano, serviço e profissional continuam sendo informados e precisam
  ser os da turma.
- Remanejar uma sessão de turma (inclusive a reposição de falta de pacote) tira o aluno da
  sessão: vira atendimento individual no novo horário e libera a vaga. Para ir a uma
  sessão de turma (da mesma ou de outra), usa-se a reposição em turma (ver "Reposição").

### Atendimento que vira turma

- Um agendamento de serviço que aceita turma, ainda não iniciado e em `SCHEDULED` ou
  `CONFIRMED`, pode virar turma: cria-se uma sessão avulsa com o horário, o serviço e o
  profissional dele e com as vagas informadas (2 ou mais), e o agendamento passa a ser da
  sessão.
- Depois disso, outros clientes são encaixados na sessão como em qualquer sessão.
- Os agendamentos encaixados seguem a marcação de encaixe (`overBooking`) do agendamento
  original.
- Se o agendamento original for cancelado, a sessão continua com os demais alunos.
- As vagas de uma sessão (fixa ou avulsa) podem mudar antes do início, nunca abaixo do
  número de alunos dela.
- Remover um aluno da sessão é cancelar o agendamento dele, pela edição comum do
  agendamento (qualquer perfil, como hoje).

### Cancelamento da sessão

- O ADMIN pode cancelar uma sessão **antes do início** (ex.: feriado, profissional
  ausente). Os agendamentos de todos os alunos são cancelados, cada um com a regra atual
  (o pagamento `PENDING` do agendamento é cancelado; o `PAID` não muda).
- A sessão de plano cancelada por esse motivo **pode ser reposta**, como na falta:
  remanejada para outra data dentro do período da contratação, inclusive em uma sessão de
  outra turma com vaga.
- O cancelamento guarda uma observação opcional do motivo (ex.: "Feriado"). A sessão
  cancelada não recebe novos alunos, e cancelar de novo é recusado.

### Saída da turma

- Um aluno com recorrência ou plano encaixado na turma pode sair dela, com uma observação
  opcional do motivo, que fica registrada com a data da saída.
- Ao sair, os agendamentos futuros dele na turma (ainda não iniciados) são cancelados,
  com a regra atual de pagamentos.
- As sessões de plano canceladas pela saída **podem ser repostas**, inclusive em outra
  turma com vaga.
- Depois da saída, o aluno pode ser encaixado em outra turma, sem restrição.
- A recorrência avulsa é **encerrada** na saída (todos os dias dela são horários da
  turma); para entrar em outra turma, cria-se uma recorrência nova. A recorrência de
  plano continua ativa: só o cancelamento da contratação a encerra.
- As aulas já remanejadas para um horário individual ou para outra turma não são
  canceladas pela saída (na recorrência de plano).
- O aluno avulso não "sai" da turma: cancela-se o agendamento dele.

### Reposição

- Repõem-se, só em sessão de **plano** e dentro do período da contratação, a falta e as
  aulas canceladas pela clínica na turma (sessão cancelada ou saída da turma). A aula
  cancelada pelo próprio cliente não é reposta.
- A reposição pode ir para um horário individual (remanejamento comum) ou para uma sessão
  de turma fixa com vaga, da mesma ou de outra turma do **mesmo serviço**. Na outra
  turma, a aula passa a ser com o profissional dela; a recorrência mantém o seu.
- A reposição em turma vale também para remanejar uma aula futura (em qualquer
  recorrência) para uma sessão de turma.

### Consulta

- A resposta do agendamento informa a sessão (`classSession`: `id`, `classGroupId`,
  `capacity`) ou `null`.
- A agenda pode ser consultada por sessão (só o ADMIN, até 31 dias): horário, serviço,
  profissional, vagas ocupadas e livres, cancelamento e os alunos. Os horários futuros
  das turmas fixas ativas que ainda não têm sessão também aparecem, vazios, a menos que
  o profissional tenha outro compromisso que os sobreponha.
- A resposta do agendamento informa também se a sessão foi cancelada
  (`classSession.cancelledAt`).

---

## Etapas

| Etapa | Conteúdo                                                                                                                                      |
| ----- | --------------------------------------------------------------------------------------------------------------------------------------------- |
| 1     | `allowsClasses` no serviço e cadastro de turmas fixas (ADMIN) — **feita** (regras em `business-rules.md`, "Turmas")                           |
| 2     | Sessões: encaixe avulso, atendimento que vira turma, vagas com trava, conflito do profissional, sessão na resposta do agendamento — **feita** |
| 3     | Recorrência e plano encaixados em turma (dias escolhidos entre os da turma) — **feita**                                                       |
| 4     | Cancelamento da sessão e saída da turma, com reposição das sessões de plano — **feita**                                                       |
| 5     | Consulta da agenda por sessão, para o frontend — **feita**                                                                                    |

## Fora desta versão

- Lista de espera para sessão sem vaga.
- Troca de profissional em uma sessão (ex.: substituição de um dia).
- Transferência em lote das sessões de um aluno para outra turma (na primeira versão, as
  sessões canceladas são repostas uma a uma).
- Aviso aos alunos de sessão cancelada.
