# Domínio: Pagamentos

> Parte de [`domain/`](README.md). Formas de pagamento e pagamentos.

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

| Nome            | Descrição                                                    |
| --------------- | ------------------------------------------------------------ |
| id              | Identificador único                                          |
| companyId       | Código da empresa                                            |
| appointmentId   | Código do agendamento (opcional, quando não é de plano)      |
| clientPlanId    | Código da contratação de plano (opcional, quando é de plano) |
| amount          | Valor final a pagar                                          |
| dueDate         | Data de vencimento (opcional)                                |
| status          | Situação do pagamento                                        |
| paidAt          | Dia que realizou o pagamento (opcional)                      |
| paymentMethodId | Código do método de pagamento (opcional até o pagamento)     |

### Relacionamentos

- O pagamento pertence a uma empresa.
- O pagamento corresponde a um agendamento ou a uma contratação de plano.
- O pagamento de um agendamento de recorrência tem vencimento na data do agendamento, que acompanha a remarcação do agendamento.
- Um pagamento pendente com vencimento anterior à data atual consta como atrasado (ver `business-rules/pagamentos.md`).
- O pagamento é realizado por um método de pagamento, entre os que a empresa
  aceita.

---
