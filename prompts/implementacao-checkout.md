Módulo payment. Reformule GET /payments/checkouts (Comandas do dia). Hoje ele parte dos pagamentos que vencem ou foram pagos hoje; passa a partir das visitas do dia. PATCH /payments/settle não muda.

Quem tem comanda. O "dia" é hoje no fuso da empresa. Entram os clientes que:

têm um atendimento que começa hoje, em SCHEDULED, CONFIRMED, IN_PROGRESS ou COMPLETED (fora CANCELLED e NO_SHOW); ou
têm algum pagamento PAID com paidAt hoje (a comanda paga continua na lista).
Cliente só com pendência, sem atendimento nem pagamento hoje, não entra. Pessoa inativada continua aparecendo. Resolva primeiro os clientes (filtro search pelo nome, ordenados por normalizedName, paginados no banco) e só depois carregue os dados dos clientes da página, como já é feito.

Resposta por cliente:

{ "client": { "id": "", "name": "" },
"appointments": [],
"previousPayments": [],
"todayPending": "0.00",
"previousPending": "0.00",
"paidToday": "0.00" }
appointments: os atendimentos do cliente hoje (mesmos status acima), em ordem de startAt. Cada um com id, startAt, status, service { id, name }, professional { id, name }, recurringAppointmentId, clientPlanId (da recorrência, quando for sessão de pacote) e payment, que é o pagamento não excluído do atendimento (id, amount, dueDate, status, paidAt, paymentMethod { id, name }, isOverdue) ou null quando ainda não existe.
previousPayments: pagamentos não excluídos do cliente (do atendimento ou da contratação) que não são dos atendimentos listados em appointments:
PENDING com dueDate até hoje, inclusive;
PENDING de contratação integral (billingType = INTEGRAL) sem vencimento;
PAID com paidAt hoje.
Cada um com os campos de GET /payments (id, amount, dueDate, status, paidAt, paymentMethod, isOverdue) e a origem: appointment { id, startAt, recurringAppointmentId, service } ou clientPlan { id, billingType, plan }. Ordem: vencimento crescente, sem vencimento por último.
Totais, em texto com duas casas, somados em Decimal:
todayPending: soma dos payment PENDING de appointments;
previousPending: soma dos PENDING de previousPayments;
paidToday: soma dos PAID com paidAt hoje, de appointments e de previousPayments.
CANCELLED e excluídos nunca entram em nenhuma lista nem total.
Dados do dia. Intervalo "hoje" em instantes UTC, a partir do fuso da empresa (use o helper que já existe). dueDate é data de calendário, comparada com a data de hoje no fuso.

Testes (spec de payment): cada regra de entrada (atendimento hoje, cancelado e não compareceu de fora, pago hoje, só pendência de fora), atendimento sem pagamento (payment: null), sessão de pacote sem pagamento próprio, previousPayments (atrasado, vencendo hoje, integral sem vencimento, futuro de fora, pago hoje), totais, busca, paginação por cliente, fuso e ordem. Atualize docs/business-rules.md (Pagamentos) e docs/implementation-summary.md.
