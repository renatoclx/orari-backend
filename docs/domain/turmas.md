# Domínio: Turmas

> Parte de [`domain/`](README.md). Turmas fixas, horários e sessões.

## ClassGroup

- Representa uma turma fixa: um horário semanal de atendimento em turma, com vagas
  (ver `turmas.md`).

### Atributos

| Nome           | Descrição                                    |
| -------------- | -------------------------------------------- |
| id             | Identificador único                          |
| companyId      | Código da empresa                            |
| name           | Nome da turma (opcional, não único)          |
| normalizedName | Nome sem acentos e em minúsculas, para busca |
| serviceId      | Serviço da turma (que aceita turma)          |
| professionalId | Profissional da turma (deriva de pessoa)     |
| capacity       | Quantidade máxima de alunos por sessão       |
| isActive       | Turma ativa ou inativa                       |

### Relacionamentos

- Uma turma pertence a uma empresa, realiza um serviço e tem um profissional.
- Uma turma possui um ou mais dias e horários (ClassGroupDay).

---

## ClassGroupDay

- Representa um dia e horário da turma fixa.

### Atributos

| Nome         | Descrição                |
| ------------ | ------------------------ |
| id           | Identificador único      |
| classGroupId | Código da turma          |
| weekDay      | Dia da semana (WeekDays) |
| startTime    | Horário de início        |

### Relacionamentos

- Os dias fazem referência a uma turma. O fim de cada horário é o início somado à
  duração do serviço da turma.

---

## ClassSession

- Representa uma sessão de turma: uma ocorrência de atendimento em turma, com vagas.
  Nasce de uma turma fixa (no primeiro encaixe daquele horário) ou de um agendamento
  que vira turma (sessão avulsa).

### Atributos

| Nome             | Descrição                                                    |
| ---------------- | ------------------------------------------------------------ |
| id               | Identificador único                                          |
| companyId        | Código da empresa                                            |
| classGroupId     | Turma fixa que a originou (vazio na sessão avulsa)           |
| serviceId        | Serviço da sessão                                            |
| professionalId   | Profissional da sessão (deriva de pessoa)                    |
| startAt          | Início                                                       |
| endAt            | Fim                                                          |
| capacity         | Quantidade máxima de alunos                                  |
| overBooking      | Encaixe fora do funcionamento (sessão avulsa)                |
| cancelledAt      | Data e hora do cancelamento da sessão (vazio enquanto ativa) |
| cancellationNote | Motivo do cancelamento da sessão (opcional)                  |

### Relacionamentos

- Uma sessão pertence a uma empresa e pode ter sido originada por uma turma fixa.
- Uma sessão realiza um serviço e tem um profissional.
- Uma sessão contém os agendamentos dos alunos, um por aluno.

---
