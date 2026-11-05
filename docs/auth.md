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
  recusado (401). A conferência e a revogação acontecem num só comando no
  banco: duas renovações simultâneas com o mesmo token não geram dois pares;
  só a primeira é aceita.
- **Múltiplas sessões:** cada login gera um refresh token independente
  (tabela `RefreshToken`), permitindo o mesmo usuário autenticado em mais
  de um dispositivo ao mesmo tempo; revogar um não afeta os demais.
- As mesmas checagens do login valem no refresh: usuário precisa continuar
  ativo e a empresa, ativa — caso contrário, o token é revogado e a troca é
  recusada.
- **Fim das sessões:** redefinir a senha, inativar ou reativar um usuário
  revoga todos os refresh tokens dele. O access token em uso vale até
  expirar, exceto o de usuário inativado, que o `JwtStrategy` recusa na hora.

## Tokens

- Nunca armazenar informações sensíveis dentro do JWT.
- O token deve conter apenas informações necessárias para identificação.

## Usuário autenticado

- `GET /auth/me` (protegida) devolve o usuário do access token enviado: `id`,
  `name`, `email`, `type`, `professional` (`id` e `name` do profissional
  vinculado ao usuário, ou `null` sem vínculo, com o profissional inativo ou
  com vínculo a um funcionário; é por ele que o front mostra o menu de
  anamnese), `person` (`id`, `name`, `type` e `profession` da pessoa vinculada,
  profissional ou funcionário, ou `null` sem vínculo ou com a pessoa inativa;
  base do futuro controle de acesso por função) e `company` (`id`, `name`,
  `timezone`, `logoUrl`).
  O `name` da empresa é o nome fantasia ou, sem ele, a razão social; o
  `timezone` permite ao front exibir os horários no fuso da empresa.
- Também traz `access.features`: uma entrada por funcionalidade (`feature`, `view`,
  `edit`, `create`, `remove`) com o que a empresa do usuário pode usar (ver
  `business-rules.md`, "Acessos e limites da empresa"). É por ele que o front
  esconde menus e botões. O SUPER_ADMIN não é limitado por plano: recebe todas as
  ações de todas as funcionalidades.
- Os dados vêm do banco a cada chamada, não do token: refletem alterações
  feitas depois do login. A senha nunca é lida nessa consulta.

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
- **Limite de tentativas** (`@nestjs/throttler`, por IP): `POST /auth/login`
  aceita 5 tentativas por minuto e `POST /auth/refresh`, 20; acima disso, 429.
  A contagem fica em memória, por instância da API. Atrás de proxy, definir
  `TRUST_PROXY` (número de proxies à frente da API) para que o IP seja o do
  cliente e não o do proxy; sem a variável, o `X-Forwarded-For` não é confiado.
- O login compara a senha mesmo quando o e-mail não existe (com um hash fixo),
  para o tempo de resposta não revelar quais e-mails têm conta.

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

## Configuração de produção

- A API valida as variáveis de ambiente na subida (`src/config/env.validation.ts`)
  e se recusa a iniciar, listando o que está errado. Sempre exige `DATABASE_URL`,
  `JWT_SECRET` e as durações `JWT_EXPIRES_IN` e `JWT_REFRESH_EXPIRES_IN`.
- Com `NODE_ENV=production`, exige também `JWT_SECRET` com ao menos 32
  caracteres e diferente do valor de exemplo, e `CORS_ORIGIN` com a lista de
  origens permitidas.
- Headers de segurança com o `helmet`; os arquivos de `/uploads` seguem
  acessíveis de outra origem (o front os exibe).
## Portal do cliente (autenticação separada)

- O cliente do app **não é usuário**: tem uma **conta do cliente** (`ClientAccount`), com telefone e senha, única no Orari. Em cada clínica, o cliente é o cadastro dela (pessoa CLIENT) ligado à conta (regras em `business-rules.md`, "Portal do cliente").
- A senha é guardada com bcrypt, com o mesmo custo das senhas dos usuários; o login compara a senha mesmo quando o telefone não tem conta, para a resposta levar o mesmo tempo.
- O **token do portal** é uma string aleatória opaca (não é JWT), como o refresh token: só o hash (SHA-256) fica na tabela `PortalSession`, com validade de 90 dias, aparelho (`userAgent`) e revogação própria. A sessão é **da conta**. Trocar a senha tira os outros aparelhos; criar uma senha nova pelo link da clínica tira todos.
- As rotas da conta (`/portal-account/...`) e dos estabelecimentos (`/portal/:slug/...`) são `@Public()` para o `JwtAuthGuard`; as que exigem a conta entrada usam o `PortalAuthGuard`, que confere o token no banco e, nas rotas de um estabelecimento, procura o cadastro da conta nessa clínica (sem cadastro: 403 `NOT_A_CLIENT`).
- **Isolamento:** o token do portal não é um JWT, então o `JwtAuthGuard` o recusa (401) em todas as rotas da clínica; e o JWT da clínica não está na tabela de sessões, então o `PortalAuthGuard` o recusa (401) no app. Uma conta só enxerga, em cada clínica, o próprio cadastro.
- O código do portal (quando voltar, para confirmar o telefone) é gravado como HMAC (segredo da API + empresa + telefone): com só um milhão de códigos possíveis, um hash simples seria quebrado por força bruta se a tabela vazasse.

- O Swagger (`/docs`) fica desligado em produção, a menos que
  `SWAGGER_ENABLED=true`.
- Sugestão para o access token: `JWT_EXPIRES_IN=15m`, com renovação pelo refresh
  token.
