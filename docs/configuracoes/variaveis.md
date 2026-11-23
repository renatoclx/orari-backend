# Variáveis de ambiente (`.env.production`)

Conceito em [conceitos.md](conceitos.md#variáveis-de-ambiente-e-env).

## O arquivo

- **Onde:** `/root/orari-backend/.env.production`, só na VPS. Permissão `600`
  (só o root lê).
- **Modelo:** `.env.production.example` no repositório (nomes e explicações, sem
  valores).
- **Quem lê:**
  - o **Docker Compose** (`--env-file`), para preencher os `${…}` do
    `docker-compose.prod.yml` (domínios do Caddy, senha do Postgres, pasta da
    landing);
  - a **API** (`env_file:`), que recebe todas as linhas.
- **O frontend não lê este arquivo.** O único valor dele (`API_URL`) está no
  próprio Compose.

**A API confere o arquivo ao subir** (`src/config/env.validation.ts`). Se algo
faltar ou estiver fraco, ela **não sobe** e o log (`dcp logs api`) diz o quê, em
"Configuração inválida". Isso evita, por exemplo, subir a produção com o segredo de
exemplo.

## Cada variável

### Geral

| Variável   | Exemplo / valor | O que faz                                                                                              | Se faltar / errar                     |
| ---------- | --------------- | ------------------------------------------------------------------------------------------------------ | ------------------------------------- |
| `NODE_ENV` | `production`    | Liga as regras rígidas (segredo forte, CORS obrigatório, Swagger desligado, e-mail sem chave recusado) | Roda com as regras de desenvolvimento |

### Endereços (lidos pelo Caddy e pela API)

| Variável          | Valor                          | O que faz                                                                                              |
| ----------------- | ------------------------------ | ------------------------------------------------------------------------------------------------------ |
| `API_DOMAIN`      | `api.orariapp.com.br`          | Endereço da API no Caddy. `:80` = só HTTP, para teste por IP                                           |
| `APP_DOMAIN`      | `app.orariapp.com.br`          | Endereço do sistema no Caddy; a API usa para montar o link do "Esqueci minha senha"                    |
| `SITE_DOMAIN`     | `orariapp.com.br`              | Endereço da landing no Caddy                                                                           |
| `SITE_WWW_DOMAIN` | `www.orariapp.com.br`          | Só redireciona para o `SITE_DOMAIN`                                                                    |
| `LANDING_DIR`     | `/www/wwwroot/orariapp.com.br` | Pasta da landing na VPS (montada só leitura no Caddy)                                                  |
| `CORS_ORIGIN`     | `https://app.orariapp.com.br`  | Quais sites o navegador deixa chamar a API. Obrigatória em produção                                    |
| `TRUST_PROXY`     | `1`                            | Quantos proxies há na frente da API (o Caddy). Faz a API ler o IP real do usuário no `X-Forwarded-For` |

### Banco

| Variável            | Valor                                                  | O que faz                                                                      |
| ------------------- | ------------------------------------------------------ | ------------------------------------------------------------------------------ |
| `POSTGRES_USER`     | `orari`                                                | Usuário que o contêiner do Postgres cria na 1ª subida                          |
| `POSTGRES_PASSWORD` | **segredo** (`openssl rand -hex 24`)                   | Senha desse usuário                                                            |
| `POSTGRES_DB`       | `orari`                                                | Nome do banco                                                                  |
| `DATABASE_URL`      | `postgresql://orari:SENHA@db:5432/orari?schema=public` | Como a API chega ao banco. `db` é o nome do serviço; a senha é a mesma de cima |
| `DB_LOCAL_PORT`     | (opcional) `5432`                                      | Porta do banco no próprio servidor, para o túnel do DBeaver                    |

A senha é gerada só com letras e números (`-hex`) para não precisar de "escape"
dentro da `DATABASE_URL`.

**Trocar a senha do banco não é só mudar o arquivo:** o Postgres guarda a senha
**dentro do volume**, definida na primeira subida. Passos: mudar no banco
(`dcp exec db psql -U orari -d orari -c "ALTER USER orari PASSWORD 'nova';"`),
depois nas duas linhas do arquivo, e `dcp up -d api`.

### Login e segurança

| Variável                   | Valor                                   | O que faz                                                                                  | Se perder / trocar                                            |
| -------------------------- | --------------------------------------- | ------------------------------------------------------------------------------------------ | ------------------------------------------------------------- |
| `JWT_SECRET`               | **segredo** (`openssl rand -hex 48`)    | Assina os logins e os links das fotos. Em produção: ≥ 32 caracteres e diferente do exemplo | Todos são desconectados (só isso)                             |
| `JWT_EXPIRES_IN`           | `15m`                                   | Duração do token de acesso                                                                 | –                                                             |
| `JWT_REFRESH_EXPIRES_IN`   | `7d`                                    | Por quanto tempo o login se renova sem pedir a senha                                       | –                                                             |
| `ANAMNESIS_ENCRYPTION_KEY` | **segredo** (`openssl rand -base64 32`) | Criptografa as fichas de anamnese (dados de saúde). Obrigatória                            | **As fichas viram lixo. Nunca troque num sistema com fichas** |

### Avisos no celular (opcionais)

| Variável            | Valor                                       | O que faz                                               |
| ------------------- | ------------------------------------------- | ------------------------------------------------------- |
| `VAPID_PUBLIC_KEY`  | gerada (`npx web-push generate-vapid-keys`) | Identifica o Orari nos serviços de push (não é segredo) |
| `VAPID_PRIVATE_KEY` | **segredo**                                 | Par da pública                                          |
| `VAPID_SUBJECT`     | `mailto:contato@…`                          | Contato para os serviços de push                        |

As três vão juntas, ou nenhuma (aí os avisos ficam desligados). Trocar o par faz os
aparelhos inscritos deixarem de receber.

### E-mail

| Variável         | Valor                                     | O que faz                                                   |
| ---------------- | ----------------------------------------- | ----------------------------------------------------------- |
| `RESEND_API_KEY` | **segredo** (`re_…`, do painel do Resend) | Envio dos e-mails. Sem ela, em produção, o envio é recusado |
| `MAIL_FROM`      | `"Orari <nao-responda@orariapp.com.br>"`  | Remetente (domínio verificado no Resend)                    |

Ver [email.md](email.md).

### Primeiro administrador (temporárias)

`SEED_COMPANY_CORPORATE_REASON`, `SEED_COMPANY_DOCUMENT`, `SEED_COMPANY_SUBDOMAIN`,
`SEED_SUPER_ADMIN_NAME`, `SEED_SUPER_ADMIN_EMAIL`, `SEED_SUPER_ADMIN_PASSWORD`:
usadas **uma vez** pelo seed (`dcp exec api npx prisma db seed`) e **apagadas
depois**. Ver [`../deploy.md`](../deploy.md), etapas 5 e 6.

### Definidas na imagem (não precisam estar no arquivo)

| Variável      | Valor           | Onde                |
| ------------- | --------------- | ------------------- |
| `PORT`        | `3333`          | `Dockerfile` da API |
| `UPLOADS_DIR` | `/data/uploads` | `Dockerfile` da API |

## Como mexer no arquivo

**Ver sem mostrar os segredos:**

```bash
cd ~/orari-backend
sed -E 's/(PASSWORD|SECRET|KEY)=.*/\1=(oculto)/; s#(//orari:)[^@]*#\1(oculto)#' .env.production
```

**Acrescentar um segredo** (não aparece na tela nem no histórico):

```bash
read -rs -p "Cole o valor e tecle Enter: " VALOR; echo
echo "NOME=$VALOR" >> .env.production
unset VALOR
grep -c '^NOME=' .env.production   # 1
```

**Acrescentar um valor comum:** `echo 'NOME=valor' >> .env.production`, ou editar
com `nano .env.production`.

**Apagar uma linha:** `sed -i '/^NOME=/d' .env.production`.

**Aplicar:** `dcp up -d api` (e `dcp up -d caddy` se mudou domínio ou pasta da
landing). `dcp restart` **não** relê o arquivo.

**Cópia de segurança:** o conteúdo do `.env.production` deve estar no gerenciador
de senhas. Sem ele, um servidor novo precisaria de chaves novas, e a
`ANAMNESIS_ENCRYPTION_KEY` **não pode** ser nova.

## Para outros projetos

- Um `.env.example` no Git, o `.env` de verdade fora dele.
- **Validar as variáveis ao iniciar** e recusar subir com configuração fraca
  (segredo curto, valor de exemplo). Evita o pior tipo de erro: o que funciona,
  mas inseguro.
- Separar o que é **configuração** (domínios, durações) do que é **segredo**
  (senhas, chaves), e só os segredos no gerenciador de senhas.
- Gerar segredos com `openssl rand`, nunca inventar.
