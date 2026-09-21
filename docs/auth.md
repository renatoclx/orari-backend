# Autenticação

> Implementação atual: `AuthModule` (login, `JwtStrategy`, guards globais
> `JwtAuthGuard` e `RolesGuard`) e `UserModule` (CRUD em `/users` e
> redefinição de senha). Rotas isentas de autenticação usam `@Public()`; rotas
> restritas por tipo de usuário usam `@Roles()`. O primeiro SUPER_ADMIN é
> criado pelo seed (`npm run prisma:seed`, variáveis `SEED_*`). As regras de
> acesso estão em `business-rules.md`.

## Estratégia

- A autenticação será realizada através de JWT;
- O tempo de expiração do Access Token será definido pela configuração da aplicação.
- Não implementar refresh token;

## Tokens

- Nunca armazenar informações sensíveis dentro do JWT.
- O token deve conter apenas informações necessárias para identificação.

## Guards

- Toda rota protegida deve utilizar um Guard apropriado;
- Por padrão, utilizar JwtAuthGuard;

## Payload

O payload do JWT deve conter apenas as informações necessárias para identificação do usuário.

Exemplo:

- sub
- email

## Senhas

- Nunca armazenar senhas em texto puro.
- Utilizar bcrypt para hash das senhas.
- Nunca retornar hashes nas respostas da API.
- O atributo de comparação de senha não deve ser persistido, ele deve ser utilizado apenas na validação.

## Segurança

- Nunca confiar em dados enviados pelo cliente.
- Sempre utilizar request.user.

## Autorização

- Autenticação e autorização possuem responsabilidades diferentes.
- A cada requisição autenticada, o `JwtStrategy` recarrega o usuário do banco e preenche o `request.user` com `id`, `email`, `type` e `companyId`. Por isso, um token deixa de valer imediatamente quando o usuário é excluído ou sua empresa fica inativa.
- Restrições por tipo de usuário são declaradas com `@Roles()` e verificadas pelo `RolesGuard` global (resposta 403).
- Nos controllers, o usuário autenticado é obtido com `@CurrentUser()`.
- O escopo por empresa é aplicado nos Services a partir do `request.user`: `resolveCompanyScope()` define em qual empresa o usuário pode agir, e `ownedByCompany()` filtra os registros de dono misto (contatos e endereços). A empresa nunca é aceita do payload quando pode ser derivada do usuário autenticado.
- Registros fora do alcance do usuário respondem 404, para não revelar sua existência. Pedir explicitamente outra empresa (ex.: `companyId` no filtro ou no payload) responde 403.
- A autenticação identifica o usuário.
- A autorização define o que ele pode acessar.

## Logout

- O logout ocorre apenas no cliente através da remoção do token.
- Não haverá blacklist de tokens.
- Sempre remover o token após a realização de um logout.
