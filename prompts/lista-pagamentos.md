Módulo payment. Ajustes para a tela de Pagamentos (listagem com filtros, totais e baixa). Não mexa em checkouts: ele fica para a tela de Comanda.

1. GET /payments: dados a mais em cada item

client: { id, name }: o do atendimento (appointment.clientId) ou o da contratação (clientPlan.clientId). Leia pela chave, sem filtrar exclusão: o nome continua aparecendo mesmo que a pessoa seja inativada.
paymentMethod: { id, name } | null: preenchido quando o pagamento está pago.
Em appointment: acrescente recurringAppointmentId (nulo no avulso).
Em clientPlan: acrescente billingType (INTEGRAL ou MONTHLY).
Os campos atuais e a ordem (dueDate crescente, sem vencimento no fim) não mudam. Os filtros status, overdue, dueFrom, dueTo, clientId e paymentMethodId já existem; confira que combinam entre si (ex.: status=PENDING&overdue=true). 2. GET /payments/summary

Query: clientId?, dueFrom?, dueTo? (mesmos tipos e validações da listagem). Ignora status, paymentMethodId e os demais filtros.
Resposta:

{ "overdue": { "total": "0.00", "count": 0 },
"upcoming": { "total": "0.00", "count": 0 },
"paid": { "total": "0.00", "count": 0 } }
overdue: PENDING com dueDate anterior a hoje (fuso da empresa). upcoming: PENDING com dueDate de hoje em diante ou sem vencimento. paid: PAID.
Cancelados e excluídos ficam de fora.
Com dueFrom/dueTo, os três usam o dueDate no período (inclusive nos pagos); pagamento sem vencimento só entra quando não há período.
total em texto com duas casas, somado em Decimal.
Fica antes de :id no controller, como checkouts e settle. Uma consulta agregada (groupBy ou aggregate), sem carregar os pagamentos. 3. PATCH /payments/settle

Já serve para a baixa de um ou vários pagamentos do mesmo cliente.
Acrescente: paidAt não pode estar no futuro (400, comparando com o instante atual). Aceita data passada, para lançar baixa esquecida.
Testes e docs

Nos specs de payment: dados novos na listagem, totais (cada cartão, filtro de período, filtro de cliente, ignorar status, sem vencimento, cancelado fora, zeros) e o paidAt futuro.
Atualize docs/business-rules.md (seção Pagamentos) e docs/implementation-summary.md.
