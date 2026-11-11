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
- **Estoque:** quantidades inteiras, sem casas decimais. O estoque atual é obrigatório ao criar (0 ou mais) e é alterado direto no produto (não há movimentação nesta versão). O mínimo e o máximo são opcionais (0 ou mais), e o mínimo não pode passar do máximo (400); na alteração, o que não for enviado vem do que está gravado.
- **Situação:** o produto é inativado e reativado pela alteração (`isActive`). A exclusão é lógica (`deletedAt`); o produto excluído some das listagens e o SKU dele fica livre.
- **Foto:** JPEG ou PNG, até 2 MB, enviada como multipart no campo `photo` (`POST /products/:id/photo`); a nova substitui a anterior. `DELETE /products/:id/photo` remove.
- A listagem é paginada, em ordem de nome, com filtros por nome ou SKU (parcial, sem diferenciar acentos nem maiúsculas), categoria, fornecedor e situação. Cada produto traz a categoria (`id`, `name`) e o fornecedor (`id`, `name`) ou `null`.
