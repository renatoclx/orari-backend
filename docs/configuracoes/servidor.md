# Servidor (VPS)

## O que é e por que uma VPS

O Orari precisa de PostgreSQL, Node.js e de rodar tarefas agendadas (backup). Isso
exige um servidor **com acesso de administrador** (`root`): uma VPS. Hospedagens
compartilhadas não permitem (ver [conceitos.md](conceitos.md#servidor-vps-e-hospedagem)).

**Situação atual:** VPS **emprestada** para o piloto, com o aaPanel instalado pelo
dono. Antes de crescer, o ideal é um servidor **na sua conta** (ver
[Mudar de servidor](#mudar-de-servidor)).

## Requisitos mínimos

| Recurso | Mínimo livre | Por quê                                                               |
| ------- | ------------ | --------------------------------------------------------------------- |
| RAM     | 2 GB         | O build do frontend usa até ~1,5 GB; o da API também é pesado         |
| Disco   | 10 GB        | Imagens (~2,5 GB) + cache de build (cresce a cada deploy, ver abaixo) |
| Portas  | 22, 80, 443  | SSH, HTTP e HTTPS                                                     |

O servidor atual tem ~3,8 GB de RAM. Por isso os builds são feitos **um de cada
vez** (`COMPOSE_PARALLEL_LIMIT=1`, ver [docker.md](docker.md)).

Para conferir um servidor:

```bash
cat /etc/os-release | head -2   # sistema
free -h                         # memória
df -h /                         # disco
nproc                           # processadores
docker --version                # Docker instalado?
```

## Acesso (SSH)

Do seu computador:

```bash
ssh root@IP_DO_SERVIDOR
```

O IP está no painel do provedor e no registro A do Cloudflare.

### Segurança básica (confira com os comandos abaixo se está toda aplicada)

| Medida                | O que faz                                                          | Comando                                                      |
| --------------------- | ------------------------------------------------------------------ | ------------------------------------------------------------ |
| Senha forte (16+)     | A única barreira contra robôs que tentam senhas o dia todo         | `passwd`                                                     |
| Firewall `ufw`        | Só deixa entrar SSH, HTTP e HTTPS; `limit` freia tentativas no SSH | `ufw limit OpenSSH; ufw allow 80; ufw allow 443; ufw enable` |
| `fail2ban`            | Bane por um tempo o IP que erra a senha várias vezes               | `apt install -y fail2ban`                                    |
| `unattended-upgrades` | Instala sozinho as correções de segurança do sistema               | `apt install -y unattended-upgrades`                         |

Conferir:

```bash
ufw status                       # regras do firewall
fail2ban-client status sshd      # IPs banidos
grep -c "Failed password" /var/log/auth.log   # tentativas de invasão já barradas
```

### Próximo nível (recomendado antes de clientes reais)

1. **Chave SSH em vez de senha** (`ssh-keygen -t ed25519` no seu computador,
   `ssh-copy-id root@IP`), e depois `PasswordAuthentication no` no
   `/etc/ssh/sshd_config`.
2. **Usuário comum com `sudo`** em vez de `root` no dia a dia.

O passo a passo está em [`../deploy.md`](../deploy.md), etapa 2b. **Sempre teste
o novo acesso numa segunda janela antes de fechar a primeira.**

## Pastas importantes

| Pasta / arquivo                     | O que tem                                                                 |
| ----------------------------------- | ------------------------------------------------------------------------- |
| `/root/orari-backend`               | Código da API + `docker-compose.prod.yml`, `Caddyfile`, `.env.production` |
| `/root/orari-frontend`              | Código do frontend (o Compose constrói a partir daqui)                    |
| `/www/wwwroot/orariapp.com.br`      | Arquivos da landing (criada pelo aaPanel; o Caddy serve)                  |
| `/root/backups`                     | Backup mais recente (banco + fotos)                                       |
| `/usr/local/bin/dcp`                | Atalho do Docker Compose (ver [docker.md](docker.md))                     |
| `/usr/local/bin/orari-backup`       | Script de backup (ver [backup.md](backup.md))                             |
| `/root/.config/rclone/rclone.conf`  | Conexões do `rclone` com o Drive (contém credenciais)                     |
| `/root/.ssh/orari_deploy*`          | Deploy key do backend no GitHub                                           |
| `/root/.ssh/orari_frontend_deploy*` | Deploy key do frontend no GitHub                                          |
| `/etc/docker/daemon.json`           | Configuração do Docker (limite do cache de build)                         |
| `/var/log/orari-backup.log`         | Log do backup                                                             |

`/usr/local/bin` é a pasta de "comandos instalados pelo administrador": tudo que
está nela vira um comando disponível em qualquer pasta.

## aaPanel

O **aaPanel** é um painel web de administração de servidores que veio instalado
pelo dono da VPS. Ele traz um Nginx, gerenciador de arquivos, banco MySQL etc.

**Como ele convive com o Orari:**

- **Quem atende as portas 80 e 443 é o Caddy** do Orari, não o Nginx do aaPanel.
  Só um programa pode ocupar cada porta.
- O site `orariapp.com.br` foi criado no aaPanel **só para ter a pasta**
  `/www/wwwroot/orariapp.com.br`. Quem serve os arquivos dela é o Caddy, que
  também emite o certificado. O botão de SSL do aaPanel **não funciona** e não é
  necessário.
- O gerenciador de arquivos do aaPanel é útil para enviar os arquivos da landing.

**Cuidado:** se o Nginx do aaPanel conseguir ocupar as portas 80/443 (por exemplo,
depois de reiniciar a VPS antes do Docker subir), o `app.` e o `api.` saem do ar.
Para conferir quem está nas portas:

```bash
ss -ltnp | grep -E ':(80|443) '
```

Deve aparecer `docker-proxy` (o Caddy). Se aparecer `nginx`, pare o Nginx do
aaPanel (`systemctl stop nginx` e desative no painel) e rode `dcp up -d caddy`.

**Se a pasta da landing for apagada e criada de novo** (ex.: removendo o site no
aaPanel), o Caddy continua apontando para a antiga: rode `dcp restart caddy`.

## Espaço em disco

O que costuma encher o disco, do mais provável para o menos:

| Vilão                        | Tamanho típico          | Seguro apagar?                        |
| ---------------------------- | ----------------------- | ------------------------------------- |
| **Cache de build do Docker** | **Chegou a 36 GB aqui** | Sim (`docker builder prune -a -f`)    |
| Imagens antigas do Docker    | Alguns GB               | Sim (`docker image prune -a -f`)      |
| Logs dos contêineres         | Cresce sem limite       | Sim, com cuidado                      |
| Logs do sistema (journald)   | Centenas de MB          | Sim (`journalctl --vacuum-size=200M`) |
| Cache do `apt`               | Centenas de MB          | Sim (`apt-get clean`)                 |
| Backups                      | Poucos MB               | Já fica só 1 cópia local              |
| **Volumes do Docker**        | Banco + fotos           | **NUNCA** (são os dados)              |

**Diagnóstico (só lê, não apaga):**

```bash
df -h /                                         # uso total
docker system df                                # imagens, contêineres, volumes, cache
du -xh --max-depth=1 / 2>/dev/null | sort -h | tail -12   # pastas maiores
journalctl --disk-usage                         # logs do sistema
```

**Limpeza segura:**

```bash
docker builder prune -a -f       # cache de build
docker image prune -a -f         # imagens sem uso
journalctl --vacuum-size=200M
apt-get clean
```

> **Nunca rode** `docker volume prune`, `docker system prune --volumes` nem
> `dcp down -v`: apagam o banco e as fotos.

### Limite automático do cache de build

Para o cache não voltar a crescer, o Docker pode limpar sozinho acima de um
tamanho. Confira se já existe configuração:

```bash
cat /etc/docker/daemon.json 2>/dev/null
```

Se não existir (ou estiver vazio):

```bash
cat > /etc/docker/daemon.json <<'EOF'
{
  "builder": { "gc": { "enabled": true, "defaultKeepStorage": "5GB" } }
}
EOF
systemctl restart docker
```

O `systemctl restart docker` derruba todos os contêineres por 30 a 60 segundos
(eles voltam sozinhos por causa do `restart: unless-stopped`). Faça fora do
horário de uso. Se o arquivo já tiver conteúdo, junte as chaves num JSON só, sem
apagar o que existe.

**Alternativa sem reiniciar o Docker:** agendar no `crontab -e`:

```
0 4 * * 1 docker builder prune -f --filter until=168h >> /var/log/docker-prune.log 2>&1
```

(toda segunda às 4h, apaga o cache com mais de 7 dias).

## Mudar de servidor

Por estar tudo em contêineres, mudar de VPS é:

1. No servidor novo: segurança básica, Docker, deploy keys, `git clone` dos dois
   repositórios ([`../deploy.md`](../deploy.md), etapas 2 a 4).
2. Copiar o `.env.production` (do gerenciador de senhas ou do servidor antigo, por
   `scp`).
3. Subir tudo (`dcp up -d --build`), **parar a API** (`dcp stop api`) e restaurar o
   banco e as fotos do backup mais recente ([backup.md](backup.md#restaurar-de-verdade-depois-de-um-desastre)).
4. Subir a API de novo e conferir.
5. Trocar o IP nos registros A do Cloudflare. Os certificados são emitidos de novo
   sozinhos.
6. Reinstalar o `rclone` (ou copiar o `rclone.conf`), o script de backup e o cron.

## Para outros projetos

- **Genérico:** requisitos mínimos, SSH, `ufw` + `fail2ban` + atualizações
  automáticas, cuidado com disco (cache do Docker), "um programa por porta".
- **Específico do Orari:** o aaPanel (herdado do dono da VPS) e as pastas
  `/www/wwwroot/...`. Num servidor seu, sem painel, a landing pode ficar em
  qualquer pasta (ex.: `/srv/landing`).
- **Conselho:** comece com um servidor **só para o projeto**. Dividir servidor com
  outras aplicações faz um problema de um lado derrubar o outro.
