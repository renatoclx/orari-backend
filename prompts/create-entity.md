# Create Entity

## Objetivo

Levar **uma** entidade de `docs/domain/` para o banco: schema e migration. Nada além disso.

## Instruções

1. Leia: `CLAUDE.md`, `domain/` (o arquivo da área), `database.md` e `business-rules/` (o arquivo da área).
2. Localize a entidade no arquivo da área em `docs/domain/` e identifique atributos, tipos,
   obrigatoriedade, relacionamentos e índices.
3. Aponte o que o domínio não define (tipo, unicidade, exclusão lógica).
   **No máximo 2 perguntas.** O que não bloquear vira pendência.
4. Apresente o plano: campos, relacionamentos, índices e constraints.
   **Aguarde aprovação.**
5. Depois de aprovado:
   - atualize o `prisma/schema.prisma`;
   - gere a migration e confirme que não há diferença entre schema e banco;
   - se houver constraint que o Prisma não expressa (ex.: CHECK), acrescente na
     migration com comentário explicando o porquê.
6. Commit do schema e da migration.

## Limites

- **Uma entidade por vez.** Relacionamentos com entidades ainda inexistentes
  viram pendência.
- Não crie Module, Controller, Service, DTO nem teste.
- Não altere regra de negócio: se faltar regra, pare e use o `define-rules.md`.

## Ao finalizar

- Arquivos alterados e o que a migration faz.
- Decisões de modelagem.
- Pendências.
- **Pare e aguarde revisão.**
