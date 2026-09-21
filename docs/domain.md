# Domínio

## Objetivo

- Criar as entidades que irão compor a base de dados.

> Este documento descreve apenas **o que existe**: entidades, responsabilidades,
> atributos e relacionamentos. Regras de funcionamento ficam no
> `business-rules.md`, e convenções de persistência (datas de auditoria,
> exclusão lógica, tipos de coluna) ficam no `database.md`.

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
- Uma cidade pode estar associada a vários endereços.

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
| timezone        | Fuso horário da empresa (identificador IANA) |
| logoUrl         | caminho da logomarca da empresa (opcional) |
| subdomain       | Subdomínio da empresa                      |

### Relacionamentos

- Uma empresa pode ter mais de um endereço.
- Uma empresa pode ter mais de um contato.
- Uma empresa pode ter vários usuários, pessoas, serviços, métodos de pagamento,
  horários de funcionamento, agendamentos e agendamentos recorrentes.

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
| type      | Tipo de usuário     |
| companyId | Código da empresa   |

### Relacionamentos

- Uma usuário pertence a uma empresa

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
| type       | Tipo de pessoa       |
| companyId  | Código da empresa    |

### Relacionamentos

- Uma pessoa pertence a uma empresa.
- Uma pessoa pode ter mais de um endereço.
- Uma pessoa pode ter mais de um contato.
- Uma pessoa participa de agendamentos como cliente ou como profissional.

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
| type      | Tipo de contato              |
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
| type        | Tipo de endereço             |
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
- Um serviço pode estar em vários agendamentos e agendamentos recorrentes.

---

## BusinessHours

- Representa as janelas de atendimento de uma empresa em um dia da semana.

### Atributos

| Nome      | Descrição                     |
| --------- | ----------------------------- |
| id        | Identificador único           |
| companyId | Código da empresa             |
| weekDay   | Dia da semana (WeekDays)      |
| openAt    | Horário de abertura           |
| closeAt   | Horário de fechamento         |

### Relacionamentos

- Uma empresa pode ter várias janelas de atendimento, inclusive mais de uma no
  mesmo dia da semana.

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

| Nome                   | Descrição                                             |
| ---------------------- | ----------------------------------------------------- |
| id                     | Identificador único                                   |
| companyId              | Código da empresa                                     |
| clientId               | Código do cliente (deriva de pessoa)                  |
| professionalId         | Código do profissional (deriva de pessoa)             |
| serviceId              | Código do serviço                                     |
| startAt                | Data e horário de início do serviço                   |
| endAt                  | Data e horário final do serviço                       |
| status                 | Situação do agendamento                               |
| note                   | Observação (opcional)                                 |
| recurringAppointmentId | Agendamento recorrente que o originou (opcional)      |

### Relacionamentos

- Um agendamento contém um cliente e um profissional.
- Um agendamento realiza um serviço.
- Um agendamento poderá conter uma observação opcional.
- Um agendamento pode ter sido originado por um agendamento recorrente.
- Um agendamento pode ter um pagamento.

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
- Um método de pagamento pode estar em vários pagamentos.

---

## Payment

- Representa o pagamento de um agendamento.

### Status de Pagamento (PaymentStatus)

- PAID - Pago.
- PENDING - Pendente.
- CANCELLED - Cancelado.

### Atributos

| Nome            | Descrição                                |
| --------------- | ---------------------------------------- |
| id              | Identificador único                      |
| appointmentId   | Código do agendamento                    |
| amount          | Valor final a pagar                      |
| status          | Situação do pagamento                    |
| paidAt          | Dia que realizou o pagamento (opcional)  |
| paymentMethodId | Código do método de pagamento            |

### Relacionamentos

- O pagamento corresponde a um agendamento.
- O pagamento é realizado por um método de pagamento, entre os que a empresa
  aceita.

---

## Notification

- Representa um aviso para a empresa agir.

### Tipos de Notificação (NotificationType)

- RECURRING_APPOINTMENT_HORIZON - Agendamento recorrente chegando ao fim dos
  agendamentos gerados

### Atributos

| Nome                   | Descrição                                        |
| ---------------------- | ------------------------------------------------ |
| id                     | Identificador único                              |
| companyId              | Código da empresa                                |
| type                   | Tipo da notificação                              |
| message                | Texto do aviso                                   |
| recurringAppointmentId | Agendamento recorrente relacionado (opcional)    |
| readAt                 | Data da leitura (opcional)                       |
| resolvedAt             | Data em que o aviso deixou de valer (opcional)   |

### Relacionamentos

- Uma notificação pertence a uma empresa.
- Uma notificação pode se referir a um agendamento recorrente.

---
