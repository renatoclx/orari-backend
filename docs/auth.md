# Autenticação

> O template já implementa esta estratégia (`AuthModule` + `UserModule`,
> `JwtAuthGuard` global, `@Public()` para rotas isentas). O `UserModule`
> incluído é mínimo (apenas `findByEmailWithPassword`, sem endpoint de
> cadastro) — cada projeto deve estendê-lo conforme seu próprio domínio de
> usuário.

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
- A autenticação identifica o usuário.
- A autorização define o que ele pode acessar.

## Logout

- O logout ocorre apenas no cliente através da remoção do token.
- Não haverá blacklist de tokens.
- Sempre remover o token após a realização de um logout.
