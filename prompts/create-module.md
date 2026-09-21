# Create Module

## Objetivo

Implementar a camada de API de **uma** entidade que já existe no schema:
Module, Controller, Service e DTOs.

## Instruções

1. Leia: `CLAUDE.md`, `architecture.md`, `coding-standards.md`,
   `business-rules.md` e `auth.md`.
2. Confirme que a entidade já está no schema. Se não estiver, pare e use o
   `create-entity.md`.
3. Apresente o plano: rotas e status, escopo de acesso (quem enxerga o quê),
   validações dos DTOs e quais Services de outros módulos serão usados.
   **Aguarde aprovação.**
4. Depois de aprovado, implemente seguindo os padrões existentes:
   - escopo por empresa vindo do `request.user`, nunca do payload;
   - reutilize o que já existe em `src/common` antes de criar algo novo;
   - comente o *porquê* das partes não óbvias.
5. Commit do módulo.

## Limites

- **Um módulo por vez.**
- Não implemente regra que não esteja no `business-rules.md`.
- Não altere schema nem migration.
- Não escreva testes (é a etapa seguinte).

## Ao finalizar

- Arquivos criados e rotas expostas.
- Decisões e reaproveitamentos.
- Pendências.
- **Pare e aguarde revisão.**
