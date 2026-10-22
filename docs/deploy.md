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
curl -fsSL https://get.docker.com | sudo sh && sudo docker run --rm hello-world
```

Recursos mínimos: **2 GB de RAM** e 20 GB de disco. Com 1 GB, o build da API pode
ficar sem memória; para um teste, crie uma área de troca (swap):

```bash
sudo fallocate -l 2G /swapfile && sudo chmod 600 /swapfile
sudo mkswap /swapfile && sudo swapon /swapfile
echo '/swapfile none swap sw 0 0' | sudo tee -a /etc/fstab
```

Também confira que as portas **80 e 443** estão liberadas, inclusive em um
eventual firewall do painel do provedor.

## Etapas

### 1. Registrar o domínio

- [x] Registrar `orariapp.com.br` em `registro.br`, com autenticação em duas
      etapas e renovação automática.
- [x] Guardar o e-mail de recuperação em lugar seguro.

### 2. Primeiro acesso e segurança básica do servidor

Do seu computador (o IP vem do provedor):

```bash
ssh root@IP_DO_SERVIDOR
```

Crie um usuário comum com poderes de administrador, em vez de trabalhar como
`root`:

```bash
adduser orari
usermod -aG sudo orari
```

Entre com chave SSH (mais segura que senha). No **seu computador**:

```bash
ssh-keygen -t ed25519          # se você ainda não tem uma chave
ssh-copy-id orari@IP_DO_SERVIDOR
```

**Teste em outra janela** que `ssh orari@IP_DO_SERVIDOR` entra sem pedir a senha.
Só depois disso, no servidor, desligue o login como `root` e por senha, editando
`/etc/ssh/sshd_config`:

```
PermitRootLogin no
PasswordAuthentication no
```

e aplique com `sudo systemctl restart ssh`. Se o servidor não é seu (é de um
amigo), combine com ele antes de mexer em acessos.

Firewall (só SSH, HTTP e HTTPS) e atualizações de segurança automáticas:

```bash
sudo ufw allow OpenSSH
sudo ufw allow 80
sudo ufw allow 443
sudo ufw enable

sudo apt update && sudo apt upgrade -y
sudo apt install -y unattended-upgrades
```

### 3. Instalar o Docker

```bash
curl -fsSL https://get.docker.com | sudo sh
sudo usermod -aG docker orari
```

Saia e entre de novo no SSH. Teste com `docker run --rm hello-world`.

### 4. Levar o código para o servidor

O repositório é privado, então o servidor precisa de permissão de leitura. O
jeito mais simples é uma **deploy key** do GitHub, somente leitura:

1. No servidor: `ssh-keygen -t ed25519 -f ~/.ssh/orari_deploy -N ""`.
2. Copie o conteúdo de `~/.ssh/orari_deploy.pub`.
3. No GitHub: repositório → Settings → Deploy keys → Add deploy key, **sem**
   marcar escrita.
4. Clone com essa chave:

```bash
GIT_SSH_COMMAND="ssh -i ~/.ssh/orari_deploy" \
  git clone git@github.com:renatoclx/orari-backend.git
cd orari-backend
git config core.sshCommand "ssh -i ~/.ssh/orari_deploy"   # para os próximos git pull
```

Nunca coloque senhas ou tokens pessoais do GitHub no servidor.

### 5. Preencher as variáveis de ambiente

Copie o modelo e edite (o arquivo `.env.production` **nunca vai para o Git**; o
`.gitignore` já o protege):

```bash
cp .env.production.example .env.production
chmod 600 .env.production
nano .env.production
```

O que preencher:

| Variável            | Valor                                                                                                  |
| ------------------- | ------------------------------------------------------------------------------------------------------ |
| `API_DOMAIN`        | `api.orariapp.com.br` (ou `:80`, para o primeiro teste por IP; ver abaixo)                             |
| `POSTGRES_PASSWORD` | `openssl rand -hex 24` (só letras e números). **Repita a mesma senha na `DATABASE_URL`**               |
| `DATABASE_URL`      | `postgresql://orari:SENHA@db:5432/orari?schema=public` (o host é `db`, o nome do contêiner)            |
| `JWT_SECRET`        | `node -e "console.log(require('crypto').randomBytes(48).toString('hex'))"` (ou `openssl rand -hex 48`) |
| `CORS_ORIGIN`       | o endereço do frontend, quando existir (ex.: `https://app.orariapp.com.br`)                            |
| `TRUST_PROXY`       | `1` (o Caddy é o único proxy à frente da API)                                                          |

O restante já vem com valores seguros. Se algo estiver fraco ou faltando, a API
se recusa a subir e o log diz o quê (ver `docs/auth.md`, seção "Configuração de
produção").

**Primeiro teste, antes de o domínio funcionar:** deixe `API_DOMAIN=:80`. O Caddy
passa a servir só HTTP, e você testa por `http://IP_DO_SERVIDOR/`. É só para
conferir que sobe: **sem HTTPS, senhas e tokens trafegam sem criptografia**, então
não deixe usuários reais entrarem assim. Com o domínio apontado (etapa 7), troque
para `api.orariapp.com.br`.

### 6. Subir a aplicação

Para não repetir as opções, crie um atalho (vale para a sessão; ponha no
`~/.bashrc` para guardar):

```bash
alias dcp='docker compose --env-file .env.production -f docker-compose.prod.yml'
```

Antes da primeira subida, **acrescente ao `.env.production` as variáveis do
primeiro administrador** (linhas `SEED_*` do modelo, descomentadas; o CNPJ precisa
ser válido e a senha forte). Depois:

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

### 8. Conferir

- [ ] `https://api.orariapp.com.br/` responde "Hello World!".
- [ ] O login do administrador funciona (`POST /auth/login`).
- [ ] `https://api.orariapp.com.br/docs` responde **404** (Swagger desligado).
- [ ] O navegador mostra o cadeado (HTTPS válido).
- [ ] O banco **não** aceita conexão de fora: de outro computador,
      `nc -zv IP_DO_SERVIDOR 5432` deve falhar.
- [ ] Depois de `dcp down && dcp up -d`, o login e as fotos continuam lá.

### 9. Backup do banco

Não confie só em snapshots do provedor. Faça um backup do banco todo dia e guarde
uma cópia **fora do servidor**. Comando (testado):

```bash
mkdir -p ~/backups
dcp exec -T db pg_dump -U orari orari | gzip > ~/backups/orari-$(date +%F).sql.gz
```

Agende todo dia às 3h com `crontab -e` (ajuste o caminho do projeto) e mantenha
os últimos 14:

```
0 3 * * * cd ~/orari-backend && docker compose --env-file .env.production -f docker-compose.prod.yml exec -T db pg_dump -U orari orari | gzip > ~/backups/orari-$(date +\%F).sql.gz && find ~/backups -name 'orari-*.sql.gz' -mtime +14 -delete
```

Copie as cópias para fora do servidor (por exemplo, `scp` para o seu computador ou
um armazenamento em nuvem). Um backup só dentro da máquina que quebrou não serve.

**Teste a restauração** pelo menos uma vez, num banco à parte (testado):

```bash
dcp exec -T db psql -U orari -d postgres -c 'CREATE DATABASE orari_restauracao;'
gunzip -c ~/backups/orari-AAAA-MM-DD.sql.gz | \
  dcp exec -T db psql -U orari -d orari_restauracao -q -v ON_ERROR_STOP=1
dcp exec -T db psql -U orari -d orari_restauracao -tAc 'select count(*) from users'
dcp exec -T db psql -U orari -d postgres -c 'DROP DATABASE orari_restauracao;'
```

As **fotos e logos** não estão nesse backup: ficam no volume `uploads`. Para o
piloto, o risco é pequeno; antes de abrir ao público, o ideal é armazenamento em
nuvem (ver `docs/technical-debt.md`, "Fotos em pasta local e com acesso público").

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
