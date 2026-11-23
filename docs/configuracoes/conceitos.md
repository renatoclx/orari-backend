# Conceitos

O mínimo de teoria para entender **por que** a infraestrutura do Orari é como é.
Cada conceito tem: o que é, uma comparação do dia a dia e onde ele aparece no
Orari.

## Servidor, VPS e hospedagem

**Servidor** é um computador ligado 24 horas na internet, que responde a pedidos.
Não tem tela nem mouse: você o controla pelo terminal, de longe (SSH).

**VPS** (Servidor Virtual Privado) é uma "fatia" de um computador grande de um
provedor. Para você, funciona como um computador só seu: você é o `root`
(administrador), instala o que quiser e é responsável por tudo, inclusive pela
segurança e pelo backup.

**Hospedagem compartilhada** (as de "site em WordPress") não serve para o Orari:
ela não deixa instalar PostgreSQL nem Docker.

> **Comparação:** a hospedagem compartilhada é um quarto de hotel (mobiliado, mas
> você não muda nada); a VPS é um apartamento vazio (você monta e cuida de tudo).

**No Orari:** uma VPS Linux roda tudo: banco, API, frontend, landing e
backup. Ver [servidor.md](servidor.md).

## Terminal, SSH e root

- **Terminal:** a janela onde se digitam comandos.
- **SSH:** o "cabo" seguro, pela internet, entre o seu terminal e o da VPS.
  `ssh root@IP` abre uma sessão: o que você digita depois roda **no servidor**.
- **root:** o usuário administrador do Linux. Pode tudo, inclusive apagar o
  sistema. Por isso a senha (ou chave) dele é o segredo mais importante.
- **`~`:** atalho para a pasta do usuário. Para o root, `~` é `/root`.

**Erro comum:** rodar no seu computador um comando que era para a VPS (ou o
contrário). Olhe sempre o começo da linha do terminal (`root@servidor` ou
`seu-usuario@seu-pc`).

## Domínio e DNS

O **domínio** (`orariapp.com.br`) é um nome fácil de lembrar. Os computadores só
se encontram por **IP** (ex.: `187.45.x.x`). O **DNS** é a "lista telefônica" que
traduz nome em IP.

- **Registro.br:** onde o domínio foi comprado. Lá se diz **quem cuida do DNS**
  (no nosso caso, o Cloudflare).
- **Cloudflare:** guarda a "lista telefônica" do domínio (os **registros**).

**Tipos de registro que usamos:**

| Tipo  | O que diz                                             | Exemplo no Orari                        |
| ----- | ----------------------------------------------------- | --------------------------------------- |
| A     | "Este nome fica neste IP"                             | `app` → IP da VPS                       |
| CNAME | "Este nome é um apelido daquele outro nome"           | `www` → `orariapp.com.br`               |
| MX    | "Os e-mails para este domínio vão para este servidor" | `@` → `mx-vip-01.uni5.net`              |
| TXT   | "Um texto qualquer" (usado para provas e regras)      | SPF, DKIM, DMARC, verificação do Google |

- **`@`** é o próprio domínio (`orariapp.com.br`), sem nada na frente.
- **Subdomínio** é um nome na frente: `app.orariapp.com.br`, `api.orariapp.com.br`.
- **Propagação:** mudar um registro leva de segundos a algumas horas para valer
  no mundo todo, porque os servidores de DNS guardam a resposta por um tempo
  (o **TTL**).

Ver [dns-cloudflare.md](dns-cloudflare.md).

## Nuvem laranja x nuvem cinza (Cloudflare)

Cada registro A/CNAME no Cloudflare tem uma nuvem:

- **Cinza ("DNS only"):** o Cloudflare só responde o IP. O visitante conversa
  **direto** com a VPS.
- **Laranja ("Proxied"):** o Cloudflare se coloca **no meio**: o visitante fala
  com o Cloudflare, e ele fala com a VPS. Esconde o IP verdadeiro e oferece cache
  e proteção.

**No Orari, tudo é cinza.** Motivos:

1. O **Caddy** já cuida do HTTPS. Com a nuvem laranja, os certificados e o "SSL
   mode" do Cloudflare precisam ser combinados com cuidado (dá erro 525 se
   estiver errado).
2. A API limita tentativas de login **por IP**. Com o proxy, todo mundo chegaria
   com o IP do Cloudflare, e um usuário errando a senha bloquearia os outros.
3. Registros de e-mail (`send`, `smtp`, `pop`, `webmail`) **não funcionam** pelo
   proxy, que só entende tráfego web.

## HTTP, HTTPS e certificado

- **HTTP:** a conversa entre navegador e servidor, em texto aberto. Qualquer um
  no caminho (Wi-Fi público, provedor) lê senhas e dados.
- **HTTPS:** a mesma conversa, **criptografada**. É o cadeado no navegador.
- **Certificado:** o "documento" que prova que o servidor é mesmo dono do
  domínio. É emitido por uma autoridade (o **Let's Encrypt**, gratuito) e vale 90
  dias.
- **Portas:** um servidor tem "portas" numeradas. **80** é o HTTP, **443** é o
  HTTPS, **22** é o SSH. **Só um programa pode ocupar cada porta.**

**No Orari:** o Caddy pede e renova os certificados sozinho. Para isso, o domínio
precisa apontar para a VPS e as portas 80 e 443 precisam estar livres e abertas.
Ver [caddy-e-dominios.md](caddy-e-dominios.md).

## Proxy reverso

Um **proxy reverso** é uma "recepção" na frente dos serviços. Todo pedido chega
nele, e ele decide para quem encaminhar, olhando o endereço pedido.

> **Comparação:** a recepcionista de um prédio comercial. Todo visitante entra
> pela mesma porta; ela pergunta para qual empresa vai e indica o andar.

**Por que usar:**

- **Uma porta só** (443) para vários serviços (`app.`, `api.`, o site).
- **HTTPS num lugar só**: os serviços de dentro falam HTTP simples entre si.
- **Esconde** os serviços internos: o banco e o frontend nem têm porta aberta.

**No Orari:** o proxy reverso é o **Caddy**.

## Contêiner e Docker

Um **contêiner** é um "pacote" com um programa e **tudo** que ele precisa para
rodar (a versão certa do Node, as bibliotecas, as configurações), isolado do resto
do servidor.

> **Comparação:** o contêiner de navio. Não importa o que tem dentro: o navio
> (servidor) carrega todos do mesmo jeito, e o conteúdo chega igual.

- **Imagem:** a "receita congelada" de um contêiner (ex.: `postgres:16-alpine`,
  ou a imagem da API construída pelo `Dockerfile`).
- **Contêiner:** a imagem **rodando**. Pode ser apagado e recriado a qualquer
  momento: o que está dentro dele é descartável.
- **Volume:** uma pasta **fora** do contêiner, onde ficam os dados que precisam
  sobreviver (o banco, as fotos). Apagar o contêiner não apaga o volume.
- **Dockerfile:** o arquivo com o passo a passo para construir a imagem.
- **Docker Compose:** um arquivo (`docker-compose.prod.yml`) que descreve **vários
  contêineres** juntos, como eles se conectam e quais volumes usam. Um comando
  (`up`) sobe tudo.

**Por que Docker no Orari:**

1. **Igual em todo lugar:** o que funciona no seu computador funciona na VPS.
2. **Instalação em um comando**, sem instalar Node, PostgreSQL etc. à mão no
   servidor.
3. **Atualizar é trocar a imagem**: os dados nos volumes não são tocados.
4. **Isolamento:** o banco não fica exposto; um serviço não interfere no outro.
5. **Mudar de servidor** é copiar o código, o `.env.production` e o backup.

Ver [docker.md](docker.md).

## Variáveis de ambiente e `.env`

O mesmo código roda no seu computador e na produção, mas com configurações
diferentes (endereço do banco, senhas, domínios). Essas configurações ficam em
**variáveis de ambiente**, lidas pelo programa ao iniciar.

O arquivo **`.env.production`** guarda as variáveis da produção. Ele **nunca** vai
para o Git, porque contém segredos. O `.env.production.example` (este vai para o
Git) é o modelo, com os nomes e sem os valores.

**Mudou uma variável?** O contêiner só lê o arquivo quando é **criado**. Um
`restart` não basta: use `dcp up -d <serviço>` (recria).

Ver [variaveis.md](variaveis.md).

## Criptografia, hash e assinatura

- **Criptografia:** embaralha um dado com uma **chave**; só quem tem a chave
  desembaralha. Usada no HTTPS, nas fichas de anamnese e no backup do Drive.
- **Hash:** uma "impressão digital" de mão única. Do dado se calcula o hash, mas do
  hash não se volta ao dado. Usado nas **senhas** dos usuários e nos **links de
  "Esqueci minha senha"**: o banco guarda só o hash, então um banco vazado não
  revela nem as senhas nem os links.
- **Assinatura:** prova que algo foi emitido por quem diz que foi e não foi
  alterado. O `JWT_SECRET` assina os logins; o DKIM assina os e-mails.
- **`md5sum`:** calcula um hash de um arquivo. Serve para conferir se dois arquivos
  são idênticos (usamos para conferir o script de backup colado na VPS).

## Autenticação de e-mail: SPF, DKIM e DMARC

Qualquer um pode escrever "De: nao-responda@orariapp.com.br" num e-mail. Para que o
Gmail e o Outlook **confiem** que o e-mail é mesmo do Orari, existem três
registros no DNS:

| Registro  | Pergunta que responde                                             |
| --------- | ----------------------------------------------------------------- |
| **SPF**   | "Quais servidores podem enviar e-mail por este domínio?"          |
| **DKIM**  | "Este e-mail foi assinado com a chave deste domínio?"             |
| **DMARC** | "Se o SPF ou o DKIM falhar, o que fazer? (nada, spam ou recusar)" |

Sem eles, o e-mail cai no spam ou é recusado. Ver [email.md](email.md).

## OAuth e tokens

**OAuth** é o "entrar com o Google": em vez de dar a sua senha para um programa,
você autoriza o programa **no site do Google**, e o Google entrega a ele um
**token** (uma credencial com permissões limitadas, que pode ser revogada).

- **Client ID / chave secreta:** a "identidade" do programa no Google.
- **Escopo (scope):** o que o token permite. Usamos `drive.file`: o programa só
  enxerga os arquivos que **ele mesmo** criou no Drive.
- **App em teste x em produção:** em "teste", os tokens vencem em 7 dias. Em
  "produção", não.

**No Orari:** o `rclone` usa OAuth para enviar os backups ao Google Drive. Ver
[backup.md](backup.md).

## cron (agendamento)

O **cron** é o "despertador" do Linux: roda comandos em horários marcados. Cada
linha do `crontab` tem 5 campos de tempo e o comando:

```
┌ minuto (0-59)
│ ┌ hora (0-23)
│ │ ┌ dia do mês (1-31)
│ │ │ ┌ mês (1-12)
│ │ │ │ ┌ dia da semana (0-6, 0 = domingo)
0 3 * * * /usr/local/bin/orari-backup >> /var/log/orari-backup.log 2>&1
```

`*` significa "qualquer". A linha acima: todo dia, às 3h00. O `>> arquivo 2>&1`
guarda a saída e os erros no log.

- `crontab -l` mostra os agendamentos; `crontab -e` edita.
- A hora é a **do servidor** (confira com `date`).

## Backup: as regras que importam

1. **3-2-1:** 3 cópias, em 2 lugares diferentes, 1 fora do servidor.
2. **Automático:** backup que depende de lembrar não acontece.
3. **Criptografado** quando sai do servidor (dados pessoais, LGPD).
4. **Testado:** backup que nunca foi restaurado não é backup, é esperança.
5. **As chaves ficam fora do backup**, em outro lugar seguro. Um backup que leva
   junto a chave de abri-lo não protege nada.

## Git, branch e deploy key

- **Git:** guarda o histórico do código. **GitHub:** onde o histórico fica na
  internet.
- **Branch:** uma "linha paralela" de trabalho. A `main` é a versão oficial; cada
  mudança nasce numa branch e entra na `main` por um **PR** (pull request).
- **Deploy key:** uma chave SSH que vive **só na VPS** e só pode **ler** um
  repositório. Assim a VPS baixa o código sem ter a sua senha do GitHub.

## Glossário rápido

| Termo         | Em uma frase                                                               |
| ------------- | -------------------------------------------------------------------------- |
| API           | O "cérebro" do sistema: regras e dados, sem tela                           |
| Frontend      | As telas que o usuário vê                                                  |
| Landing       | O site institucional de apresentação (`orariapp.com.br`)                   |
| Healthcheck   | Um teste automático que o Docker faz para saber se o serviço está saudável |
| Log           | O "diário" de um programa: o que ele fez e os erros                        |
| Migração      | Um script que muda a estrutura do banco (cria tabela, coluna)              |
| Seed          | Dados iniciais (ex.: o primeiro administrador)                             |
| Rate limit    | Limite de pedidos por tempo (ex.: 5 tentativas de login por minuto)        |
| Let's Encrypt | Autoridade gratuita que emite certificados HTTPS                           |
| `chmod 600`   | Só o dono do arquivo pode ler e escrever                                   |
| Proxy reverso | A "recepção" que encaminha cada pedido ao serviço certo                    |
