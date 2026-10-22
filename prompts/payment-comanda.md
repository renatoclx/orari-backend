Módulo payment. Duas rotas novas para as comandas do dia do Financeiro.

1. GET /payments/checkouts?search=&page=&limit=

O "dia" é hoje no fuso da empresa. Excluídos (deletedAt) e CANCELLED nunca entram. Entram:

pagamentos PENDING com dueDate igual a hoje;
pagamentos de contratação com billingType INTEGRAL, PENDING e sem dueDate;
pagamentos PAID com paidAt dentro de hoje, para que a comanda paga continue na listagem.
Agrupamento e paginação:

Agrupe por cliente; o clientId vem do appointment ou do clientPlan.
Cada item é { client: { id, name }, total, pendingTotal, payments: [...] }.
total é a soma de todos os pagamentos da comanda; pendingTotal, a soma dos PENDING.
Os valores seguem o formato dos outros endpoints.
Cada pagamento traz status, amount, dueDate, paidAt, o método quando pago, e a origem do withOrigin, com startAt e serviço do atendimento e nome e billingType do plano.
A paginação é por cliente, em ordem alfabética, no formato Paginated.
search filtra pelo nome do cliente, ignorando acentos e maiúsculas, como nas outras buscas. 2. PATCH /payments/settle

Body: { paymentIds: uuid[] (mín. 1, sem repetidos), paymentMethodId: uuid, paidAt?: Date }.
Validações:
todos os pagamentos são da empresa, não excluídos, PENDING e do mesmo cliente;
o método é ativo e da empresa.
Grava PAID, o método e paidAt (ou o momento da requisição) numa única transação.
Erros:
404 se algum pagamento ou o método não existir na empresa;
409 se algum pagamento não estiver PENDING;
400 se os pagamentos forem de clientes diferentes.
Reaproveite o que der da baixa em lote da recorrência.
Também:

Declare checkouts e settle antes de :id no controller.
Testes nos specs de payment:
o que entra e o que fica de fora da comanda (atrasado, futuro, cancelado, pago ontem, integral sem vencimento);
o fuso da empresa;
agrupamento, totais, busca e paginação;
a baixa: transação e cada erro.
Atualize docs/business-rules.md na seção Pagamentos.
