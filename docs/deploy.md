# Roteiro de deploy

Passo a passo, o mais simples possível, para colocar a API do Orari no ar em um
servidor Linux (VPS) com Docker. Os arquivos de produção do repositório
(`Dockerfile`, `docker-compose.prod.yml`, `Caddyfile` e `.env.production.example`)
foram **testados de ponta a ponta** em um ambiente limpo: subida, migrações,
seed, login, HTTPS/headers, persistência de dados e fotos depois de reiniciar, e
backup com restauração.

**Decisões já tomadas**

- Domínio: `orariapp.com.br` (Registro.br).
- Endereços: `api.orariapp.com.br` para a API e `app.orariapp.com.br` para o
  frontend, quando existir.
- Primeiro servidor: um VPS emprestado, para o **piloto fechado** (poucos
  usuários). O produto final deve ir para um servidor **na sua conta** (ver
  [Piloto x produção](#piloto-x-produção)).

## Como as peças se encaixam

```
navegador → api.orariapp.com.br → [Caddy: HTTPS] → [API] → [PostgreSQL]
                                                      └→ [pasta de fotos]
```

Tudo roda no mesmo servidor, em contêineres (Docker Compose):

| Contêiner | Função                                                               |
| --------- | -------------------------------------------------------------------- |
| `caddy`   | Recebe o tráfego de fora e cuida do certificado HTTPS sozinho        |
| `api`     | A API do Orari. Roda as migrações do banco toda vez que sobe         |
| `db`      | PostgreSQL. **Sem porta aberta** para a internet: só a API o alcança |

Os dados ficam em volumes do Docker (`pgdata` para o banco, `uploads` para fotos e
logos), que sobrevivem a reinícios e a novas versões da aplicação.

## Escolha do servidor

O banco é PostgreSQL, então serve um **VPS** (servidor só seu, com acesso `root`
ou `sudo`). Hospedagem compartilhada de sites **não serve**: a Hostinger, por
exemplo, informa que não oferece PostgreSQL nos planos Web e Cloud.

Antes de usar um servidor, confira (entre por SSH e rode):

```bash
cat /etc/os-release | head -2     # ideal: Ubuntu 22.04 ou 24.04
free -h && df -h /                # memória e disco
nproc                             # processadores
docker --version                  # se já existir, NÃO rode o script de instalação (etapa 3)
```

Recursos mínimos, **livres** na hora do deploy: **2 GB de RAM** e **10 GB de
disco**. O espaço pesa mais do que parece: a imagem da API tem cerca de 1,5 GB, o
PostgreSQL 0,4 GB, e o cache do build passa de 2 GB a cada versão nova (limpe com
`docker builder prune -f` em um servidor só seu). Com 1 GB de RAM, o build da API
pode ficar sem memória; para um teste, crie uma área de troca (swap):

```bash
sudo fallocate -l 2G /swapfile && sudo chmod 600 /swapfile
sudo mkswap /swapfile && sudo swapon /swapfile
echo '/swapfile none swap sw 0 0' | sudo tee -a /etc/fstab
```

Também confira que as portas **80 e 443** estão liberadas, inclusive em um
eventual firewall do painel do provedor.

**Prefira um servidor só para o Orari.** Em um servidor compartilhado com outras
aplicações, o Orari disputa memória, disco e portas (80/443) com elas, e um
problema de um lado derruba o outro.

## Etapas

> **Sobre o `sudo`:** os comandos usam `sudo` onde um usuário comum precisaria. Se
> você entra como `root` (o caso atual deste projeto), **omita o `sudo`**: o
> `root` já tem todas as permissões.

### 1. Registrar o domínio

- [x] Registrar `orariapp.com.br` em `registro.br`, com autenticação em duas
      etapas e renovação automática.
- [x] Guardar o e-mail de recuperação em lugar seguro.

### 2. Primeiro acesso e segurança básica do servidor

Por ora, o acesso é como `root` com **senha**: é o mais simples para quem está
começando, e é aceitável para um piloto **se** você seguir os cuidados abaixo. O
caminho recomendado para depois (chave SSH, sem senha) está em
[2b](#2b-endurecer-o-acesso-depois).

#### 2a. Agora: root com senha

Do seu computador (o IP vem do provedor):

```bash
ssh root@IP_DO_SERVIDOR
```

**1. Senha forte.** Use 16 ou mais caracteres, gerada por um gerenciador de senhas.
Se a atual é curta ou previsível, troque com `passwd`. Um servidor novo na
internet recebe tentativas de invasão em minutos; a senha é a única barreira.

**2. Firewall com limite de tentativas.** Só SSH, HTTP e HTTPS, e `limit` no SSH,
que bloqueia quem tenta conectar demais:

```bash
ufw limit OpenSSH
ufw allow 80
ufw allow 443
ufw enable
```

**3. `fail2ban`.** Bane por um tempo o IP que erra a senha várias vezes:

```bash
apt update && apt upgrade -y
apt install -y fail2ban unattended-upgrades
systemctl enable --now fail2ban
```

Para conferir: `fail2ban-client status sshd` mostra os IPs já bloqueados, e
`grep -c "Failed password" /var/log/auth.log` mostra quantas tentativas já houve.

> Não envie a senha do servidor a ninguém, nem a mim. Se precisar de ajuda, mostre
> só o que o servidor responde, nunca as credenciais.

#### 2b. Endurecer o acesso (depois)

Quando estiver confortável, troque a senha por **chave SSH**. No **seu
computador**, não no servidor:

```bash
ssh-keygen -t ed25519            # Enter nas perguntas; defina uma frase-senha
ssh-copy-id root@IP_DO_SERVIDOR  # pede a senha uma última vez e instala a chave
```

**Teste em outra janela** que `ssh root@IP_DO_SERVIDOR` entra **sem pedir a senha
do servidor**. Só então, na primeira janela, edite `/etc/ssh/sshd_config`:

```
PasswordAuthentication no
PermitRootLogin prohibit-password
```

e aplique com `systemctl restart ssh`. Mantenha a primeira janela aberta até
confirmar que a segunda ainda entra; se algo der errado, o painel do provedor tem
um terminal de emergência.

Mais seguro ainda é deixar de usar o `root`: crie um usuário comum e use `sudo`.

```bash
adduser orari
usermod -aG sudo orari
ssh-copy-id orari@IP_DO_SERVIDOR   # no seu computador
```

Teste o login do novo usuário e então ponha `PermitRootLogin no`. Com um usuário
comum, mantenha o `sudo` nos comandos deste roteiro e use o `usermod -aG docker`
da etapa 3. Se o servidor não é seu, combine com o dono antes de mexer em acessos.

### 3. Instalar o Docker

**Só se ainda não estiver instalado** (`docker --version`). Em um servidor que já
roda Docker, o script abaixo reconfigura os repositórios e pode atualizar o motor,
afetando o que já estiver rodando nele; nesse caso, pule esta etapa e use o Docker
existente.

Como `root`:

```bash
curl -fsSL https://get.docker.com | sh
docker run --rm hello-world
```

Com um usuário comum (por exemplo, `orari`), use `sudo` e dê a ele acesso ao
Docker; depois saia e entre de novo no SSH:

```bash
curl -fsSL https://get.docker.com | sudo sh
sudo usermod -aG docker orari
```

### 4. Levar o código para o servidor

O repositório é privado, então o servidor precisa de permissão para **ler** o
código. O jeito mais simples é uma **deploy key** do GitHub: uma chave que vive só
no servidor e só pode ler este repositório.

**1. No servidor**, gere a chave:

```bash
ssh-keygen -t ed25519 -f ~/.ssh/orari_deploy -N ""
```

O comando mostra uma "impressão digital" (`SHA256:...`) e um desenho. **Ignore
isso**: não é o que o GitHub pede.

**2. Mostre a chave pública** (é o arquivo que termina em `.pub`):

```bash
cat ~/.ssh/orari_deploy.pub
```

Sai **uma linha só**, assim:

```
ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAI... root@nome-do-servidor
```

Copie a linha **inteira**, do `ssh-ed25519` até o fim. Essa é pública: pode ser
colada no GitHub sem risco. Já o arquivo **sem** `.pub` (`orari_deploy`) é a
chave privada e **nunca sai do servidor**.

**3. No GitHub**, abra o repositório → **Settings** → **Deploy keys** → **Add
deploy key**:

- **Title:** `servidor-orari` (qualquer nome);
- **Key:** cole a linha inteira do passo 2;
- **Allow write access:** deixe **desmarcado** (o servidor só precisa ler).

**4. No servidor**, baixe o código:

```bash
GIT_SSH_COMMAND="ssh -i ~/.ssh/orari_deploy" \
  git clone git@github.com:renatoclx/orari-backend.git
```

Na primeira vez ele pergunta `Are you sure you want to continue connecting
(yes/no)?`: responda `yes`. Depois, entre na pasta e guarde a chave para os
próximos `git pull`:

```bash
cd orari-backend
git config core.sshCommand "ssh -i ~/.ssh/orari_deploy"
```

Se aparecer `Permission denied (publickey)`, a chave não foi cadastrada direito
no GitHub: confira se colou a linha inteira do `.pub` (e não o `SHA256:`) e se
a chave foi adicionada **ao repositório certo**.

**Alternativa sem GitHub (só para começar):** enviar os arquivos direto do seu
computador, sem chave nenhuma. Na pasta do projeto, no **seu computador**:

```bash
rsync -av --exclude node_modules --exclude .git --exclude dist \
  --exclude generated --exclude uploads --exclude coverage --exclude '.env*' \
  ./ root@IP_DO_SERVIDOR:/root/orari-backend/
```

É rápido para a primeira vez, mas a cada atualização você precisa rodar de novo;
com o GitHub, basta um `git pull`.

Nunca coloque senhas ou tokens pessoais do GitHub no servidor.

### 5. Criar o arquivo de variáveis (`.env.production`)

Este arquivo guarda as configurações e os segredos da produção. Ele **nunca vai
para o Git** (o `.gitignore` já o protege) e existe só no servidor.

Em vez de preencher à mão (e correr o risco de errar a senha do banco, que
aparece em dois lugares), **gere o arquivo com este bloco**. Copie tudo e cole no
servidor:

```bash
cd ~/orari-backend

PG=$(openssl rand -hex 24)      # senha do banco
JWT=$(openssl rand -hex 48)     # segredo dos tokens

cat > .env.production <<EOF
NODE_ENV=production

# ":80" = só HTTP, para testar por IP. Com o domínio funcionando, troque por api.orariapp.com.br
API_DOMAIN=:80

POSTGRES_USER=orari
POSTGRES_PASSWORD=$PG
POSTGRES_DB=orari
DATABASE_URL=postgresql://orari:$PG@db:5432/orari?schema=public

JWT_SECRET=$JWT
JWT_EXPIRES_IN=15m
JWT_REFRESH_EXPIRES_IN=7d

CORS_ORIGIN=https://app.orariapp.com.br
TRUST_PROXY=1
EOF

chmod 600 .env.production
```

As duas senhas já saem corretas e iguais nos lugares certos, e ninguém precisa
digitar segredo. Para conferir **sem mostrar os segredos**:

```bash
sed -E 's/(PASSWORD|SECRET)=.*/\1=(oculto)/; s#(//orari:)[^@]*#\1(oculto)#' .env.production
```

**O que cada linha significa**

| Linha                                       | Para que serve                                                                                 |
| ------------------------------------------- | ---------------------------------------------------------------------------------------------- |
| `NODE_ENV=production`                       | Liga as regras rígidas de segurança (a API se recusa a subir com configuração fraca)           |
| `API_DOMAIN`                                | Endereço da API. `:80` serve só HTTP (teste por IP); depois vira `api.orariapp.com.br`         |
| `POSTGRES_USER` / `_PASSWORD` / `_DB`       | Usuário, senha e nome do banco que o contêiner do PostgreSQL cria                              |
| `DATABASE_URL`                              | Endereço do banco que a API usa. O `db` é o nome do contêiner; a senha é a mesma de cima       |
| `JWT_SECRET`                                | Segredo que assina os logins. Precisa ser longo e aleatório                                    |
| `JWT_EXPIRES_IN` / `JWT_REFRESH_EXPIRES_IN` | Duração do login (15 minutos, renovável por 7 dias)                                            |
| `CORS_ORIGIN`                               | Endereço do frontend autorizado a falar com a API. Ainda não existe, mas o valor já fica certo |
| `TRUST_PROXY=1`                             | Há um proxy (o Caddy) na frente da API, para o limite de tentativas ver o IP do cliente        |

Se algo estiver fraco ou faltando, a API se recusa a subir e o log diz o quê (ver
`docs/auth.md`, seção "Configuração de produção").

**Primeiro teste, antes de o domínio funcionar:** deixe `API_DOMAIN=:80`. O Caddy
serve só HTTP, e você testa por `http://IP_DO_SERVIDOR/`. É só para conferir que
sobe: **sem HTTPS, senhas e tokens trafegam sem criptografia**, então não deixe
usuários reais entrarem assim. Com o domínio apontado (etapa 7), troque para
`api.orariapp.com.br`.

**O primeiro administrador.** O seed precisa de mais algumas linhas, que você
coloca **só para criar o administrador e depois apaga**. Edite com
`nano .env.production` (assim a senha não fica no histórico do terminal) e
acrescente no fim:

```
SEED_COMPANY_CORPORATE_REASON=Orari Plataforma LTDA
SEED_COMPANY_DOCUMENT=
SEED_COMPANY_SUBDOMAIN=orari
SEED_SUPER_ADMIN_NAME=Administrador
SEED_SUPER_ADMIN_EMAIL=seu-email@exemplo.com
SEED_SUPER_ADMIN_PASSWORD=
```

- `SEED_COMPANY_DOCUMENT`: o **CPF ou CNPJ** válido, só números (11 ou 14
  caracteres). Use o seu ou o da sua empresa. (A data de fundação é opcional e
  fica de fora.)
- `SEED_SUPER_ADMIN_PASSWORD`: senha forte, de 8 a 72 caracteres, de um
  gerenciador de senhas.

Na etapa 6 você roda o seed e **apaga essas 6 linhas**.

### 6. Subir a aplicação

Para não repetir as opções, crie o comando `dcp`, que roda o Docker Compose com
os arquivos certos. Ele é um arquivo em `/usr/local/bin`, então funciona em
qualquer terminal e de qualquer pasta, e continua existindo quando você sai e
entra de novo (um `alias` não faria isso):

```bash
cat > /usr/local/bin/dcp <<'EOF'
#!/bin/sh
cd "$HOME/orari-backend" && exec docker compose --env-file .env.production -f docker-compose.prod.yml "$@"
EOF
chmod +x /usr/local/bin/dcp
```

Ele assume que o projeto está em `~/orari-backend`. Teste com `dcp ps`.

Antes da primeira subida, confirme que o `.env.production` já tem as linhas
`SEED_*` do primeiro administrador (fim da etapa 5). Depois:

```bash
dcp up -d --build        # constrói e sobe (leva alguns minutos na primeira vez)
dcp ps                   # os três serviços devem aparecer; a API como "healthy"
dcp logs -f api          # acompanha a subida; Ctrl+C para sair
```

As tabelas do banco são criadas na própria subida. Em seguida, crie a empresa da
plataforma e o administrador, **uma única vez**:

```bash
dcp exec api npx prisma db seed
```

Agora **apague as linhas `SEED_*`** do `.env.production` e aplique com
`dcp up -d --force-recreate api` (isso recria a API sem elas).

### 7. Apontar o domínio para o servidor

No painel de DNS do Registro.br (`orariapp.com.br` → editar zona), crie:

| Tipo | Nome  | Valor              |
| ---- | ----- | ------------------ |
| A    | `api` | IP do seu servidor |

A mudança leva de minutos a poucas horas. Confira com
`dig +short api.orariapp.com.br` (deve mostrar o IP). Depois, ponha
`API_DOMAIN=api.orariapp.com.br` no `.env.production` e rode `dcp up -d`: o Caddy
obtém o certificado HTTPS sozinho em alguns segundos.

**Se o DNS do domínio estiver na Cloudflare** (muito comum), crie o registro `A` de
`api` lá e deixe a nuvem **cinza ("DNS only")**, não laranja. Com a nuvem laranja
(proxy), a conexão chega ao servidor vinda da Cloudflare e a API passa a ver o IP
dela, e não o do usuário: o limite de tentativas de login contaria todos os
usuários juntos. Com "DNS only", o tráfego vai direto ao servidor e o Caddy cuida
do HTTPS. Para conferir: `dig +short api.orariapp.com.br` deve devolver o IP do
seu servidor, e não endereços da Cloudflare (`104.21…`, `172.67…`).

### 8. Conferir

- [ ] `https://api.orariapp.com.br/` responde "Hello World!".
- [ ] O login do administrador funciona (`POST /auth/login`).
- [ ] `https://api.orariapp.com.br/docs` responde **404** (Swagger desligado).
- [ ] O navegador mostra o cadeado (HTTPS válido).
- [ ] O banco **não** aceita conexão de fora: de outro computador,
      `nc -zv IP_DO_SERVIDOR 5432` deve falhar.
- [ ] Depois de `dcp down && dcp up -d`, o login e as fotos continuam lá.

### 9. Backup do banco e das fotos

Não confie só em snapshots do provedor. O backup deve ser **diário** e ter uma
cópia **fora do servidor**: um backup só dentro da máquina que quebrou não serve.
Ele guarda dois arquivos: o **banco** (`orari-AAAA-MM-DD-HHMM.sql.gz`) e as **fotos
e logos** (`uploads-AAAA-MM-DD-HHMM.tgz`). As fotos ficam num volume à parte, e sem
o segundo arquivo elas se perderiam se o disco falhasse.

A pasta dos backups é `~/backups`. Como você entra como `root`, o `~` é `/root`, e
o caminho real é `/root/backups` (no home do usuário, não na raiz `/` do sistema,
e fora da pasta do projeto).

**1. Crie (ou atualize) o script de backup.** Ele recusa um banco vazio ou
suspeito, confere que o arquivo das fotos está íntegro, grava o banco antes das
fotos (se as fotos falharem, o dump já está salvo), não deixa arquivos temporários
para trás, guarda só os últimos 14 dias e protege os arquivos (`chmod 600`). Se você
já criou uma versão anterior (só do banco), rode o bloco de novo: ele a substitui.

```bash
cat > /usr/local/bin/orari-backup <<'EOF'
#!/bin/bash
# Backup diário do Orari: banco (dump) e fotos/logos (pasta de uploads).
# Recusa banco vazio ou suspeito e confere a integridade do arquivo das fotos.
set -euo pipefail

DIR="$HOME/backups"
mkdir -p "$DIR"
STAMP="$(date +%F-%H%M)"
DB_FILE="$DIR/orari-$STAMP.sql.gz"
UPLOADS_FILE="$DIR/uploads-$STAMP.tgz"
# Qualquer saída (inclusive por erro) apaga os arquivos temporários.
trap 'rm -f "$DB_FILE.tmp" "$UPLOADS_FILE.tmp"' EXIT

cd "$HOME/orari-backend"
COMPOSE="docker compose --env-file .env.production -f docker-compose.prod.yml"

# 1) Banco. pipefail: se o pg_dump falhar, o script para (mesmo com o gzip funcionando).
$COMPOSE exec -T db pg_dump -U orari orari | gzip > "$DB_FILE.tmp"

# Um dump de verdade tem centenas de KB; menos que isso indica falha.
if [ "$(stat -c %s "$DB_FILE.tmp")" -lt 1000 ]; then
  echo "backup do banco suspeito (muito pequeno), descartado" >&2
  exit 1
fi
# O banco é guardado antes das fotos: se as fotos falharem, o dump já está salvo.
mv "$DB_FILE.tmp" "$DB_FILE"
chmod 600 "$DB_FILE"

# 2) Fotos e logos. Um arquivo pequeno é normal (pode não haver fotos ainda):
# aqui só se confere que o arquivo compactado está íntegro.
$COMPOSE exec -T api tar czf - -C /data/uploads . > "$UPLOADS_FILE.tmp"
gzip -t "$UPLOADS_FILE.tmp"
mv "$UPLOADS_FILE.tmp" "$UPLOADS_FILE"
chmod 600 "$UPLOADS_FILE"

# Guarda os últimos 14 dias.
find "$DIR" \( -name 'orari-*.sql.gz' -o -name 'uploads-*.tgz' \) -mtime +14 -delete
echo "backup ok: $DB_FILE e $UPLOADS_FILE"
EOF
chmod +x /usr/local/bin/orari-backup
```

**2. Rode uma vez à mão e confira:**

```bash
orari-backup
ls -lh ~/backups
```

Deve aparecer `backup ok: ...` e dois arquivos: o `orari-AAAA-MM-DD-HHMM.sql.gz`
(o banco, de algumas centenas de KB, que cresce com os dados) e o
`uploads-AAAA-MM-DD-HHMM.tgz` (as fotos). Se ainda não houver nenhuma foto, o
segundo fica minúsculo (uns 100 bytes): é normal.

**3. Agende todo dia às 3h** (hora do servidor) com `crontab -e`, acrescentando a
linha abaixo no fim do arquivo:

```
0 3 * * * /usr/local/bin/orari-backup >> /var/log/orari-backup.log 2>&1
```

No dia seguinte, confira que rodou: `tail /var/log/orari-backup.log` e
`ls -lh ~/backups`.

**4. Copie para fora do servidor.** A partir do **seu computador** (não do
servidor), traga os arquivos novos:

```bash
rsync -av root@IP_DO_SERVIDOR:backups/ ~/orari-backups/
```

Faça isso pelo menos uma vez por semana no piloto (ou agende no seu computador).
O ideal depois é enviar automaticamente para um armazenamento em nuvem.

**5. Teste a restauração do banco** pelo menos uma vez, num banco à parte, para
ter certeza de que o backup serve (testado):

```bash
dcp exec -T db psql -U orari -d postgres -c 'CREATE DATABASE orari_restauracao;'
gunzip -c ~/backups/orari-AAAA-MM-DD-HHMM.sql.gz | \
  dcp exec -T db psql -U orari -d orari_restauracao -q -v ON_ERROR_STOP=1
dcp exec -T db psql -U orari -d orari_restauracao -tAc 'select count(*) from users'
dcp exec -T db psql -U orari -d postgres -c 'DROP DATABASE orari_restauracao;'
```

A contagem de usuários deve bater com a do banco real. O `DROP DATABASE` apaga só
a **cópia de teste**, nunca o banco `orari`.

**Restaurar sobre o banco de verdade** (depois de um desastre) apaga o banco atual
e exige cuidado: pare a API antes (`dcp stop api`), não improvise e peça ajuda
antes de apagar qualquer coisa. O teste acima, em um banco à parte, é o ensaio
seguro e mostra que o arquivo serve.

**6. Teste a restauração das fotos.** Para ver o conteúdo do arquivo sem mexer em
nada:

```bash
tar tzf ~/backups/uploads-AAAA-MM-DD-HHMM.tgz
```

Para recolocar as fotos no volume (testado: os arquivos voltam idênticos e com o
dono certo). Isso **só acrescenta ou sobrescreve** arquivos de mesmo nome, não
apaga os que já existem:

```bash
dcp exec -T api tar xzf - -C /data/uploads < ~/backups/uploads-AAAA-MM-DD-HHMM.tgz
```

As fotos continuam numa pasta do servidor e acessíveis por link a quem o tiver.
Para o piloto, o risco é pequeno; antes de abrir a clientes reais, o ideal é
armazenamento privado em nuvem (ver `docs/technical-debt.md`, "Fotos em pasta
local e com acesso público").

### 10. Aviso de queda

Crie uma conta gratuita num serviço de monitoramento (como o UptimeRobot)
apontando para `https://api.orariapp.com.br/`, com aviso por e-mail.

### 11. Atualizar a aplicação depois

```bash
cd ~/orari-backend
git pull
# faça um backup (etapa 9) antes, principalmente se a versão tiver migrações
dcp up -d --build
dcp logs -f api
```

As migrações novas são aplicadas sozinhas na subida.

**Voltar atrás:** `git checkout <commit anterior>` e `dcp up -d --build`. Atenção:
as migrações **não** são desfeitas; por isso o backup antes de atualizar.

## Dia a dia

| O que quero                 | Comando                                               |
| --------------------------- | ----------------------------------------------------- |
| Ver se está tudo no ar      | `dcp ps`                                              |
| Ver os logs da API          | `dcp logs --tail 100 api`                             |
| Reiniciar a API             | `dcp restart api`                                     |
| Parar tudo (os dados ficam) | `dcp down`                                            |
| Apagar também os dados      | `dcp down -v` — **cuidado: apaga o banco e as fotos** |

## Ver o banco no DBeaver (túnel SSH)

O banco **não** fica aberto para a internet: a porta dele é publicada só dentro do
próprio servidor (`127.0.0.1`). Para olhá-lo pelo DBeaver, use um **túnel SSH**: o
DBeaver entra no servidor pelo SSH (que você já usa) e, de lá, fala com o banco.

**Credenciais.** Estão só no servidor, em `.env.production`:

| Dado    | Valor                                                     |
| ------- | --------------------------------------------------------- |
| Usuário | `orari`                                                   |
| Banco   | `orari`                                                   |
| Senha   | linha `POSTGRES_PASSWORD` do `.env.production`            |
| Porta   | `5432` (ou o valor de `DB_LOCAL_PORT`, se você o definiu) |

Para ver a senha no servidor (guarde-a no gerenciador de senhas; não a cole em
conversas): `grep POSTGRES_PASSWORD ~/orari-backend/.env.production`.

**No DBeaver:** Nova conexão → PostgreSQL.

1. Aba **Principal**: Host `localhost`, Porta `5432`, Banco `orari`, Usuário
   `orari` e a senha acima.
2. Aba **SSH**: marque **Usar SSH Tunnel**, Host/IP = o IP do servidor, Porta
   `22`, Usuário `root` e autenticação por Senha (ou chave, se já usa).
3. **Testar conexão** e salvar.

O `localhost` do passo 1 é o do **servidor**, não o do seu computador: é o túnel
que leva até lá.

**Cuidados**

- Em produção, **use o DBeaver para consultar, não para editar**. A API mantém
  regras (valores calculados, `updatedAt`, vínculos) que uma edição manual pode
  quebrar.
- Nunca abra a porta 5432 no firewall (`ufw`) nem no painel do provedor.
- Esta publicação só existe a partir da versão do `docker-compose.prod.yml` que a
  inclui. Num servidor já em funcionamento: `git pull` e `dcp up -d` (recria só o
  contêiner do banco, com uma breve pausa; os dados ficam).
- Se a porta 5432 já estiver em uso no servidor, defina `DB_LOCAL_PORT` (por
  exemplo `15432`) no `.env.production` e use esse número no DBeaver.

**Esqueci o e-mail do administrador:** consulte direto, sem DBeaver:

```bash
docker exec -it orari-prod-db-1 psql -U orari -d orari -c "select email, type from users;"
```

## Piloto x produção

O piloto com poucas pessoas num servidor emprestado é uma boa forma de testar,
desde que fique claro o que é e o que não é:

- **Avise os testadores** de que é um ambiente de testes: os dados podem ser
  apagados e pode haver instabilidade.
- **Não use dados pessoais reais sem necessidade.** Prefira dados fictícios ou
  peça a concordância dos envolvidos. O sistema guarda dados pessoais e, conforme
  o negócio, de saúde (LGPD).
- **Quem controla o servidor tem acesso aos dados.** Combine isso com o dono por
  escrito, inclusive o que acontece se ele cancelar ou esquecer de renovar.
- **Use HTTPS** (etapa 7) assim que os testadores forem entrar com senha.
- **Faça backup desde o primeiro dia** e treine a restauração.

Antes de abrir a clientes reais:

- [ ] Servidor e domínio **na sua conta**, não de terceiros.
- [ ] Acesso por **chave SSH**, sem senha (etapa 2b), e, de preferência, sem usar o
      `root` no dia a dia.
- [ ] Backup diário com cópia externa e restauração testada.
- [ ] Fotos e logos em armazenamento persistente em nuvem.
- [ ] Política de privacidade e fluxo de exclusão de dados a pedido (LGPD).
- [ ] Regras pendentes decididas (`docs/technical-debt.md`, "Regras pendentes de
      decisão").
- [ ] Monitoramento de queda ativo.

## Segredos: o que nunca vai para o repositório nem para o chat

`JWT_SECRET`, senha do banco, `DATABASE_URL`, senha do administrador, chaves SSH e
tokens do GitHub. Eles ficam só no servidor (`.env.production`, com `chmod 600`) e
em um gerenciador de senhas seu.

## Problemas comuns

| Sintoma                       | Causa provável                                                                    |
| ----------------------------- | --------------------------------------------------------------------------------- |
| A API reinicia sem parar      | Veja `dcp logs api`. Uma "Configuração inválida" lista a variável errada ou fraca |
| `HTTPS` não aparece           | O DNS ainda não aponta para o servidor, ou as portas 80/443 estão fechadas        |
| O build para sem mensagem     | Pouca memória: crie o swap (seção "Escolha do servidor")                          |
| `permission denied` no Docker | Faltou sair e entrar de novo no SSH depois de `usermod -aG docker`                |
| Login retorna 429             | Mais de 5 tentativas por minuto do mesmo IP; aguarde um minuto                    |
