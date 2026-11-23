# Configurações do Orari

Documentação de consulta de **toda a infraestrutura** do Orari: o que é cada peça,
por que ela foi escolhida, como está configurada hoje, como montar do zero, como
conferir se está funcionando e o que fazer quando der problema.

Foi escrita para dois usos:

1. **Operar o Orari** (atualizar, conferir, restaurar backup, trocar uma chave).
2. **Servir de modelo para outros projetos**: cada documento termina com uma seção
   "Para outros projetos", com o que é genérico e o que é específico do Orari.

> **Nenhum segredo está escrito aqui.** Senhas, chaves e tokens ficam só no
> servidor (`.env.production`, configuração do `rclone`) e no gerenciador de
> senhas. Esta documentação diz **onde** cada segredo está, nunca o **valor**.

## Índice

| Documento                                  | Assunto                                                                                       |
| ------------------------------------------ | --------------------------------------------------------------------------------------------- |
| [conceitos.md](conceitos.md)               | Os conceitos por trás de tudo: servidor, DNS, HTTPS, proxy, contêiner, variável, criptografia |
| [servidor.md](servidor.md)                 | A VPS: acesso SSH, segurança, pastas, disco, aaPanel                                          |
| [docker.md](docker.md)                     | Docker e Docker Compose: os 4 serviços, volumes, o comando `dcp`, atualizar, limpar           |
| [caddy-e-dominios.md](caddy-e-dominios.md) | O Caddy: HTTPS automático, os endereços do Orari e a landing                                  |
| [dns-cloudflare.md](dns-cloudflare.md)     | Todos os registros DNS do domínio, um por um, com o porquê                                    |
| [email.md](email.md)                       | E-mail: o Resend (envio do sistema) e a caixa de e-mail do domínio (uni5)                     |
| [backup.md](backup.md)                     | Backup diário, cópia criptografada no Google Drive (`rclone`) e restauração                   |
| [variaveis.md](variaveis.md)               | Cada variável do `.env.production`: o que faz, de onde vem, o que acontece se faltar          |
| [landing.md](landing.md)                   | O site institucional: compilar o CSS e publicar                                               |

O passo a passo de **instalação do zero** (na ordem em que se faz) continua em
[`../deploy.md`](../deploy.md). Estes documentos explicam **cada peça** em
profundidade e são o lugar para consultar depois.

## O desenho geral

```
                         ┌───────────────────── Cloudflare (DNS) ─────────────────────┐
                         │ orariapp.com.br, www, app, api → IP da VPS  (nuvem cinza)  │
                         │ send, rsend, resend._domainkey, _dmarc  → Resend (e-mail)  │
                         │ MX, pop, smtp, webmail, SPF             → uni5 (caixa)     │
                         └────────────────────────────┬────────────────────────────────┘
                                                      │ "onde fica orariapp.com.br?"
                                                      ▼
 navegador ──HTTPS──▶ ┌──────────────────────────── VPS (Linux) ─────────────────────────────┐
                      │  Docker Compose (projeto orari-prod)                                  │
                      │                                                                       │
                      │  ┌────────┐  app.…   ┌──────────┐  http://api:3333  ┌─────┐   ┌────┐ │
                      │  │ Caddy  │ ───────▶ │ frontend │ ────────────────▶ │ api │──▶│ db │ │
                      │  │ 80/443 │  api.…   │ (Next.js)│                   │Nest │   │ PG │ │
                      │  │        │ ───────────────────────────────────────▶│     │   └────┘ │
                      │  │        │  orariapp.com.br → arquivos da landing  └──┬──┘          │
                      │  └────────┘                                            │ Resend API  │
                      │                                                         ▼ (e-mails)   │
                      │  cron 03:00 → orari-backup → /root/backups (1 cópia)                  │
                      │                            └─ rclone (criptografado) ─▶ Google Drive  │
                      └───────────────────────────────────────────────────────────────────────┘
```

**Lendo o desenho:**

- Quem digita um endereço do Orari pergunta ao **DNS** (no Cloudflare) qual é o
  IP. O DNS responde com o IP da VPS.
- Na VPS, só o **Caddy** está exposto para a internet (portas 80 e 443). Ele cuida
  do HTTPS e repassa cada pedido para o serviço certo, conforme o endereço.
- O **frontend** (Next.js) é o que o usuário vê. Ele fala com a **API** (NestJS)
  pela rede interna do Docker. A API é a única que fala com o **banco**
  (PostgreSQL).
- Os e-mails do sistema (ex.: "Esqueci minha senha") saem da API para o
  **Resend**, que entrega na caixa da pessoa.
- Todo dia às 3h, um **backup** é gravado na VPS e uma cópia criptografada vai para
  o **Google Drive**.

## Onde está cada coisa

| O quê                            | Onde                                                                           |
| -------------------------------- | ------------------------------------------------------------------------------ |
| Código da API                    | GitHub `orari-backend` → na VPS em `/root/orari-backend`                       |
| Código do frontend               | GitHub `orari-frontend` → na VPS em `/root/orari-frontend`                     |
| Arquivos da landing              | Seu computador `orari/landing-page` → na VPS em `/www/wwwroot/orariapp.com.br` |
| Configuração dos serviços        | `docker-compose.prod.yml`, `Caddyfile`, `Dockerfile` (no `orari-backend`)      |
| Variáveis e segredos de produção | `/root/orari-backend/.env.production` (só na VPS, `chmod 600`)                 |
| Banco de dados                   | Volume Docker `orari-prod_pgdata`                                              |
| Fotos e logos                    | Volume Docker `orari-prod_uploads` (dentro do contêiner: `/data/uploads`)      |
| Certificados HTTPS               | Volume Docker `orari-prod_caddy_data` (o Caddy cuida sozinho)                  |
| Script de backup                 | `/usr/local/bin/orari-backup` (na VPS)                                         |
| Backups locais                   | `/root/backups` (só a cópia mais recente)                                      |
| Log do backup                    | `/var/log/orari-backup.log`                                                    |
| Backups na nuvem                 | Google Drive da conta do Orari, pasta `orari-backups` (criptografada)          |
| Configuração do `rclone`         | `/root/.config/rclone/rclone.conf` (na VPS)                                    |
| Atalho de comandos do Docker     | `/usr/local/bin/dcp`                                                           |
| Agendamentos (cron)              | `crontab -l` (usuário root)                                                    |
| DNS                              | Painel do Cloudflare, domínio `orariapp.com.br`                                |
| Registro do domínio              | Registro.br                                                                    |

## Contas e serviços externos

| Serviço                 | Para que                                                   | Plano                       |
| ----------------------- | ---------------------------------------------------------- | --------------------------- |
| Registro.br             | Dono do domínio `orariapp.com.br`                          | Anual, pago                 |
| Cloudflare              | DNS (diz para onde cada endereço aponta)                   | Grátis                      |
| GitHub                  | Código-fonte (`orari-backend`, `orari-frontend`)           | Grátis                      |
| Resend                  | Envio dos e-mails do sistema                               | Grátis (3.000/mês, 100/dia) |
| Google (conta do Orari) | Drive dos backups + projeto `orari-backup` no Google Cloud | Grátis                      |
| uni5                    | Caixa de e-mail do domínio (webmail), cedida por um amigo  | Cortesia                    |
| VPS                     | Onde tudo roda                                             | Emprestada (piloto)         |

## Segredos: o nome, onde está e onde guardar a cópia

Todos têm uma cópia no **gerenciador de senhas**. Se a VPS for perdida, é dessa
cópia que você reconstrói tudo.

| Segredo                                  | Onde vive             | O que acontece se perder                               |
| ---------------------------------------- | --------------------- | ------------------------------------------------------ |
| Senha do root da VPS / chave SSH         | Gerenciador de senhas | Perde o acesso ao servidor (provedor pode resetar)     |
| `POSTGRES_PASSWORD` (e `DATABASE_URL`)   | `.env.production`     | Pode ser trocada; o banco precisa ser atualizado junto |
| `JWT_SECRET`                             | `.env.production`     | Gerar outro desconecta todo mundo (só isso)            |
| `ANAMNESIS_ENCRYPTION_KEY`               | `.env.production`     | **As fichas de anamnese viram lixo, sem recuperação**  |
| `VAPID_PRIVATE_KEY`                      | `.env.production`     | Os avisos no celular param; clientes reativam          |
| `RESEND_API_KEY`                         | `.env.production`     | Os e-mails param; crie outra no Resend                 |
| Senha 1 e senha 2 do `rclone crypt`      | `rclone.conf` na VPS  | **Os backups da nuvem não podem ser abertos**          |
| Client ID e chave secreta do Google      | `rclone.conf` na VPS  | Crie outra no Google Cloud e autorize de novo          |
| Senha do administrador do Orari          | Gerenciador de senhas | Use "Esqueci minha senha"                              |
| Deploy keys do GitHub (`~/.ssh/orari_*`) | Só na VPS             | Gere outras e cadastre no GitHub                       |

**Regra de ouro:** segredo não vai para o Git, não vai para conversa (nem com a
IA), não vai para print. Para gravar um segredo no servidor sem que ele apareça na
tela nem no histórico, use sempre o padrão:

```bash
read -rs -p "Cole o valor e tecle Enter: " VALOR; echo
echo "NOME_DA_VARIAVEL=$VALOR" >> .env.production
unset VALOR
grep -c '^NOME_DA_VARIAVEL=' .env.production   # conta a linha sem mostrar o valor
```

O `VALOR` do comando é o **nome** de uma variável temporária: não troque pela
chave. O terminal para e pede; só então você cola.

## Rotinas

| Quando                 | O quê                                                               | Doc                        |
| ---------------------- | ------------------------------------------------------------------- | -------------------------- |
| Todo dia, 03:00        | Backup automático (banco + fotos → VPS e Google Drive)              | [backup.md](backup.md)     |
| A cada versão nova     | Backup, `git pull`, `dcp up -d --build`, conferir logs              | [docker.md](docker.md)     |
| Toda semana (1 minuto) | `tail /var/log/orari-backup.log` — confere "nuvem ok"               | [backup.md](backup.md)     |
| Todo mês               | `df -h /` e `docker system df` — espaço em disco                    | [servidor.md](servidor.md) |
| A cada 3 meses         | Testar uma restauração a partir do Drive                            | [backup.md](backup.md)     |
| Uma vez por ano        | Renovar o domínio no Registro.br (automático, mas confira o cartão) | —                          |
