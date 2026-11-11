# Domínio: Recorrências

> Parte de [`domain/`](README.md). Agendamentos recorrentes e os dias deles.

## RecurringAppointment

- Representa os agendamentos que possuem recorrência sazonal

### Atributos

| Nome           | Descrição                                                  |
| -------------- | ---------------------------------------------------------- |
| id             | Identificador único                                        |
| companyId      | Código da empresa                                          |
| clientId       | Código do cliente (deriva de pessoa)                       |
| professionalId | Código do profissional (deriva de pessoa)                  |
| serviceId      | Código do serviço                                          |
| startDate      | Data de início do agendamento recorrente                   |
| endDate        | Data final do agendamento recorrente (obrigatória)         |
| clientPlanId   | Contratação de plano que originou a recorrência (opcional) |
| classGroupId   | Turma fixa em que a recorrência está encaixada (opcional)  |
| classLeftAt    | Data e hora da saída da turma (opcional)                   |
| classLeaveNote | Motivo da saída da turma (opcional)                        |
| note           | Observação (opcional)                                      |
| isActive       | Ativa ou inativa o agendamento recorrente                  |

### Relacionamentos

- Um agendamento recorrente pode ser originado por uma contratação de plano (ClientPlan).
- Um agendamento recorrente pode estar encaixado numa turma fixa (ClassGroup).
- Um agendamento recorrente contém um cliente e um profissional.
- Um agendamento recorrente realiza um serviço.
- Um agendamento recorrente poderá conter uma observação opcional.
- Um agendamento recorrente possui um ou mais dias recorrentes.
- Um agendamento recorrente origina vários agendamentos.

---

## RecurringDays

- Representa os dias e horários reservados para um agendamento recorrente.

### Dias da semana (WeekDays)

- MONDAY - Segunda
- TUESDAY - Terça
- WEDNESDAY - Quarta
- THURSDAY - Quinta
- FRIDAY - Sexta
- SATURDAY - Sábado
- SUNDAY - Domingo

### Atributos

| Nome                   | Descrição                                   |
| ---------------------- | ------------------------------------------- |
| id                     | Identificador único                         |
| recurringAppointmentId | Código do agendamento recorrente            |
| weekDay                | Dia da semana reservado                     |
| startTime              | Horário de início do agendamento recorrente |
| endTime                | Horário final do agendamento recorrente     |

### Relacionamentos

- Os dias recorrentes fazem referência a um agendamento recorrente.

---
