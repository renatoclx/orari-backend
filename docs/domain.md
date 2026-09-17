# Domínio

## Objetivo

- Criar as entidades que irão compor a base de dados.

---

## State

- Representa um estado cadastrado na aplicação.

### Atributos

| Nome    | Descrição           |
| ------- | ------------------- |
| id      | Identificador único |
| name    | Nome do estado      |
| acronym | Sigla do estado     |

### Relacionamentos

- Um estado pode ter mais de uma cidade associada.

---

## City

- Representa uma cidade cadastrada na aplicação.

### Atributos

| Nome    | Descrição           |
| ------- | ------------------- |
| id      | Identificador único |
| name    | Nome da cidade      |
| stateId | Código do estado    |

### Relacionamentos

- Uma cidade pertence a um estado.

---

## Company

- Representa uma empresa cadastrada na aplicação.

### Atributos

| Nome            | Descrição                                  |
| --------------- | ------------------------------------------ |
| id              | Identificador único                        |
| corporateReason | Razão Social da empresa                    |
| fantasyName     | Nome Fantasia (opcional)                   |
| cnpj            | Documento da empresa                       |
| foundationDate  | Data de fundação                           |
| isActive        | Empresa ativa ou inativa                   |
| logoUrl         | caminho da logomarca da empresa (opcional) |
| timezone        | Fuso horário da empresa (IANA)              |
| subdomain       | Subdomínio da empresa                      |

### Relacionamentos

- Uma empresa pode ter mais de um endereço.
- Uma empresa pode ter mais de um contato.

---

## User

- Representa um usuário que terá acesso ao sistema.

### Tipos de Usuário (UserTypes)

- SUPER_ADMIN - Administrador da plataforma
- ADMIN - Administrador da empresa
- USER - Usuário

### Atributos

| Nome      | Descrição           |
| --------- | ------------------- |
| id        | Identificador único |
| name      | Nome da pessoa      |
| email     | E-mail para login   |
| password  | Senha para login    |
| companyId | Código da empresa   |

### Relacionamentos

- Uma usuário pertence a uma empresa

---

## Notification

- Representa um aviso para a empresa agir.

### Tipos de Notificação (NotificationType)

- RECURRING_APPOINTMENT_HORIZON - Agendamento recorrente chegando ao fim dos agendamentos gerados

### Atributos

| Nome                   | Descrição                                  |
| ---------------------- | ------------------------------------------ |
| id                     | Identificador único                        |
| companyId              | Código da empresa                          |
| type                   | Tipo da notificação                        |
| message                | Texto do aviso                             |
| recurringAppointmentId | Agendamento recorrente relacionado (opcional) |
| readAt                 | Data da leitura (opcional)                 |
| resolvedAt             | Data em que o aviso deixou de valer (opcional) |

### Relacionamentos

- Uma notificação pertence a uma empresa.
- Uma notificação pode se referir a um agendamento recorrente.

### Regras específicas

- Notificações não são excluídas: são resolvidas.

---

## People

- Representa uma pessoa cadastrada na aplicação.

### Tipos de Pessoa (PeopleType)

- CLIENT - Cliente
- EMPLOYEE - Funcionário
- PROFESSIONAL - Prestador de Serviço

### Atributos

| Nome       | Descrição            |
| ---------- | -------------------- |
| id         | Identificador único  |
| name       | Nome da pessoa       |
| document   | CPF da pessoa        |
| birthDate  | Data de nascimento   |
| profession | Profissão (opcional) |
| companyId  | Código da empresa    |

### Relacionamentos

- Uma pessoa pertence a uma empresa.
- Uma pessoa pode ter mais de um endereço.
- Uma pessoa pode ter mais de um contato.

---

## Contact

- Representa os contatos de uma empresa ou de uma Pessoa

### Tipos de Contato (ContactType)

- MAIN - Principal
- MESSAGE - Recados
- BRANCH - Filial

### Atributos

| Nome      | Descrição                    |
| --------- | ---------------------------- |
| id        | Identificador único          |
| phone     | Telefone (opcional)          |
| email     | E-mail (opcional)            |
| companyId | Código da empresa (opcional) |
| peopleId  | Código da Pessoa (opcional)  |

### Relacionamentos

- Um contato pode pertencer a uma empresa ou a uma pessoa (campos opcionais)

---

## Address

- Representa os endereços de uma empresa ou de uma Pessoa

### Tipos de Endereço (AddressType)

- MAIN - Principal
- MESSAGE - Recados
- BRANCH - Filial

### Atributos

| Nome        | Descrição                    |
| ----------- | ---------------------------- |
| id          | Identificador único          |
| cep         | Código postal                |
| publicPlace | Logradouro                   |
| number      | Número                       |
| complement  | Complemento (opcional)       |
| peopleId    | Código da Pessoa (opcional)  |
| companyId   | Código da empresa (opcional) |
| cityId      | Código da cidade             |

### Relacionamentos

- Um endereço pode pertencer a uma empresa ou a uma pessoa (campos opcionais).
- Um endereço pertence a uma cidade.

---

## Services

- Representa os serviços que cada empresa cadastra na aplicação.

### Atributos

| Nome        | Descrição                             |
| ----------- | ------------------------------------- |
| id          | Identificador único                   |
| name        | Nome do serviço                       |
| description | Descrição do serviço (opcional)       |
| price       | Valor cobrado pelo serviço (opcional) |
| duration    | Duração do serviço em minutos         |
| companyId   | Empresa a qual pertence o serviço     |
| isActive    | Serviço Ativo ou inativo              |

### Relacionamentos

- Uma empresa pode ter vários serviços.

---

## Appointments

- Representa os agendamentos realizados na aplicação.

### Status de Agendamento (AppointmentStatus)

- SCHEDULED - Agendado
- CONFIRMED - Confirmado
- COMPLETED - Completo
- CANCELLED - Cancelado
- NO_SHOW - Não comparecimento

### Atributos

| Nome           | Descrição                                 |
| -------------- | ----------------------------------------- |
| id             | Identificador único                       |
| companyId      | Código da empresa                         |
| clientId       | Código do cliente (deriva de pessoa)      |
| professionalId | Código do profissional (deriva de pessoa) |
| serviceId      | Código do serviço                         |
| startAt        | Data e horário de início do serviço       |
| endAt          | Data e horário final do serviço           |
| note           | Observação (opcional)                     |
| recurringAppointmentId | Agendamento recorrente que o gerou (opcional) |

### Relacionamentos

- Um agendamento contém um cliente e um profissional.
- Um agendamento pode ter sido gerado por um agendamento recorrente.
- Um agendamento realiza um serviço.
- Um agendamento poderá conter uma observação opcional.

### Regras específicas

- Em agendamento não deverá conter o campo deletedAt, será controlado via status.

---

## RecurringAppointment

- Representa os agendamentos que possuem recorrência sazonal

### Atributos

| Nome           | Descrição                                       |
| -------------- | ----------------------------------------------- |
| id             | Identificador único                             |
| companyId      | Código da empresa                               |
| clientId       | Código do cliente (deriva de pessoa)            |
| professionalId | Código do profissional (deriva de pessoa)       |
| serviceId      | Código do serviço                               |
| startDate      | Data de início do agendamento recorrente        |
| endDate        | Data final do agendamento recorrente (opcional) |
| note           | Observação (opcional)                           |
| isActive       | Ativa ou inativa o agendamento recorrente       |

### Relacionamentos

- Um agendamento recorrente contém um cliente e um profissional.
- Um agendamento recorrente realiza um serviço.
- Um agendamento recorrente poderá conter uma observação opcional.

### Regras específicas

- Em agendamento recorrente não deverá conter o campo deletedAt, não haverá exclusão.

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
| startTime              | Horário de início do agendamento recorrente |
| endTime                | Horário final do agendamento recorrente     |

### Relacionamentos

- Os dias recorrentes fazem referência a um agendamento recorrente.

### Regras específicas

- Os horários usam colunas `time` do PostgreSQL, mapeadas como `DateTime @db.Time(0)`.
  (`Unsupported("time")` geraria a mesma coluna, mas os campos ficariam fora do
  Prisma Client, exigindo SQL bruto para gravar e ler.)

---

## BusinessHours

- Representa as janelas de atendimento de uma empresa em cada dia da semana.

### Atributos

| Nome      | Descrição                       |
| --------- | ------------------------------- |
| id        | Identificador único             |
| companyId | Código da empresa               |
| weekDay   | Dia da semana (WeekDays)        |
| openAt    | Horário de abertura             |
| closeAt   | Horário de fechamento           |

### Relacionamentos

- Uma empresa pode ter várias janelas de atendimento, inclusive mais de uma no mesmo dia.

### Regras específicas

- Horários usam colunas `time`, como em RecurringDays.

---

## PaymentMethod

- Representa os tipos de pagamento que uma empresa aceita.

### Atributos

| Nome      | Descrição           |
| --------- | ------------------- |
| id        | Identificador único |
| name      | Tipo de pagamento   |
| companyId | Código da empresa   |

### Relacionamentos

- Uma empresa pode ter vários métodos de pagamento.

---

## Payment

- Representa o pagamento de um agendamento.

### Status de Pagamento (PaymentStatus)

- PAID - Pago.
- PENDING - Pendente.
- CANCELLED - Cancelado.

### Atributos

| Nome            | Descrição                     |
| --------------- | ----------------------------- |
| id              | Identificador único           |
| appointmentId   | Código do agendamento         |
| amount          | Valor final a pagar           |
| paidAt          | Dia que realizou o pagamento  |
| paymentMethodId | Código do método de pagamento |

### Relacionamentos

. O pagamento corresponde a um agendamento
. O pagamento pode ser realizado por diferentes métodos.
---
