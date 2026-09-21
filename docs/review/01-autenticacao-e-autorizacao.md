# 01 – Autenticação e autorização

Login por JWT e controle de acesso por tipo de usuário.

**PR:** 4 (`feat/company-e-usuarios`) · **Regras:** [business-rules.md § Tipos de usuário, Usuários e acesso, Senhas](../business-rules.md)

## Regras em resumo

- Todas as rotas exigem token, exceto `GET /` e `POST /auth/login`.
- **SUPER_ADMIN** administra a plataforma; **ADMIN**, a própria empresa;
  **USER** opera os dados da empresa sem gerenciar usuários.
- O login é recusado para usuário excluído e para usuário de empresa inativa,
  sempre com a mesma mensagem genérica.
- O token carrega apenas `sub` e `email`. A cada requisição o usuário é
  recarregado do banco, então excluir o usuário ou inativar a empresa **derruba
  o acesso na hora**, sem esperar o token expirar.

## Onde está

| Arquivo | Responsabilidade |
| ------- | ---------------- |
| `modules/auth/auth.service.ts` | Login: usuário → senha → empresa ativa |
| `modules/auth/strategies/jwt.strategy.ts` | Recarrega o usuário e monta o `request.user` |
| `modules/auth/guards/jwt-auth.guard.ts` | Guard global; `@Public()` isenta |
| `modules/auth/guards/roles.guard.ts` | Guard global de tipos; responde 403 |
| `modules/auth/auth.module.ts` | Ordem dos guards globais |

## Rotas

| Método | Rota | Acesso |
| ------ | ---- | ------ |
| POST | `/auth/login` | Público |

## Testes

`auth.service.spec.ts` (4), `jwt.strategy.spec.ts` (3), `roles.guard.spec.ts` (5),
`auth.controller.spec.ts` (1).

## O que olhar com atenção

- **Custo por requisição:** duas consultas extras (usuário e empresa) em toda
  requisição autenticada. É o preço da invalidação imediata — vale decidir se
  compensa ou se um cache curto seria melhor.
- **Ordem dos guards** em `auth.module.ts`: o `RolesGuard` depende do
  `request.user` preenchido pelo `JwtAuthGuard`. Trocar a ordem quebra silenciosamente.
- A verificação da empresa acontece **depois** da senha, para não revelar o
  status da empresa a quem não tem a credencial.
