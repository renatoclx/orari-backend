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
  horários de funcionamento, agendamentos, agendamentos recorrentes, planos e
  contratações de planos.

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

## RefreshToken

- Representa uma sessão de autenticação renovável de um usuário (ver `auth.md`).

### Atributos

| Nome      | Descrição                                          |
| --------- | --------------------------------------------------- |
| id        | Identificador único                                 |
| userId    | Código do usuário                                   |
| tokenHash | Hash do token (o valor bruto nunca é persistido)     |
| expiresAt | Data de expiração                                    |
| revokedAt | Data em que o token foi revogado (opcional)          |

### Relacionamentos

- Um refresh token pertence a um usuário.
- Um usuário pode ter mais de um refresh token (uma sessão por dispositivo).

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
| note       | Observações (opcional) |
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

| Nome         | Descrição                    |
| ------------ | ----------------------------- |
| id           | Identificador único           |
| type         | Tipo de endereço              |
| cep          | Código postal                 |
| street       | Logradouro                    |
| neighborhood | Bairro (opcional)              |
| number       | Número                        |
| complement   | Complemento (opcional)        |
| peopleId     | Código da Pessoa (opcional)   |
| companyId    | Código da empresa (opcional)  |
| cityId       | Código da cidade              |

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
| color       | Cor associada ao serviço (opcional)   |

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
| endDate        | Data final do agendamento recorrente (obrigatória) |
| clientPlanId   | Contratação de plano que originou a recorrência (opcional) |
| note           | Observação (opcional)                           |
| isActive       | Ativa ou inativa o agendamento recorrente       |

### Relacionamentos

- Um agendamento recorrente pode ser originado por uma contratação de plano (ClientPlan).
- Um agendamento recorrente contém um cliente e um profissional.
- Um agendamento recorrente realiza um serviço.
- Um agendamento recorrente poderá conter uma observação opcional.
- Um agendamento recorrente possui um ou mais dias recorrentes.
- Um agendamento recorrente origina vários agendamentos.

---

## Plan

- Representa um pacote de serviços oferecido pela empresa, com desconto por período e modalidade de pagamento.

### Atributos

| Nome        | Descrição                       |
| ----------- | ------------------------------- |
| id          | Identificador único             |
| name        | Nome do plano                   |
| description | Descrição do plano (opcional)   |
| isActive    | Plano ativo ou inativo          |
| companyId   | Código da empresa               |

### Relacionamentos

- Um plano pertence a uma empresa.
- Um plano é composto por um ou mais serviços (PlanService).
- Um plano possui percentuais de desconto por período (PlanPeriod).
- Um plano pode ser contratado por vários clientes (ClientPlan).

---

## PlanService

- Representa um serviço incluído em um plano.

### Atributos

| Nome      | Descrição               |
| --------- | ----------------------- |
| id        | Identificador único     |
| planId    | Código do plano         |
| serviceId | Código do serviço       |

### Relacionamentos

- Um item do plano pertence a um plano e referencia um serviço.

---

## PlanPeriod

- Representa o desconto aplicado a um plano para um determinado período de contratação.

### Atributos

| Nome                   | Descrição                                           |
| ---------------------- | --------------------------------------------------- |
| id                     | Identificador único                                 |
| planId                 | Código do plano                                     |
| months                 | Número de meses do período                          |
| discountPercent        | Percentual de desconto para pagamento integral      |
| monthlyDiscountPercent | Percentual de desconto para pagamento mensal        |

### Relacionamentos

- Um período pertence a um plano.

---

## ClientPlan

- Representa a contratação de um plano por um cliente.

### Modalidades de Pagamento (PlanBillingType)

- INTEGRAL - Uma única cobrança do total do período.
- MONTHLY - Um pagamento por mês contratado.

### Atributos

| Nome            | Descrição                                                        |
| --------------- | ---------------------------------------------------------------- |
| id              | Identificador único                                              |
| companyId       | Código da empresa                                                |
| clientId        | Código do cliente (deriva de pessoa)                             |
| planId          | Código do plano contratado                                       |
| billingType     | Modalidade de pagamento (PlanBillingType)                        |
| startDate       | Data de início da contratação                                    |
| months          | Número de meses contratados                                      |
| monthlyAmount   | Valor mensal congelado na contratação                            |
| discountPercent | Percentual de desconto aplicado conforme a modalidade, congelado |
| totalAmount     | Valor total do período congelado na contratação                  |

### Relacionamentos

- Uma contratação pertence a uma empresa e a um cliente.
- Uma contratação referencia um plano.
- Uma contratação origina um agendamento recorrente para cada serviço do plano, com dias e horários próprios.
- Uma contratação gera pagamentos: um único, na modalidade integral, ou um por mês, na modalidade mensal.

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

- Representa o pagamento de um agendamento ou de uma contratação de plano.

### Status de Pagamento (PaymentStatus)

- PAID - Pago.
- PENDING - Pendente.
- CANCELLED - Cancelado.

### Atributos

| Nome            | Descrição                                                        |
| --------------- | ---------------------------------------------------------------- |
| id              | Identificador único                                              |
| appointmentId   | Código do agendamento (opcional, quando não é de plano)          |
| clientPlanId    | Código da contratação de plano (opcional, quando é de plano)     |
| amount          | Valor final a pagar                                              |
| dueDate         | Data de vencimento (opcional)                                    |
| status          | Situação do pagamento                                            |
| paidAt          | Dia que realizou o pagamento (opcional)                          |
| paymentMethodId | Código do método de pagamento                                    |

### Relacionamentos

- O pagamento corresponde a um agendamento ou a uma contratação de plano.
- O pagamento de um agendamento de recorrência tem vencimento na data do agendamento, que acompanha a remarcação do agendamento.
- Um pagamento pendente com vencimento anterior à data atual consta como atrasado (ver `business-rules.md`).
- O pagamento é realizado por um método de pagamento, entre os que a empresa
  aceita.

---

## Notification

- Representa um aviso para a empresa agir.
- Ainda não há tipos de notificação em uso. A entidade é mantida para implementações futuras.

### Atributos

| Nome       | Descrição                                      |
| ---------- | ---------------------------------------------- |
| id         | Identificador único                            |
| companyId  | Código da empresa                              |
| message    | Texto do aviso                                 |
| readAt     | Data da leitura (opcional)                     |
| resolvedAt | Data em que o aviso deixou de valer (opcional) |

### Relacionamentos

- Uma notificação pertence a uma empresa.

---
