# DNS (Cloudflare)

Conceitos (DNS, tipos de registro, nuvem laranja x cinza) em
[conceitos.md](conceitos.md#domínio-e-dns).

## Quem faz o quê

1. **Registro.br**: onde o domínio `orariapp.com.br` foi registrado. Lá está
   configurado que **o DNS é do Cloudflare** (os "servidores DNS" apontam para
   `*.ns.cloudflare.com`). Com autenticação em duas etapas e renovação automática.
2. **Cloudflare**: guarda os registros. É aqui que se cria ou muda qualquer
   endereço.

**Por que o Cloudflare e não o DNS do próprio Registro.br?** Painel mais simples,
mudanças valem em segundos, e é grátis. A proteção e o cache (nuvem laranja) não
são usados.

## Todos os registros

Painel do Cloudflare → `orariapp.com.br` → **DNS → Records**. Todos com **TTL
Auto** e, quando houver a opção, **Proxy: DNS only (nuvem cinza)**.

### Site e sistema (apontam para a VPS)

| Tipo  | Nome  | Conteúdo          | Para quê                                   |
| ----- | ----- | ----------------- | ------------------------------------------ |
| A     | `@`   | IP da VPS         | Landing (`orariapp.com.br`)                |
| CNAME | `www` | `orariapp.com.br` | `www` (o Caddy redireciona para sem `www`) |
| A     | `app` | IP da VPS         | O sistema                                  |
| A     | `api` | IP da VPS         | A API                                      |

### Envio de e-mail do sistema (Resend)

| Tipo  | Nome                | Conteúdo                                    | Para quê                                        |
| ----- | ------------------- | ------------------------------------------- | ----------------------------------------------- |
| TXT   | `resend._domainkey` | `p=MIGfMA0GCSqG…QIDAQAB` (copiar do Resend) | **DKIM**: a chave pública que assina os e-mails |
| CNAME | `send`              | `send.forge.rmta.net`                       | **SPF e devoluções** do Resend                  |
| CNAME | `rsend`             | `rsend-sae1.forge.rmta.net`                 | Envio pela região São Paulo do Resend           |
| TXT   | `_dmarc`            | `v=DMARC1; p=none;`                         | **DMARC**: política (só observa)                |

### Caixa de e-mail do domínio (uni5, cedida por um amigo)

| Tipo  | Nome      | Conteúdo                            | Prioridade | Para quê                                   |
| ----- | --------- | ----------------------------------- | ---------- | ------------------------------------------ |
| MX    | `@`       | `mx-vip-01.uni5.net`                | 5          | Receber e-mails em `@orariapp.com.br`      |
| MX    | `@`       | `mx-vip-02.uni5.net`                | 5          | Segundo servidor (reserva)                 |
| TXT   | `@`       | `v=spf1 include:_spf.uni5.net -all` | –          | **SPF** da caixa: só o uni5 envia pelo `@` |
| CNAME | `pop`     | `imap-vip.uni5.net`                 | –          | Ler e-mails num programa (POP/IMAP)        |
| CNAME | `smtp`    | `smtp-vip.uni5.net`                 | –          | Enviar e-mails num programa                |
| CNAME | `webmail` | `webmail-vip.uni5.net`              | –          | `webmail.orariapp.com.br` no navegador     |

### Outros

| Tipo | Nome | Conteúdo                     | Para quê                                                |
| ---- | ---- | ---------------------------- | ------------------------------------------------------- |
| TXT  | `@`  | `google-site-verification=…` | Prova de dono do domínio para o Google (Search Console) |

## Por que cada decisão

- **Tudo em nuvem cinza.** Os motivos estão em
  [conceitos.md](conceitos.md#nuvem-laranja-x-nuvem-cinza-cloudflare): o Caddy já
  faz o HTTPS, a API precisa do IP real do usuário, e registros de e-mail não
  passam pelo proxy. Foi uma nuvem laranja esquecida no `send` que impediu o
  Resend de verificar o domínio.
- **O `www` do provedor de e-mail ficou de fora.** O uni5 pedia um CNAME `www` →
  `web2211.uni5.net` (a hospedagem de site dele). Como o site do Orari é servido
  pelo Caddy, o `www` aponta para `orariapp.com.br`. Trocar derrubaria o site.
- **Só um SPF na raiz (`@`).** Um domínio pode ter **um único** TXT `v=spf1` em
  cada nome. O do `@` é da caixa do uni5. O Resend tem o SPF dele no subdomínio
  `send`, então os dois não se misturam.
- **`-all` no SPF do uni5:** "recuse e-mails do `@orariapp.com.br` que não venham do
  uni5". É a regra mais rígida (e a mais segura contra falsificação). Não afeta o
  Resend, que envia pelo `send`.
- **DMARC com `p=none`:** só observa, não bloqueia nada. Seguro para começar.
  Depois de meses sem problemas, pode endurecer para `p=quarantine` (vai para o
  spam o que falhar).
- **A prioridade do MX:** número **menor** = tentado primeiro. Dois iguais (5 e 5)
  dividem a carga.

## Conferir

De qualquer computador:

```bash
dig +short orariapp.com.br A           # IP da VPS
dig +short www.orariapp.com.br CNAME   # orariapp.com.br.
dig +short app.orariapp.com.br A       # IP da VPS (nunca 104.21… ou 172.67…, que são do Cloudflare)
dig +short orariapp.com.br MX          # 5 mx-vip-01.uni5.net. / 5 mx-vip-02.uni5.net.
dig +short orariapp.com.br TXT         # o SPF e o google-site-verification
dig +short send.orariapp.com.br CNAME  # send.forge.rmta.net.
dig +short resend._domainkey.orariapp.com.br TXT
dig +short _dmarc.orariapp.com.br TXT
```

- `@1.1.1.1` ou `@8.8.8.8` depois do `dig` consulta um servidor DNS específico
  (útil para ver se a mudança já chegou).
- **Sinal de nuvem laranja por engano:** o nome devolve IPs do Cloudflare
  (`104.21…`, `172.67…`, `2606:4700:…`) em vez do IP da VPS ou do CNAME esperado.
- Sem o `dig`: o site [dnschecker.org](https://dnschecker.org) mostra a resposta
  em vários países.

## Adicionar ou mudar um registro

1. Cloudflare → DNS → **Add record** (ou **Edit** no existente).
2. Tipo, nome (só o começo: `app`, não `app.orariapp.com.br`), conteúdo.
3. **Proxy status: DNS only** (cinza).
4. Salvar e conferir com `dig` depois de alguns minutos.

**Antes de criar qualquer registro que alguém pedir**, confira se o **nome** já
existe. Um CNAME não pode dividir o nome com nenhum outro registro, e dois
registros A/CNAME no mesmo nome mudam para onde o tráfego vai.

## Para outros projetos

- **Modelo mínimo:** `A @`, `CNAME www`, um `A` por subdomínio de serviço (`app`,
  `api`), tudo cinza se houver um Caddy/Nginx com HTTPS no servidor.
- **E-mail:** os registros vêm do provedor (Resend, Google Workspace, Zoho…). Só
  podem conflitar no `@` (MX e SPF): um provedor de **caixa** por domínio, e um
  único SPF no `@` juntando os `include:` se houver mais de um que envie pelo `@`.
- **Documente o porquê** de cada registro (como aqui). Daqui a um ano, ninguém
  lembra para que servia um TXT solto.
