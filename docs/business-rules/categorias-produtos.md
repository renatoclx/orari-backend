# Regras de negócio: Categorias e produtos

> Parte de [`business-rules/`](README.md). Cadastro de categorias de produto e de produtos.

## Categorias de produto

> Funcionalidade `product-categories`. Não vem liberada no modelo padrão: o SUPER_ADMIN libera por empresa.

- Só o **ADMIN** cadastra, consulta, altera, inativa e reativa categorias de produto. Os demais perfis recebem 403. Categoria de outra empresa responde 404.
- A categoria pertence à empresa do usuário; a empresa não é informada no payload.
- O nome é obrigatório e único na empresa, sem diferenciar maiúsculas nem acentos (409).
- Não há exclusão: a categoria é inativada e reativada pela alteração (`isActive`).
- Uma categoria com produtos **ativos** não pode ser inativada (409): os produtos precisam ser inativados ou mudar de categoria antes.
- A listagem é paginada, em ordem de nome, com filtros por nome (parcial, sem diferenciar acentos nem maiúsculas) e situação.

## Produtos

> Funcionalidade `products`. Não vem liberada no modelo padrão: o SUPER_ADMIN libera por empresa.

- Só o **ADMIN** cadastra, consulta, altera, exclui e envia a foto dos produtos. Os demais perfis recebem 403. Produto de outra empresa responde 404.
- O produto pertence à empresa do usuário; a empresa não é informada no payload.
- **Categoria:** obrigatória, da empresa (404) e **ativa** (400). Isso vale ao criar, ao trocar a categoria e ao reativar o produto.
- **Fornecedor:** opcional; precisa ser uma pessoa ativa da empresa do tipo `SUPPLIER` (400). `null` remove o fornecedor.
- **SKU:** opcional; quando informado, é único entre os produtos não excluídos da empresa (409). `null` remove.
- **Unidade de medida:** opcional, de uma lista fixa: `UN` (unidade), `CX` (caixa), `PCT` (pacote), `KG`, `G`, `L`, `ML` e `M`.
- **Preços:** os preços de venda e de custo são obrigatórios e maiores que zero, com até duas casas decimais. O preço promocional é opcional, maior que zero e menor que o preço de venda (400); `null` remove.
- **Margem de lucro:** calculada pela API sobre o preço de venda, `(venda − custo) ÷ venda × 100`, com duas casas, e gravada a cada mudança de preço; não é aceita no payload. Ex.: venda 100 e custo 60 dão 40%. Com o custo acima da venda, a margem fica negativa. O preço promocional não muda a margem.
- **Estoque:** quantidades inteiras. O estoque atual é o saldo das **movimentações**, gravado no produto. No cadastro, ele é informado (0 ou mais) e vira a movimentação "Saldo inicial". A alteração do produto recusa `currentStock` (400). O mínimo e o máximo são opcionais (0 ou mais), e o mínimo não pode passar do máximo (400); na alteração, o que não for enviado vem do que está gravado.
- **Movimentações** (`POST /products/:id/stock-movements`, ação Edita de Produtos):
  - **Tipos:** entrada por compra (`PURCHASE`), uso interno (`INTERNAL_USE`), perda (`LOSS`) e ajuste (`ADJUSTMENT`).
  - **Quantidade:** na entrada e nas saídas, é 1 ou mais. No ajuste, é o saldo contado (0 ou mais), e a diferença vira a movimentação. Ajuste igual ao estoque atual é recusado (400).
  - **Saldo:** o saldo nunca fica negativo (409, "Estoque insuficiente"). Se outro lançamento mudar o saldo ao mesmo tempo, a API responde 409.
  - **Sem edição:** a movimentação não se altera nem se exclui. Um erro se corrige com um ajuste.
- **Entrada por compra:**
  - o custo unitário é obrigatório e passa a ser o preço de custo do produto (último custo), com a margem recalculada;
  - custo e conta a pagar só valem na compra (400 nos demais tipos).
- **Conta a pagar da compra** (opcional, `payable`):
  - campos: categoria de despesa e vencimento; pode já nascer paga, com a data até hoje e o método;
  - o valor é quantidade × custo, e a descrição é "Compra: produto (quantidade)";
  - o favorecido é o fornecedor do produto, a não ser que venha outro (`null`: nenhum);
  - segue as regras do Contas a pagar e exige essa funcionalidade no plano (403);
  - é lançada na mesma transação da movimentação.
- **Histórico:** `GET /products/:id/stock-movements`, paginado, da mais recente para a mais antiga, com quem lançou e a conta ligada. O saldo de antes do controle de estoque aparece sem usuário.
- **Estoque baixo:** `GET /products?lowStock=true` traz os produtos com mínimo e o estoque atual abaixo dele.
- **Situação:** o produto é inativado e reativado pela alteração (`isActive`). A exclusão é lógica (`deletedAt`); o produto excluído some das listagens e o SKU dele fica livre.
- **Foto:** JPEG ou PNG, até 2 MB, enviada como multipart no campo `photo` (`POST /products/:id/photo`); a nova substitui a anterior. `DELETE /products/:id/photo` remove.
- A listagem é paginada, em ordem de nome, com filtros por nome ou SKU (parcial, sem diferenciar acentos nem maiúsculas), categoria, fornecedor e situação. Cada produto traz a categoria (`id`, `name`) e o fornecedor (`id`, `name`) ou `null`.

## Venda de produtos

> Funcionalidade `product-sales` ("Venda de produtos"): Visualiza, Cria (vender) e Exclui (cancelar). Exige ver Comandas e Produtos. Não vem liberada no modelo padrão: o SUPER_ADMIN libera por empresa.

- Só o **ADMIN** vende e cancela (os demais perfis recebem 403); a comanda mostra a venda a todos que a acessam.
- `GET /product-sales/products?search=`: produtos ativos (nome ou SKU, até 20), com preço de venda, promocional e estoque, para a busca da comanda.
- `POST /product-sales`: um **cliente ativo** (pessoa do tipo CLIENT; senão 400) e de 1 a 50 itens, sem produto repetido (400). Cada item tem produto **ativo** da empresa (inativo: 400; inexistente: 404), quantidade inteira (1 ou mais) e valor unitário maior que zero, com até duas casas. O valor sugerido pela tela é o promocional, ou o de venda, e pode mudar.
- **Estoque:** cada item sai **ao lançar** (movimentação `SALE`). Faltando, responde 409 com o produto e o saldo ("Estoque insuficiente de X: há N em estoque"). A saída só grava se houver o suficiente: duas vendas ao mesmo tempo não passam do estoque.
- **Pagamento:** um só, `PENDING`, com o **total** dos itens e **vencimento hoje** (no fuso da empresa). É recebido pela baixa da comanda, junto com os atendimentos.
- `PATCH /product-sales/:id/cancel`: só a venda **pendente**. O pagamento fica `CANCELLED` e cada item volta ao estoque (movimentação `SALE_CANCELLED`). Venda recebida (409) ou já cancelada (409) não se cancela.
- **Pagamento protegido:** o pagamento da venda não se altera nem se exclui por `PATCH`/`DELETE /payments/:id` (409, "cancele a venda pela comanda"); a baixa funciona normalmente.
