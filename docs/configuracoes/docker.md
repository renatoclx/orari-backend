# Docker e Docker Compose

Conceitos (imagem, contêiner, volume) em [conceitos.md](conceitos.md#contêiner-e-docker).

## Por que Docker no Orari

| Sem Docker                                                        | Com Docker                                             |
| ----------------------------------------------------------------- | ------------------------------------------------------ |
| Instalar Node, PostgreSQL, Caddy à mão na VPS, nas versões certas | Um `up` sobe tudo, nas versões fixadas nos arquivos    |
| "No meu computador funciona" e no servidor não                    | A mesma imagem roda igual nos dois                     |
| Atualizar = mexer no servidor vivo                                | Atualizar = construir imagem nova e trocar o contêiner |
| O banco pode ficar exposto por engano                             | O banco só existe na rede interna do Docker            |
| Mudar de servidor = reinstalar tudo                               | Mudar = `git clone` + `.env.production` + backup       |

O custo: aprender os comandos e cuidar do disco (imagens e cache acumulam).

## Os arquivos

Todos no repositório `orari-backend`:

| Arquivo                        | Papel                                                                  |
| ------------------------------ | ---------------------------------------------------------------------- |
| `Dockerfile`                   | Receita da imagem da **API**                                           |
| `../orari-frontend/Dockerfile` | Receita da imagem do **frontend** (no outro repositório)               |
| `docker-compose.prod.yml`      | Os 4 serviços de produção, como se ligam, volumes e portas             |
| `docker-compose.yml`           | Só o banco, para o **desenvolvimento** no seu computador               |
| `.env.production` (só na VPS)  | Variáveis e segredos lidos pelo Compose e pela API                     |
| `Caddyfile`                    | Configuração do Caddy (ver [caddy-e-dominios.md](caddy-e-dominios.md)) |

## Os 4 serviços

O projeto do Compose se chama `orari-prod` (linha `name:` do arquivo). Por isso os
contêineres aparecem como `orari-prod-api-1`, `orari-prod-db-1` etc., e os volumes
como `orari-prod_pgdata`.

| Serviço    | Imagem                         | Porta exposta para fora           | Função                                                       |
| ---------- | ------------------------------ | --------------------------------- | ------------------------------------------------------------ |
| `caddy`    | `caddy:2` (oficial)            | **80 e 443**                      | Recepção: HTTPS e encaminhamento                             |
| `frontend` | construída do `orari-frontend` | nenhuma                           | Telas (Next.js), porta interna 3000                          |
| `api`      | construída do `orari-backend`  | nenhuma                           | API (NestJS), porta interna 3333; roda as migrações ao subir |
| `db`       | `postgres:16-alpine` (oficial) | só `127.0.0.1:5432` (no servidor) | Banco PostgreSQL                                             |

**Rede interna:** dentro do Compose, cada serviço encontra o outro **pelo nome**.
Por isso a `DATABASE_URL` usa o host `db`, e o frontend chama a API em
`http://api:3333`. Esses nomes só existem lá dentro; de fora, nada alcança o
`frontend`, a `api` ou o `db`, só o Caddy.

**Por que o banco publica `127.0.0.1:5432`:** é só para olhar o banco pelo DBeaver
com um túnel SSH ([`../deploy.md`](../deploy.md), "Ver o banco no DBeaver").
`127.0.0.1` significa "só o próprio servidor": a porta não fica aberta para a
internet.

### O `docker-compose.prod.yml` comentado

```yaml
name: orari-prod # nome do projeto (prefixo dos contêineres e volumes)

services:
  db:
    image: postgres:16-alpine # imagem oficial; "alpine" = versão enxuta
    restart: unless-stopped # volta sozinho se cair ou se o servidor reiniciar
    environment: # o Postgres cria usuário/senha/banco na 1ª subida
      POSTGRES_USER: ${POSTGRES_USER} # ${...} vem do .env.production
      POSTGRES_PASSWORD: ${POSTGRES_PASSWORD}
      POSTGRES_DB: ${POSTGRES_DB}
    ports:
      - "127.0.0.1:${DB_LOCAL_PORT:-5432}:5432" # só no servidor; ":-5432" = padrão
    volumes:
      - pgdata:/var/lib/postgresql/data # os dados ficam no volume
    healthcheck: # o Docker pergunta "está pronto?" a cada 5 s
      test: ["CMD-SHELL", "pg_isready -U $${POSTGRES_USER} -d $${POSTGRES_DB}"]

  api:
    build: . # constrói com o Dockerfile desta pasta
    restart: unless-stopped
    env_file: .env.production # todas as variáveis do arquivo entram na API
    depends_on:
      db:
        condition: service_healthy # só sobe depois que o banco está pronto
    volumes:
      - uploads:/data/uploads # fotos e logos
    healthcheck: # "a API responde?" a cada 30 s
      test:
        ["CMD-SHELL", "wget -qO- http://localhost:3333/ >/dev/null || exit 1"]

  frontend:
    build:
      context: ../orari-frontend # o código do outro repositório, ao lado
      args:
        API_URL: http://api:3333 # entra no build (o Next grava esse valor)
    environment:
      API_URL: http://api:3333
    depends_on:
      api:
        condition: service_healthy

  caddy:
    image: caddy:2
    environment: # os domínios vêm do .env.production
      API_DOMAIN: ${API_DOMAIN:-:80}
      APP_DOMAIN: ${APP_DOMAIN:-:81}
      SITE_DOMAIN: ${SITE_DOMAIN:-:82}
      SITE_WWW_DOMAIN: ${SITE_WWW_DOMAIN:-:83}
    ports:
      - "${HTTP_PORT:-80}:80" # "porta do servidor:porta do contêiner"
      - "${HTTPS_PORT:-443}:443"
    volumes:
      - ./Caddyfile:/etc/caddy/Caddyfile:ro # ":ro" = só leitura
      - ${LANDING_DIR:-./landing}:/srv/landing:ro # arquivos da landing
      - caddy_data:/data # certificados (não apagar: evita pedir de novo)
      - caddy_config:/config

volumes: # volumes nomeados: sobrevivem a tudo, menos "down -v"
  pgdata:
  uploads:
  caddy_data:
  caddy_config:
```

(Resumido; o arquivo real tem mais comentários.)

### As imagens: o que os Dockerfiles fazem

**API (`Dockerfile`):**

1. Parte do `node:24-bookworm-slim` e instala `openssl` (Prisma) e `wget`
   (healthcheck).
2. Copia **primeiro** só `package.json`, `package-lock.json` e o `prisma/`, e roda
   `npm ci`. Enquanto as dependências não mudam, essa etapa (lenta) é
   **reaproveitada** do cache: é por isso que a ordem importa.
3. Copia o resto do código, gera o cliente do Prisma e compila (`npm run build`).
4. Roda como o usuário `node`, **não root** (se alguém invadir a API, não tem
   poder de administrador no contêiner).
5. Ao iniciar: `prisma migrate deploy` (aplica migrações pendentes) e depois a API.

**Frontend (`orari-frontend/Dockerfile`), em 3 estágios:**

1. `deps`: instala as dependências.
2. `build`: compila o Next.js. Exige o `API_URL` (o build falha sem ele, de
   propósito: sem ele as fotos não carregam).
3. `run`: copia **só o resultado** (modo "standalone"), sem código-fonte nem
   ferramentas de build. Imagem menor e mais segura. Roda como `node`, com
   healthcheck em `/login`.

Esse padrão (**multi-stage build**) é o recomendado para qualquer projeto: a imagem
final leva só o necessário para rodar.

## Os volumes (os dados)

| Volume                    | O que guarda             | Se apagar                                                 |
| ------------------------- | ------------------------ | --------------------------------------------------------- |
| `orari-prod_pgdata`       | O banco inteiro          | **Perde todos os dados** (só o backup salva)              |
| `orari-prod_uploads`      | Fotos de pessoas e logos | **Perde as fotos** (só o backup salva)                    |
| `orari-prod_caddy_data`   | Certificados HTTPS       | O Caddy pede de novo (há limite semanal no Let's Encrypt) |
| `orari-prod_caddy_config` | Estado interno do Caddy  | Recriado sozinho                                          |

```bash
docker volume ls | grep orari-prod
```

## O atalho `dcp`

Todo comando do Compose de produção precisaria repetir
`docker compose --env-file .env.production -f docker-compose.prod.yml`. O `dcp` é
um script que faz isso por você, de qualquer pasta:

```bash
cat > /usr/local/bin/dcp <<'EOF'
#!/bin/sh
cd "$HOME/orari-backend" && exec docker compose --env-file .env.production -f docker-compose.prod.yml "$@"
EOF
chmod +x /usr/local/bin/dcp
```

O `"$@"` repassa o que você digitou depois: `dcp ps` vira
`docker compose ... ps`. Por ser um arquivo (e não um `alias`), funciona em
qualquer terminal e em scripts.

## Comandos do dia a dia

| O que quero                              | Comando                              |
| ---------------------------------------- | ------------------------------------ |
| Ver o estado dos serviços                | `dcp ps`                             |
| Ver os logs da API (últimas 100 linhas)  | `dcp logs --tail 100 api`            |
| Acompanhar os logs ao vivo (Ctrl+C sai)  | `dcp logs -f api`                    |
| Reiniciar a API (sem reler variáveis)    | `dcp restart api`                    |
| Recriar a API (relê o `.env.production`) | `dcp up -d api`                      |
| Entrar no banco                          | `dcp exec db psql -U orari -d orari` |
| Rodar um comando dentro da API           | `dcp exec api <comando>`             |
| Parar tudo (os dados ficam)              | `dcp down`                           |
| Subir tudo                               | `dcp up -d`                          |
| Uso de disco do Docker                   | `docker system df`                   |
| **NUNCA** (apaga banco e fotos)          | ~~`dcp down -v`~~                    |

**`restart` x `up -d`:** o `restart` só reinicia o processo, com as mesmas
variáveis. Mudou o `.env.production`? Use `dcp up -d <serviço>`, que **recria** o
contêiner lendo o arquivo de novo.

**Estados no `dcp ps`:** `Up (healthy)` = tudo certo; `Up (health: starting)` =
subindo; `Up (unhealthy)` ou `Restarting` = problema, veja os logs.

## Atualizar a aplicação (nova versão)

```bash
orari-backup                              # 1. backup antes (principalmente se há migração)
cd ~/orari-backend && git pull            # 2. código novo da API
cd ~/orari-frontend && git pull           #    e do frontend
COMPOSE_PARALLEL_LIMIT=1 dcp up -d --build   # 3. constrói e troca os contêineres
dcp ps                                    # 4. confere: api e frontend "healthy"
dcp logs --tail 50 api                    # 5. confere a subida e as migrações
```

- **`--build`** reconstrói as imagens com o código novo.
- **`COMPOSE_PARALLEL_LIMIT=1`** constrói uma imagem de cada vez. Em paralelo, os
  dois builds juntos podem estourar a memória do servidor (o build para sem
  mensagem).
- **As migrações** rodam sozinhas quando a API sobe.
- **Quem estava com o site aberto** vê erro na próxima ação até recarregar a
  página (cada versão do Next tem as suas chaves internas).

**Voltar atrás:** `git checkout <commit anterior>` nas pastas e `dcp up -d --build`.
As migrações de banco **não** são desfeitas; por isso o backup antes.

## Problemas comuns

| Sintoma                                | Causa e solução                                                                               |
| -------------------------------------- | --------------------------------------------------------------------------------------------- |
| A API reinicia sem parar               | `dcp logs api`: "Configuração inválida" diz qual variável falta ou está fraca                 |
| O build para sem mensagem              | Falta de memória: use `COMPOSE_PARALLEL_LIMIT=1` (ou crie swap, ver `../deploy.md`)           |
| Mudei o `.env.production` e nada mudou | Usou `restart`; use `dcp up -d <serviço>`                                                     |
| Disco cheio                            | Cache de build: `docker builder prune -a -f` (ver [servidor.md](servidor.md#espaço-em-disco)) |
| Fotos e logos não aparecem             | O frontend foi construído com `API_URL` errada: confira o Compose e reconstrua o frontend     |
| O site abre, mas as telas dão erro     | A API está fora: `dcp ps`, `dcp logs api`                                                     |
| `permission denied` no Docker          | Usuário comum fora do grupo `docker`: `usermod -aG docker <usuário>` e entrar de novo no SSH  |

## Para outros projetos

- **Reaproveite o modelo:** banco + API + frontend + Caddy num Compose, só o Caddy
  com portas públicas, banco em `127.0.0.1`, volumes nomeados para dados,
  `restart: unless-stopped`, healthchecks e `depends_on` com `service_healthy`.
- **Dockerfile:** copie as dependências antes do código (cache), use multi-stage
  quando houver build, rode como usuário não root.
- **Um atalho tipo `dcp`** evita erros de digitação com os arquivos certos.
- **Específico do Orari:** o frontend em outro repositório (`context: ../orari-frontend`)
  e a imagem da API mantendo as dependências de desenvolvimento (Prisma e ts-node
  rodam dentro do contêiner; mais simples, imagem maior).
