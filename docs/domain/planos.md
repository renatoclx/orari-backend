# Domínio: Planos

> Parte de [`domain/`](README.md). Catálogo de planos e contratações.

## Plan

- Representa um pacote de serviços oferecido pela empresa, com desconto por período e modalidade de pagamento.

### Atributos

| Nome           | Descrição                                    |
| -------------- | -------------------------------------------- |
| id             | Identificador único                          |
| name           | Nome do plano                                |
| normalizedName | Nome sem acentos e em minúsculas, para busca |
| description    | Descrição do plano (opcional)                |
| monthlyPrice   | Valor mensal do plano                        |
| isActive       | Plano ativo ou inativo                       |
| companyId      | Código da empresa                            |

### Relacionamentos

- Um plano pertence a uma empresa.
- Um plano é composto por um ou mais serviços (PlanItem).
- Um plano possui percentuais de desconto por período (PlanPeriod).
- Um plano pode ser contratado por vários clientes (ClientPlan).

---

## PlanItem

- Representa um serviço incluído em um plano.

### Atributos

| Nome            | Descrição                                  |
| --------------- | ------------------------------------------ |
| id              | Identificador único                        |
| planId          | Código do plano                            |
| serviceId       | Código do serviço                          |
| sessionsPerWeek | Atendimentos do serviço por semana (1 a 7) |

### Relacionamentos

- Um item do plano pertence a um plano e referencia um serviço.

---

## PlanPeriod

- Representa o desconto aplicado a um plano para um determinado período de contratação.

### Atributos

| Nome                   | Descrição                                      |
| ---------------------- | ---------------------------------------------- |
| id                     | Identificador único                            |
| planId                 | Código do plano                                |
| months                 | Número de meses do período                     |
| discountPercent        | Percentual de desconto para pagamento integral |
| monthlyDiscountPercent | Percentual de desconto para pagamento mensal   |

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
| endDate         | Data final da contratação                                        |
| firstDueDate    | Vencimento do primeiro pagamento (obrigatório no mensal)         |
| cancelledAt     | Data e hora do cancelamento (vazio enquanto ativa)               |

### Relacionamentos

- Uma contratação pertence a uma empresa e a um cliente.
- Uma contratação referencia um plano.
- Uma contratação origina um agendamento recorrente para cada serviço do plano, com dias e horários próprios.
- Uma contratação gera pagamentos: um único, na modalidade integral, ou um por mês, na modalidade mensal.

---
