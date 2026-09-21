# Create Entity

## Objetivo

Levar **uma** entidade do `domain.md` para o banco: schema e migration. Nada além disso.

## Instruções

1. Leia: `CLAUDE.md`, `domain.md`, `database.md` e `business-rules.md`.
2. Localize a entidade no `domain.md` e identifique atributos, tipos,
   obrigatoriedade, relacionamentos e índices.
3. Aponte o que o `domain.md` não define (tipo, unicidade, exclusão lógica).
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
