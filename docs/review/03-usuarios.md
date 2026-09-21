# 03 – Usuários

Contas de acesso, sempre vinculadas a uma empresa.

**PR:** 4 (`feat/company-e-usuarios`) · **Regras:** [business-rules.md § Usuários e acesso, Senhas](../business-rules.md)

## Regras em resumo

- **SUPER_ADMIN** gerencia usuários de qualquer empresa **ativa**, informando
  `companyId`. **ADMIN** gerencia só os da própria empresa e **não enxerga
  contas SUPER_ADMIN**. **USER** recebe 403.
- Só SUPER_ADMIN cria ou promove alguém a SUPER_ADMIN.
- Ninguém exclui a própria conta nem altera o próprio tipo.
- A empresa do usuário não muda depois de criada.
- Senha: 8 a 72 caracteres, confirmada, gravada com bcrypt e **nunca retornada**
  (`omit` do Prisma em todas as consultas). A troca tem rota própria e não exige
  a senha atual.
- E-mail único entre os usuários não excluídos (índice parcial): o e-mail de um
  usuário excluído pode ser reutilizado.

## Onde está

| Arquivo | Responsabilidade |
| ------- | ---------------- |
| `modules/user/user.service.ts` | `visibleTo()` (alcance por tipo), criação, redefinição de senha, exclusão lógica |
| `modules/user/user.controller.ts` | `@Roles(SUPER_ADMIN, ADMIN)` |
| `modules/user/dto/create-user.dto.ts` | `companyId` opcional (obrigatório para SUPER_ADMIN), confirmação de senha |
| `modules/user/dto/reset-password.dto.ts` | Nova senha + confirmação |
| `modules/user/decorators/is-user-password.decorator.ts` | Regras de senha compartilhadas |

## Rotas

| Método | Rota | Observação |
| ------ | ---- | ---------- |
| POST | `/users` | SUPER_ADMIN informa `companyId`; ADMIN herda a própria |
| GET | `/users` (`?companyId`) | Filtro por empresa só para SUPER_ADMIN |
| GET/PATCH/DELETE | `/users/:id` | Fora do alcance → 404 |
| PATCH | `/users/:id/password` | Redefinição pelo administrador |

## Testes

`user.service.spec.ts` (22), `create-user.dto.spec.ts` (12).

## O que olhar com atenção

- **`visibleTo()` concentra o alcance** de cada tipo; é o ponto crítico de
  segurança do módulo. Vale ler com calma o filtro `company: { isActive: true }`
  para SUPER_ADMIN e o `type: { not: SUPER_ADMIN }` para ADMIN.
- **Um ADMIN sozinho pode sair da empresa?** Não pode excluir a si mesmo, mas
  pode excluir o outro ADMIN e depois ser excluído por um SUPER_ADMIN. Não há
  regra de "último administrador".
- A senha não entra no PATCH comum: enviar `password` retorna 400.
