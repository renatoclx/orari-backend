# Caddy e os endereços do Orari

Conceitos (proxy reverso, HTTPS, portas) em [conceitos.md](conceitos.md#proxy-reverso).

## O que é o Caddy e por que ele

O **Caddy** é um servidor web que faz o papel de **proxy reverso**: recebe todo
pedido que chega à VPS e encaminha para o serviço certo. O diferencial dele é o
**HTTPS automático**: basta escrever o domínio no arquivo de configuração, e ele
pede o certificado ao Let's Encrypt, instala e renova sozinho, sem nenhum comando.

**Por que não o Nginx (o mais comum)?** O Nginx exige configurar o certificado à
parte (Certbot, renovação agendada) e um arquivo de configuração bem maior. Para um
projeto pequeno, o Caddy faz o mesmo em poucas linhas e com menos chance de erro.

## Os endereços

| Endereço                      | Variável          | Vai para                           | Para quê                           |
| ----------------------------- | ----------------- | ---------------------------------- | ---------------------------------- |
| `https://app.orariapp.com.br` | `APP_DOMAIN`      | `frontend:3000`                    | O sistema (telas)                  |
| `https://api.orariapp.com.br` | `API_DOMAIN`      | `api:3333`                         | A API (integrações, testes, saúde) |
| `https://orariapp.com.br`     | `SITE_DOMAIN`     | arquivos em `/srv/landing`         | O site institucional (landing)     |
| `https://www.orariapp.com.br` | `SITE_WWW_DOMAIN` | redireciona para `orariapp.com.br` | Quem digita com `www`              |

O navegador do usuário só fala com o `app.`. As chamadas à API saem do **servidor
do frontend**, pela rede interna do Docker. O `api.` continua existindo para
testes, integrações e para conferir se a API está no ar.

## O `Caddyfile`, explicado

```caddy
# Cada bloco começa com o endereço que ele atende. {$NOME:padrão} lê a variável
# de ambiente; sem ela, usa o padrão (uma porta interna, só para testes).

{$API_DOMAIN::80} {
	encode gzip                 # comprime as respostas (páginas mais leves)
	request_body {
		max_size 5MB            # fotos e logos têm até 2 MB; recusa o que passar de 5
	}
	reverse_proxy api:3333      # encaminha para a API, pela rede interna
}

{$APP_DOMAIN::81} {
	encode gzip
	request_body {
		max_size 5MB
	}
	reverse_proxy frontend:3000
}

{$SITE_DOMAIN::82} {
	encode gzip
	root * /srv/landing         # pasta com os arquivos da landing
	file_server {
		hide .*                 # não serve arquivos ocultos (.user.ini, .htaccess do aaPanel)
	}
}

{$SITE_WWW_DOMAIN::83} {
	redir https://{$SITE_DOMAIN}{uri} permanent   # www → sem www, mantendo o caminho
}
```

**Detalhes que importam:**

- **O `reverse_proxy` padrão preserva o `Host`** (o endereço que o navegador pediu)
  e sobrescreve o `X-Forwarded-For` com o **IP real** de quem conectou. O Next
  confere o `Host` nas Server Actions (sem isso: erro "Invalid Server Actions
  request"), e a API usa o IP para limitar tentativas de login. **Não mude esses
  cabeçalhos** sem saber o efeito.
- **HTTP vira HTTPS sozinho:** com um domínio no bloco, o Caddy redireciona
  `http://` para `https://`.
- **Os padrões `:80`, `:81`...** servem para o primeiro teste por IP, antes do
  domínio existir. As portas 81 a 83 não são publicadas, então, sem domínio, o
  frontend e a landing simplesmente não ficam expostos.

## Como o certificado é emitido

1. O Caddy sobe e vê `app.orariapp.com.br` no arquivo.
2. Pede um certificado ao Let's Encrypt.
3. O Let's Encrypt **confere que o domínio aponta para este servidor**: acessa o
   domínio pela porta 80 (ou 443) e espera achar o Caddy respondendo.
4. Deu certo: o certificado é gravado no volume `caddy_data` e renovado sozinho
   antes de vencer (vale 90 dias).

**Por isso, para o HTTPS funcionar:**

- O registro DNS precisa apontar **direto** para o IP da VPS (nuvem **cinza** no
  Cloudflare).
- As portas 80 e 443 precisam estar **livres** (nenhum outro programa, como o Nginx
  do aaPanel) e **abertas** no firewall (`ufw` e o do provedor).

## Conferir

```bash
dcp ps caddy                                  # Up
dcp logs --tail 50 caddy | grep -i certificate   # "certificate obtained successfully"
curl -I https://app.orariapp.com.br/login     # HTTP/2 200
curl -I https://orariapp.com.br               # HTTP/2 200
curl -I https://www.orariapp.com.br           # 301 → https://orariapp.com.br/
ss -ltnp | grep -E ':(80|443) '               # docker-proxy nas duas portas
```

E no navegador: o cadeado aparece nos quatro endereços.

## Mudar alguma coisa

| Quero                           | Como                                                                             |
| ------------------------------- | -------------------------------------------------------------------------------- |
| Trocar um domínio               | Muda a variável no `.env.production`, cria o registro no DNS, `dcp up -d caddy`  |
| Novo subdomínio para um serviço | Bloco novo no `Caddyfile` + variável + registro DNS, `dcp up -d caddy`           |
| Mudei só o `Caddyfile`          | `dcp exec caddy caddy reload --config /etc/caddy/Caddyfile` (sem queda)          |
| Testar o arquivo antes          | `dcp exec caddy caddy validate --config /etc/caddy/Caddyfile`                    |
| Atualizar a landing             | Só trocar os arquivos na pasta; não precisa reiniciar ([landing.md](landing.md)) |

## Problemas comuns

| Sintoma                                   | Causa e solução                                                                    |
| ----------------------------------------- | ---------------------------------------------------------------------------------- |
| Sem HTTPS / erro de certificado           | DNS não aponta para a VPS, nuvem laranja, ou portas 80/443 fechadas ou ocupadas    |
| **Erro 525** (página do Cloudflare)       | Nuvem laranja e o servidor sem certificado para o domínio: deixe a nuvem cinza     |
| O aaPanel não consegue emitir o SSL       | Normal: quem atende as portas é o Caddy. Não use o SSL do aaPanel                  |
| `orariapp.com.br` dá 404 em branco        | A pasta da landing está vazia, ou foi apagada e recriada (`dcp restart caddy`)     |
| "Invalid Server Actions request"          | O `Host` não chegou ao Next como o do navegador: volte o `reverse_proxy` ao padrão |
| Login dá 429 para todo mundo              | A API vê um IP só: confira a nuvem cinza e que o Caddy está na frente              |
| Muitas tentativas de certificado falhando | O Let's Encrypt limita tentativas por semana: corrija o DNS antes de insistir      |

## Para outros projetos

O modelo serve para qualquer projeto em Docker: um bloco por domínio,
`reverse_proxy nome-do-serviço:porta`, volume para `/data` (certificados) e só o
Caddy com as portas 80/443 publicadas. Para um site estático, `root` +
`file_server`. Para `www`, um `redir`. Use variáveis (`{$DOMINIO}`) para o mesmo
arquivo servir em teste e em produção.
