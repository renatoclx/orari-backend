# Banco de Dados

## Tecnologia

Banco de dados: PostgreSQL
ORM: Prisma

## Datas

Todas as entidades persistentes devem possuir:

- createdAt
- updatedAt
- deletedAt

- Utilizar timezone UTC.
- Os campos de data devem ser opcionais.
- Sempre registrar o updatedAt caso haja alteração e/ou remoção de uma entidade.

## Convenções

- Utilizar nomes de tabelas e colunas em inglês.
- Evitar abreviações.
- Modelos representam entidades do domínio.

## IDs

- Não utilizar Auto Increment e int para chaves primárias;
- Utilizar UUID para TODAS as entidades;
- ID's nunca devem ser alterados;

## Relacionamentos

- Explicitar relações caso houver ambiguidade;
- Tabelas de junção devem utilizar um nome composto representando as duas entidades relacionadas.

## Restrições

- Utilizar constraints únicas quando fizerem parte da regra de negócio.
- Evitar validações apenas na aplicação.

## Migrations

- Sempre criar uma nova migration;
- Não editar migrations antigas;
- Nunca utilizar `prisma db push` em ambiente de produção.

## Exclusão

- Evitar exclusão física quando houver necessidade de manter histórico.
- Preferir Soft Delete utilizando o campo `deletedAt` quando aplicável.
- Todas as entidades utilizam soft delete, exceto aquelas explicitamente documentadas em contrário.
- Eventuais exceções ao soft delete (entidades imutáveis, mantidas via seed, hard delete condicionado a regra de negócio, etc.) devem ser documentadas aqui e, quando a decisão não for óbvia, em `decisions.md`.

## Índices

Criar índices para campos frequentemente utilizados em:

- buscas
- filtros
- relacionamentos
