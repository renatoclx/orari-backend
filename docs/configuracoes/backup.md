# Backup

Regras gerais de backup em [conceitos.md](conceitos.md#backup-as-regras-que-importam).

## Como está hoje

```
cron 03:00 ──▶ /usr/local/bin/orari-backup
                 │
                 ├─ 1. pg_dump do banco      ──▶ /root/backups/orari-AAAA-MM-DD-HHMM.sql.gz
                 ├─ 2. tar das fotos/logos   ──▶ /root/backups/uploads-AAAA-MM-DD-HHMM.tgz
                 ├─ 3. apaga as cópias locais anteriores (fica só a de hoje)
                 └─ 4. rclone copy ──▶ gcrypt: ──criptografa──▶ gdrive:orari-backups
                                          (Google Drive da conta do Orari)
                       rclone delete --min-age 14d   (a nuvem guarda 14 dias)
```

| Onde                | Quanto         | Criptografado     | Protege contra                                       |
| ------------------- | -------------- | ----------------- | ---------------------------------------------------- |
| VPS `/root/backups` | 1 cópia (hoje) | Não (`chmod 600`) | Erro de uso, restaurar rápido                        |
| Google Drive        | 14 dias        | **Sim**           | Perder a VPS, disco, provedor; erro descoberto tarde |

**Por que só 1 cópia na VPS:** economizar disco; o histórico fica no Drive. **Por
que 14 dias na nuvem:** se um problema começar hoje e só for notado daqui a uma
semana, ainda existe uma cópia de antes dele.

**O que NÃO está no backup (de propósito):** a `ANAMNESIS_ENCRYPTION_KEY` e as
senhas do `rclone`. Ficam no gerenciador de senhas. Um backup roubado, sem elas,
não revela nada.

## As peças

### O script `/usr/local/bin/orari-backup`

```bash
#!/bin/bash
# Backup diário do Orari: banco (dump) e fotos/logos (pasta de uploads).
# Guarda 1 cópia na VPS e 14 dias no Google Drive (criptografado pelo rclone).
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

# 1) Banco. pipefail: se o pg_dump falhar, o script para.
$COMPOSE exec -T db pg_dump -U orari orari | gzip > "$DB_FILE.tmp"
# Um dump de verdade tem centenas de KB; menos que isso indica falha.
if [ "$(stat -c %s "$DB_FILE.tmp")" -lt 1000 ]; then
  echo "backup do banco suspeito (muito pequeno), descartado" >&2
  exit 1
fi
mv "$DB_FILE.tmp" "$DB_FILE"
chmod 600 "$DB_FILE"

# 2) Fotos e logos. Arquivo pequeno é normal; só se confere a integridade.
$COMPOSE exec -T api tar czf - -C /data/uploads . > "$UPLOADS_FILE.tmp"
gzip -t "$UPLOADS_FILE.tmp"
mv "$UPLOADS_FILE.tmp" "$UPLOADS_FILE"
chmod 600 "$UPLOADS_FILE"

# 3) Na VPS fica só a cópia de hoje (economiza disco). Só roda depois que
#    as duas novas foram gravadas: nunca fica sem nenhuma.
find "$DIR" \( -name 'orari-*.sql.gz' -o -name 'uploads-*.tgz' \) \
  ! -name "orari-$STAMP.sql.gz" ! -name "uploads-$STAMP.tgz" -delete
echo "backup ok: $DB_FILE e $UPLOADS_FILE"

# 4) Cópia fora do servidor: Google Drive, criptografada (remote gcrypt).
#    Uma falha aqui não desfaz o backup local; fica registrada no log.
if rclone copy "$DB_FILE" gcrypt: && rclone copy "$UPLOADS_FILE" gcrypt:; then
  # Só apaga os antigos da nuvem depois de um envio que deu certo.
  rclone delete gcrypt: --min-age 14d
  echo "nuvem ok"
else
  echo "ERRO: envio para o Google Drive falhou" >&2
  exit 1
fi
```

**As decisões dentro do script:**

| Trecho                                       | Por quê                                                                                       |
| -------------------------------------------- | --------------------------------------------------------------------------------------------- |
| `set -euo pipefail`                          | Para no **primeiro erro** (inclusive no meio de um `                                          | `). Sem isso, um `pg_dump`que falha gera um`.gz` vazio que parece válido |
| `.tmp` + `mv`                                | O arquivo final só existe se ficou completo. Nunca há um backup "pela metade" com nome de bom |
| `trap … EXIT`                                | Limpa os `.tmp` se algo der errado                                                            |
| `-lt 1000`                                   | Um dump real tem centenas de KB; menos de 1 KB é falha                                        |
| `gzip -t`                                    | Confere que o arquivo das fotos abre                                                          |
| `chmod 600`                                  | Só o root lê (o banco tem dados pessoais)                                                     |
| Limpeza local **depois**                     | Nunca apaga a cópia anterior antes de a nova estar gravada                                    |
| Limpeza da nuvem **só se o envio deu certo** | Nunca fica sem backup recente na nuvem                                                        |
| `exit 1` se a nuvem falhar                   | O erro aparece no log (e pode virar alerta no futuro)                                         |

**`pg_dump`** gera um arquivo `.sql` com tudo que é preciso para recriar o banco.
Ele roda **dentro** do contêiner `db` (`exec -T db`), sem parar o banco.

### O agendamento (cron)

```bash
crontab -l
# 0 3 * * * /usr/local/bin/orari-backup >> /var/log/orari-backup.log 2>&1
```

Todo dia às 3h (horário do servidor, confira com `date`). Para criar: `crontab -e`
e acrescentar a linha no fim.

### O `rclone`: as duas conexões

O **rclone** é um programa que copia arquivos para mais de 70 serviços de nuvem
(Drive, Dropbox, S3, B2…). Ele trabalha com "**remotes**" (conexões com nome):

| Remote   | Tipo    | Aponta para                      | Papel                                       |
| -------- | ------- | -------------------------------- | ------------------------------------------- |
| `gdrive` | `drive` | O Google Drive da conta do Orari | A conexão com o Drive (autorização OAuth)   |
| `gcrypt` | `crypt` | `gdrive:orari-backups`           | Uma "camada" que criptografa tudo que passa |

**Sempre se envia pelo `gcrypt`**. Ele criptografa o conteúdo **e os nomes** dos
arquivos e entrega ao `gdrive`, que grava no Drive. O Google só vê nomes como
`lrvm4dt7kq3ldgtorqqlk7im3k`. Ao baixar pelo `gcrypt`, o rclone descriptografa.

```bash
rclone ls gcrypt:                  # visão "aberta": orari-2026-11-23-1621.sql.gz
rclone ls gdrive:orari-backups     # o que o Google vê: nomes embaralhados
```

A configuração fica em `/root/.config/rclone/rclone.conf`. Ela contém o token do
Google e as senhas da criptografia (num formato apenas "disfarçado", não
criptografado de verdade): **trate o arquivo como segredo** (`chmod 600`).

**As senhas da criptografia** (senha 1 e senha 2, "salt") estão no gerenciador de
senhas. **Sem elas, ninguém abre os backups do Drive, nem você.** Se a VPS se
perder, é delas que você precisa para criar o `gcrypt` de novo noutro computador.

### O lado do Google

| Item                    | Valor                                                       |
| ----------------------- | ----------------------------------------------------------- |
| Conta                   | A conta Google do Orari (a mesma do Resend), não a pessoal  |
| Pasta                   | `orari-backups` (conteúdo criptografado)                    |
| Projeto no Google Cloud | `orari-backup`, com a **Google Drive API** ativada          |
| App OAuth               | "Orari backup", público **Externo**, status **Em produção** |
| Escopo                  | `drive.file` (o rclone só enxerga o que ele mesmo criou)    |
| Cliente OAuth           | Tipo **App para computador**, nome `rclone`                 |
| Branding                | Sem logo (com logo, o Google exigiria verificação do app)   |

**Por que um client ID próprio:** o rclone tem um client ID "compartilhado", que o
Google limita e que está sendo **desativado em 2026**. Com o próprio, o backup não
para por causa de terceiros.

**Por que publicar o app (Em produção):** com o app "Em teste", o token vence a
cada **7 dias** e o backup pararia sozinho. Publicado, não vence. Como o escopo
`drive.file` é "não sensível", o Google publica sem análise.

**O aviso "O Google não verificou este app"** aparece na autorização porque a marca
não foi verificada. É esperado: **Avançado → Acessar Orari backup**. Só acontece
quando se autoriza.

**Efeito do `drive.file`:** o app novo não enxerga arquivos criados por outro
client ID. Na configuração, a pasta criada com o client compartilhado ficou
"invisível" e foi recriada.

## Montar do zero

**1. Instalar o rclone** (na VPS e no seu computador; o computador é só para a
autorização, porque precisa de navegador):

```bash
curl https://rclone.org/install.sh | sudo bash   # na VPS como root, sem o sudo
rclone version
```

O `apt install rclone` traz uma versão antiga: prefira o instalador oficial.

**2. Google Cloud** ([console.cloud.google.com](https://console.cloud.google.com),
logado na conta do Orari):

1. Novo projeto `orari-backup`.
2. Ativar a **Google Drive API**.
3. **Google Auth Platform** (Tela de consentimento OAuth) → Começar: nome "Orari
   backup", e-mail de suporte, público **Externo**, e-mail de contato.
4. **Branding:** página inicial `https://orariapp.com.br`, política
   `https://app.orariapp.com.br/privacidade`, termos
   `https://app.orariapp.com.br/termos`, domínio autorizado `orariapp.com.br`.
   **Sem logo.** O aviso "Sua marca não está aparecendo" pode ser ignorado.
5. **Público-alvo → Publicar app** → status **Em produção**.
6. **Clientes → Criar cliente** → **App para computador**, nome `rclone`. Guarde
   o ID e a chave secreta no gerenciador de senhas.

**3. Remote `gdrive`** (na VPS, `rclone config`):

| Pergunta                                         | Resposta                      |
| ------------------------------------------------ | ----------------------------- |
| `n/s/q>`                                         | `n`                           |
| `name>`                                          | `gdrive`                      |
| `Storage>`                                       | `drive`                       |
| `client_id>` / `client_secret>`                  | os do passo 2.6               |
| `scope>`                                         | `drive.file`                  |
| `service_account_file>`                          | Enter                         |
| `Edit advanced config?`                          | `n`                           |
| `Use web browser to automatically authenticate?` | `n` (a VPS não tem navegador) |

A VPS mostra `rclone authorize "drive" "eyJ…"`. **Esse texto contém a chave
secreta: não compartilhe.**

1. Rode a linha no **seu computador**. O navegador abre: conta do Orari →
   Avançado → Acessar Orari backup → Permitir.
2. O terminal do computador mostra um texto entre `--->` e `<---End paste`
   (começa com `eyJ0b2tlbi…`). É o **token**: cole na VPS em `config_token>`.
3. `Shared Drive?` → `n`; `Keep?` → `y`; `q`.

Teste: `rclone mkdir gdrive:orari-backups` e `rclone lsd gdrive:` (aparece a pasta).

**4. Remote `gcrypt`** (`rclone config` de novo):

| Pergunta                     | Resposta                                                     |
| ---------------------------- | ------------------------------------------------------------ |
| `n/s/q>`                     | `n`                                                          |
| `name>`                      | `gcrypt`                                                     |
| `Storage>`                   | `crypt`                                                      |
| `remote>`                    | `gdrive:orari-backups`                                       |
| `filename_encryption>`       | `standard`                                                   |
| `directory_name_encryption>` | `true`                                                       |
| senha: `y/g/n>`              | `g` (gerar), `Bits>` `256` → **guarde no gerenciador** → `y` |
| password2 (salt): `y/g/n>`   | `g`, `256` → **guarde no gerenciador** → `y`                 |
| `Edit advanced config?`      | `n`                                                          |
| `Keep?`                      | `y`, depois `q`                                              |

Teste:

```bash
echo "teste do backup" > /tmp/teste.txt
rclone copy /tmp/teste.txt gcrypt:
rclone ls gcrypt:                  # 16 teste.txt
rclone ls gdrive:orari-backups     # nome embaralhado
rclone delete gcrypt:teste.txt; rm /tmp/teste.txt
```

**5. Script e cron:** grave o script acima em `/usr/local/bin/orari-backup` (com
`cat > … <<'EOF'`), `chmod +x`, rode uma vez à mão e crie a linha do cron.

**Colou um bloco grande no terminal e a tela embaralhou?** Normalmente é só a tela.
Confira o arquivo gravado:

```bash
bash -n /usr/local/bin/orari-backup && echo "sintaxe ok"
wc -l < /usr/local/bin/orari-backup     # número de linhas esperado
md5sum /usr/local/bin/orari-backup      # compare com o md5 do arquivo original
```

## Conferir (rotina)

```bash
tail -5 /var/log/orari-backup.log   # "backup ok: …" e "nuvem ok" da última noite
ls -lh ~/backups                    # 2 arquivos de hoje
rclone ls gcrypt:                   # até 14 dias de pares
```

Resultado da primeira execução (referência de tamanho): banco 273 KB, fotos
1,1 MB. Se o banco cair muito de tamanho de um dia para o outro, desconfie.

## Testar a restauração (a cada 3 meses)

Restaura a cópia **do Drive** num banco **à parte** (`orari_restauracao`) e compara
com o real. Não toca no banco de verdade.

```bash
cd ~/orari-backend
ARQ=$(rclone lsf gcrypt: --include 'orari-*.sql.gz' | sort | tail -1)   # o mais recente
mkdir -p /tmp/restauracao
rclone copy "gcrypt:$ARQ" /tmp/restauracao/

dcp exec -T db psql -U orari -d postgres -c 'CREATE DATABASE orari_restauracao;'
gunzip -c "/tmp/restauracao/$ARQ" | \
  dcp exec -T db psql -U orari -d orari_restauracao -q -v ON_ERROR_STOP=1
echo "cópia:"; dcp exec -T db psql -U orari -d orari_restauracao -tAc 'select count(*) from users'
echo "real:";  dcp exec -T db psql -U orari -d orari -tAc 'select count(*) from users'

dcp exec -T db psql -U orari -d postgres -c 'DROP DATABASE orari_restauracao;'
rm -rf /tmp/restauracao
```

Os dois números devem bater (no primeiro teste, em 2026-11-23: 10 e 10).
`ON_ERROR_STOP=1` faz o teste falhar no primeiro erro, em vez de aceitar um backup
"meio bom". O `DROP DATABASE` apaga **só a cópia de teste**.

Fotos, sem mexer em nada: `tar tzf arquivo.tgz` lista o conteúdo.

## Restaurar de verdade (depois de um desastre)

**Pare e pense antes:** restaurar por cima **apaga o banco atual**. Faça com calma
e, se possível, com ajuda.

```bash
cd ~/orari-backend
orari-backup || true                      # guarda o estado atual, mesmo que ruim
dcp stop api frontend                     # ninguém grava enquanto restaura

# 1. Banco (escolha o arquivo: rclone ls gcrypt:)
rclone copy gcrypt:orari-AAAA-MM-DD-HHMM.sql.gz /tmp/r/
dcp exec -T db psql -U orari -d postgres -c 'DROP DATABASE orari;'
dcp exec -T db psql -U orari -d postgres -c 'CREATE DATABASE orari OWNER orari;'
gunzip -c /tmp/r/orari-AAAA-MM-DD-HHMM.sql.gz | \
  dcp exec -T db psql -U orari -d orari -q -v ON_ERROR_STOP=1

# 2. Fotos (acrescenta/sobrescreve; não apaga as que existem)
rclone copy gcrypt:uploads-AAAA-MM-DD-HHMM.tgz /tmp/r/
dcp up -d api
dcp exec -T api tar xzf - -C /data/uploads < /tmp/r/uploads-AAAA-MM-DD-HHMM.tgz

dcp up -d                                 # sobe tudo
rm -rf /tmp/r
```

**Num servidor novo** (VPS perdida): instale o rclone, crie o `gdrive` (autorizando
de novo) e o `gcrypt` com **as mesmas duas senhas** do gerenciador (`y` em vez de
`g`, e cole cada senha). Os arquivos do Drive voltam a abrir. A
`ANAMNESIS_ENCRYPTION_KEY` também precisa ser a mesma no `.env.production` novo.

## Trocar a chave secreta do Google

Se a chave secreta do cliente vazar (ela aparece dentro do `rclone authorize
"drive" "eyJ…"`):

1. Google Cloud → Google Auth Platform → **Clientes → rclone** → **Adicionar
   chave secreta**. Guarde a nova.
2. Na VPS: `rclone config` → `e` → `gdrive` → troque **só** o `client_secret`
   (Enter nas outras), `Already have a token - refresh?` → `n` (o token atual
   continua válido).
3. Teste: `rclone ls gcrypt:`.
4. Volte ao Google Cloud e **desative/exclua a chave antiga**.

Pelo próprio Google, a chave de um "App para computador" não é considerada
confidencial, e sozinha ela não dá acesso ao Drive (o acesso vem do token). Trocar
é boa prática, não emergência.

## Problemas comuns

| Sintoma                                         | Causa e solução                                                                                 |
| ----------------------------------------------- | ----------------------------------------------------------------------------------------------- |
| `NOTICE: … shared Google Drive client_id …`     | O `gdrive` usa o client compartilhado: configure o próprio (passo 2 e `rclone config` → editar) |
| "Erro 403: access_denied" ao autorizar          | O app está **Em teste**: publique (Público-alvo → Publicar app)                                 |
| Publicar pede "branding"                        | Preencha a tela de Branding (sem logo)                                                          |
| `directory not found` depois de trocar o client | O `drive.file` não enxerga o que o client antigo criou: apague a pasta antiga no Drive e recrie |
| `nuvem ok` não aparece no log                   | Token revogado ou senha da conta trocada: `rclone config` → editar `gdrive` → refresh do token  |
| `backup do banco suspeito`                      | O `pg_dump` falhou: `dcp ps` (o `db` está de pé?)                                               |
| Disco cheio                                     | Não é o backup (fica 1 cópia): veja [servidor.md](servidor.md#espaço-em-disco)                  |

## Para outros projetos

- **O padrão serve para qualquer banco:** dump → arquivo `.tmp` → conferir → `mv`
  → enviar criptografado → limpar os antigos só depois do envio.
- **rclone + crypt** funciona com qualquer nuvem (Drive, Backblaze B2, Cloudflare
  R2, S3). Para um projeto sem conta Google, o **B2** é o mais simples (10 GB
  grátis, chave de API sem OAuth e sem vencimento).
- **Uma conta da empresa** para os backups, nunca a pessoal.
- **Teste a restauração** na configuração e de tempos em tempos. Anote a data e o
  resultado.
