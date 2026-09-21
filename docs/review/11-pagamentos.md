# 11 – Pagamentos

Cobrança de um agendamento e os métodos aceitos pela empresa.

**PR:** 7 (`feat/pagamentos`) · **Regras:** [business-rules.md § Pagamentos](../business-rules.md)

## Regras em resumo

- **Um pagamento por agendamento** (índice único parcial). Excluir o pagamento
  libera o agendamento para um novo.
- Agendamento e método precisam ser da empresa do usuário. O agendamento não
  muda depois da criação.
- Status inicial `PENDING`; os demais são `PAID` e `CANCELLED`.
- **`paidAt` é obrigatório quando `PAID` e recusado nos demais.** Sair de `PAID`
  limpa a data automaticamente.
- **O valor é opcional:** sem ele, assume o preço do serviço do agendamento. Se
  o serviço não tiver preço, o valor passa a ser obrigatório. Valores diferentes
  do preço continuam permitidos.
- Nome do método é único por empresa; ambos usam exclusão lógica.

## Onde está

| Arquivo | Responsabilidade |
| ------- | ---------------- |
| `modules/payment/payment.service.ts` | Escopo via agendamento, regra de `paidAt` e valor padrão |
| `modules/payment-method/payment-method.service.ts` | CRUD e unicidade do nome |
| `modules/payment/dto/create-payment.dto.ts` | Valor com 2 casas, status e `paidAt` |

## Rotas

| Método | Rota |
| ------ | ---- |
| POST | `/payments`, `/payment-methods` |
| GET | `/payments` (`?status`, `?appointmentId`, `?paymentMethodId`), `/payment-methods` (`?name`) |
| GET/PATCH/DELETE | `/payments/:id`, `/payment-methods/:id` |

## Testes

`payment.service.spec.ts` (17).

## O que olhar com atenção

- **A regra do `paidAt` no PATCH tem uma sutileza:** ao sair de `PAID`, a data
  atual é ignorada na validação e limpa na gravação; mas informar `paidAt` junto
  de um status diferente de `PAID` continua sendo 400. Esse caminho já teve um
  defeito (o PATCH recusava sair de `PAID` sem enviar `paidAt`).
- **O pagamento não guarda `companyId`:** o escopo vem do agendamento, por
  relação na query. Se um dia existir pagamento sem agendamento, a regra precisa
  ser repensada.
- **Cancelar o agendamento não mexe no pagamento** — são ciclos independentes.
- Não há registro de parcelas nem de pagamento parcial: um agendamento, um valor.
