# Autenticação

> Implementação atual: `AuthModule` (login, refresh, logout, `JwtStrategy`,
> guards globais `JwtAuthGuard` e `RolesGuard`) e `UserModule` (CRUD em
> `/users` e redefinição de senha). Rotas isentas de autenticação usam
> `@Public()`; rotas restritas por tipo de usuário usam `@Roles()`. O
> primeiro SUPER_ADMIN é criado pelo seed (`npm run prisma:seed`, variáveis
> `SEED_*`). As regras de acesso estão em `business-rules.md`.

## Estratégia

- A autenticação será realizada através de JWT.
- O tempo de expiração do access token será definido pela configuração da
  aplicação (`JWT_EXPIRES_IN`, padrão `1d`).
- Refresh token: `POST /auth/login` retorna `{ accessToken, refreshToken }`.
  Quando o access token expira, `POST /auth/refresh` troca um refresh token
  válido por um novo par — sem pedir a senha de novo.

## Refresh token

- É uma string aleatória opaca (não é JWT), gerada com alta entropia; só o
  seu hash (SHA-256) é persistido, nunca o valor bruto.
- Validade própria, configurada por `JWT_REFRESH_EXPIRES_IN` (padrão `7d`),
  independente do access token.
- **Rotação:** cada refresh token só pode ser usado uma vez. A cada
  `POST /auth/refresh`, o token apresentado é revogado e um novo par
  (access + refresh) é emitido. Um token já revogado ou expirado é
  recusado (401).
- **Múltiplas sessões:** cada login gera um refresh token independente
  (tabela `RefreshToken`), permitindo o mesmo usuário autenticado em mais
  de um dispositivo ao mesmo tempo; revogar um não afeta os demais.
- As mesmas checagens do login valem no refresh: usuário precisa continuar
  ativo e a empresa, ativa — caso contrário, o token é revogado e a troca é
  recusada.

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

- `POST /auth/logout` revoga o refresh token informado, para que não possa
  mais ser trocado por um novo access token.
- O access token em si não é invalidado (não há blacklist dele): continua
  válido até sua própria expiração (`JWT_EXPIRES_IN`).
- O cliente sempre remove ambos os tokens localmente após o logout.
