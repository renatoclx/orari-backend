# Domínio: Categorias e produtos

> Parte de [`domain/`](README.md). Produtos que a empresa cadastra e as categorias que os agrupam.

## ProductCategory

- Representa uma categoria de produtos da empresa (ex.: Cosméticos, Acessórios).

### Atributos

| Nome           | Descrição                                       |
| -------------- | ----------------------------------------------- |
| id             | Identificador único                             |
| companyId      | Código da empresa                               |
| name           | Nome da categoria                               |
| normalizedName | Nome sem acentos e em minúsculas (para a busca) |
| isActive       | Categoria ativa ou inativa                      |

### Relacionamentos

- Uma empresa pode ter várias categorias de produto.
- Uma categoria pode ter vários produtos.

---

## Product

- Representa um produto que a empresa cadastra, com preços e estoque.

### Atributos

#### Dados básicos

| Nome           | Descrição                                                    |
| -------------- | ------------------------------------------------------------ |
| id             | Identificador único                                          |
| companyId      | Código da empresa                                            |
| name           | Nome do produto                                              |
| normalizedName | Nome sem acentos e em minúsculas (para a busca)              |
| description    | Descrição do produto (opcional)                              |
| sku            | Código de identificação interno (opcional)                   |
| categoryId     | Código da categoria                                          |
| supplierId     | Código do fornecedor (opcional; pessoa do tipo SUPPLIER)     |
| photoUrl       | Caminho da foto (opcional)                                   |
| measureUnit    | Unidade de medida (opcional): UN, CX, PCT, KG, G, L, ML ou M |
| isActive       | Produto ativo ou inativo                                     |

#### Preços e custos

| Nome             | Descrição                                 |
| ---------------- | ----------------------------------------- |
| salePrice        | Preço de venda                            |
| purchasePrice    | Preço de custo                            |
| profitMargin     | Margem de lucro em percentual (calculada) |
| promotionalPrice | Preço promocional (opcional)              |

#### Estoque

| Nome         | Descrição                 |
| ------------ | ------------------------- |
| currentStock | Estoque atual             |
| minimalStock | Estoque mínimo (opcional) |
| maximumStock | Estoque máximo (opcional) |

### Relacionamentos

- Um produto pertence a uma empresa.
- Um produto pertence a uma categoria.
- Um produto pode ter um fornecedor (pessoa do tipo SUPPLIER).
