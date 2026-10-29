# Banco de Dados

## Tecnologia

Banco de dados: PostgreSQL
ORM: Prisma

- `prisma`, `@prisma/client` e `@prisma/adapter-pg` são fixados na **mesma versão exata**. O projeto usa o preview feature `partialIndexes`; ao atualizar o Prisma, revise o changelog desse recurso e confirme que `prisma migrate diff` continua sem diferenças.
- Extensões do PostgreSQL utilizadas: `pg_trgm` (busca por nome). São criadas nas migrations com `CREATE EXTENSION IF NOT EXISTS` e não são declaradas no schema.

## Valores monetários

- Utilizar `Decimal @db.Decimal(10, 2)`; nunca `Float`.
- Horários sem data (ex.: grade de recorrência) usam `DateTime @db.Time(0)`, e a API troca esses valores no formato `"HH:MM"` (ver `time-of-day.ts`).

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
- Em entidades com soft delete, constraints únicas devem ser índices parciais (`WHERE "deletedAt" IS NULL`), para que um registro excluído não bloqueie o reuso do valor. No Prisma, usar `@@unique([...], where: raw("\"deletedAt\" IS NULL"))` (preview feature `partialIndexes`).
- Regras que o Prisma não expressa no schema (ex.: `CHECK`) são adicionadas manualmente na migration em que a tabela é criada ou alterada.

## Migrations

- Sempre criar uma nova migration;
- Não editar migrations antigas;
- Nunca utilizar `prisma db push` em ambiente de produção.

## Exclusão

- Evitar exclusão física quando houver necessidade de manter histórico.
- Preferir Soft Delete utilizando o campo `deletedAt` quando aplicável.
- Todas as entidades utilizam soft delete, exceto aquelas explicitamente documentadas em contrário.

### Exceções ao soft delete

- **State**: não possui operação de exclusão (mantida via seed). Não utiliza `deletedAt`.
- **City**: não possui operação de exclusão pela aplicação (mantida via seed). Não utiliza `deletedAt`.
- **Company**: não é excluída; é inativada (`isActive`). Não utiliza `deletedAt`, e seus dados relacionados ficam inacessíveis enquanto estiver inativa (ver `business-rules.md`).
- **Appointment**: não possui exclusão; o ciclo de vida é controlado pelo `status`. Não utiliza `deletedAt`.
- **RecurringAppointment**: não possui exclusão; é desativado por `isActive`. Não utiliza `deletedAt`.
- **RecurringDay**: faz parte do agendamento recorrente e é substituído em bloco junto com ele, por isso usa exclusão física (`onDelete: Cascade`). Não utiliza `deletedAt`.
- **ClassGroup**: não possui exclusão; é inativada (`isActive`). Não utiliza `deletedAt`.
- **ClassGroupDay**: faz parte da turma e não muda depois do cadastro; segue a turma (`onDelete: Cascade`). Não utiliza `deletedAt` nem `updatedAt`.
- **ClassSession**: não possui exclusão; é cancelada (`cancelledAt`). Não utiliza `deletedAt`.
- **Notification**: não possui exclusão; é resolvida (`resolvedAt`). Não utiliza `deletedAt`.
- **AuditLog**: registro de auditoria; só recebe inserções e não é alterado nem excluído pela API. Não utiliza `deletedAt` nem `updatedAt`. Não tem relação com o cliente (`clientId`): o registro vale mesmo que o cliente seja removido.
- **AnamnesisTemplate**: não possui exclusão; é inativado (`isActive`). Não utiliza `deletedAt`.
- **AnamnesisTemplateVersion** e **AnamnesisQuestion**: imutáveis, sem exclusão nem alteração pela API (editar o modelo cria uma versão nova); as fichas ficam presas à versão em que nasceram. Não utilizam `deletedAt`.
- **Anamnesis**, **AnamnesisEntry** e **AnamnesisAnswer**: a ficha e seu histórico só crescem; não possuem exclusão nem alteração pela API (corrige-se com novo acompanhamento). Não utilizam `deletedAt`. A evolução e as respostas são guardadas criptografadas (AES-256-GCM, texto `v1:...`); a chave não fica no banco.
- **RefreshToken**: não é uma entidade de domínio, é um artefato de sessão (ver `auth.md`). Não possui exclusão; é revogado (`revokedAt`). Não utiliza `deletedAt`.

## Concorrência e SQL cru

- Quando uma regra depende de uma contagem (ex.: vagas de uma sessão de turma), a conferência e a gravação acontecem na mesma transação, com a linha "dona" da regra travada por `SELECT ... FOR UPDATE`: as outras requisições esperam a transação terminar e já contam o que ela gravou.
- O Prisma não tem trava de linha na API comum; nesses pontos usa-se `$queryRaw`/`$executeRaw` com template (os valores vão como parâmetros, nunca concatenados no texto). Tabelas e colunas entre aspas, com os nomes do banco (`"class_sessions"`, `"startAt"`).
- Para criar uma linha que pode estar sendo criada ao mesmo tempo por outra requisição (ex.: a sessão de um horário de turma), usa-se `INSERT ... ON CONFLICT DO NOTHING` seguido da leitura com trava: um erro de unicidade dentro da transação a abortaria no Postgres.
- Os instantes são gravados em UTC (o banco roda em UTC); nas consultas cruas, os `Date` vão como parâmetro, como no restante do Prisma.

## Índices

Criar índices para campos frequentemente utilizados em:

- buscas
- filtros
- relacionamentos

## Busca por texto

- Buscas parciais por nome não diferenciam acentos nem maiúsculas.
- Para isso, a entidade mantém uma coluna `normalizedName` (nome sem acentos e em minúsculas), preenchida pela aplicação com `normalizeForSearch()` a cada criação ou alteração do nome, e nunca aceita do cliente nem retornada pela API.
- A busca compara o termo normalizado com essa coluna (`LIKE '%termo%'`), acelerada por índice GIN trigram: `@@index([normalizedName(ops: raw("gin_trgm_ops"))], type: Gin)`.
- Ao adicionar a coluna em uma tabela com dados, a migration deve preenchê-la antes de torná-la obrigatória.
- Entidades com busca por nome: City, People, Service, PaymentMethod e ClassGroup (nome opcional: sem nome, a coluna fica vazia).
- Horários de janelas (BusinessHour) e de recorrências (RecurringDay) são comparados no fuso da empresa (`Company.timezone`), com as conversões em `common/time/time-zone.ts`. Datas puras (colunas `date`, como o período da recorrência) são tratadas pelo calendário, sem conversão.
