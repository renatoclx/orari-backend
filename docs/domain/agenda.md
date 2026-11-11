# Domínio: Agenda

> Parte de [`domain/`](README.md). Funcionamento, bloqueios e agendamentos.

## BusinessHours

- Representa as janelas de atendimento de uma empresa em um dia da semana.

### Atributos

| Nome      | Descrição                |
| --------- | ------------------------ |
| id        | Identificador único      |
| companyId | Código da empresa        |
| weekDay   | Dia da semana (WeekDays) |
| openAt    | Horário de abertura      |
| closeAt   | Horário de fechamento    |

### Relacionamentos

- Uma empresa pode ter várias janelas de atendimento, inclusive mais de uma no
  mesmo dia da semana.

---

## AgendaBlock

- Representa um horário bloqueado na agenda da empresa, num único dia. Conta como fora do funcionamento (ver `business-rules/agenda.md`, "Bloqueio de horários").
- Desbloquear apaga o registro; a auditoria guarda quem bloqueou e quem desbloqueou.

### Atributos

| Nome        | Descrição                              |
| ----------- | -------------------------------------- |
| id          | Identificador único                    |
| companyId   | Código da empresa                      |
| startAt     | Início do bloqueio (UTC)               |
| endAt       | Fim do bloqueio (UTC), no mesmo dia    |
| createdById | Código do usuário que bloqueou         |
| createdAt   | Data e hora do bloqueio                |

### Relacionamentos

- Uma empresa pode ter vários bloqueios, sem sobreposição entre eles.

---

## Appointments

- Representa os agendamentos realizados na aplicação.

### Status de Agendamento (AppointmentStatus)

- SCHEDULED - Agendado
- CONFIRMED - Confirmado
- COMPLETED - Completo
- CANCELLED - Cancelado
- NO_SHOW - Não comparecimento (não cobra e é definitivo; ver `business-rules/agenda.md`)

### Atributos

| Nome                   | Descrição                                         |
| ---------------------- | ------------------------------------------------- |
| id                     | Identificador único                               |
| companyId              | Código da empresa                                 |
| clientId               | Código do cliente (deriva de pessoa)              |
| professionalId         | Código do profissional (deriva de pessoa)         |
| serviceId              | Código do serviço                                 |
| startAt                | Data e horário de início do serviço               |
| endAt                  | Data e horário final do serviço                   |
| status                 | Situação do agendamento                           |
| note                   | Observação (opcional)                             |
| overBooking            | Encaixe: marcado fora do horário de funcionamento |
| source                 | Origem: `CLINIC` (feito na clínica) ou `PORTAL` (feito pelo cliente) |
| recurringAppointmentId | Agendamento recorrente que o originou (opcional)  |
| classSessionId         | Sessão da turma a que pertence (opcional)         |
| cancelReason           | Motivo do cancelamento pela turma (opcional)      |

### Relacionamentos

- Um agendamento contém um cliente e um profissional.
- Um agendamento realiza um serviço.
- Um agendamento poderá conter uma observação opcional.
- Um agendamento pode ter sido originado por um agendamento recorrente.
- Um agendamento pode ter um pagamento.
- Um agendamento pode pertencer a uma sessão de turma (ClassSession).

---
