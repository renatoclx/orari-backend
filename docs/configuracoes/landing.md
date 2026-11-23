# Landing (site institucional)

## O que é

O site de apresentação do Orari, em `https://orariapp.com.br`: o que o sistema
faz, os planos e os botões de teste grátis (que levam a
`https://app.orariapp.com.br/cadastro?plano=…`).

É um site **estático**: só arquivos HTML, CSS, JavaScript e imagens, sem servidor
de aplicação nem banco. Por isso é rápido, barato e quase impossível de "cair".

| O quê      | Onde                                                                          |
| ---------- | ----------------------------------------------------------------------------- |
| Código     | `orari/landing-page` no seu computador (não é repositório Git)                |
| Na VPS     | `/www/wwwroot/orariapp.com.br`                                                |
| Quem serve | O Caddy (bloco `SITE_DOMAIN`, ver [caddy-e-dominios.md](caddy-e-dominios.md)) |
| HTTPS      | Automático, pelo Caddy                                                        |

## Por que o CSS é "compilado"

A landing usa o **Tailwind CSS** (classes como `text-blue-600` no HTML). No começo
o Tailwind rodava **no navegador do visitante** (um script de CDN), que lia o HTML
e gerava o CSS na hora. Funciona, mas:

- cada visitante baixa e executa o gerador (página mais lenta);
- o próprio Tailwind avisa que o modo CDN não é para produção.

Agora o CSS é gerado **antes**, no seu computador, num arquivo pronto
(`assets/site.css`, minificado, só com as classes usadas). O resultado visual é o
mesmo (conferido pixel a pixel).

## Gerar o CSS

Sempre que mudar classes no `index.html`, no `cookies.html` ou o tema em
`tools/tailwind/site.css`:

```bash
cd orari/landing-page/tools/tailwind
npm install        # só na primeira vez
npm run build      # gera ../../assets/site.css
npm run watch      # ou: gera de novo a cada mudança, enquanto você edita
```

**Classe nova que não aparece no site?** O CSS não foi gerado de novo (ou o
`assets/site.css` novo não foi enviado para a VPS).

O arquivo `tools/tailwind/site.css` diz **onde procurar classes**:

```css
@import "tailwindcss" source(none);
@source "../../index.html";
@source "../../cookies.html";
/* … tema: cores, fontes … */
```

Página nova? Acrescente um `@source` para ela.

## Ver no computador

```bash
cd orari/landing-page
python3 -m http.server 8080      # abra http://localhost:8080
```

## Publicar

Envie para `/www/wwwroot/orariapp.com.br` (pelo gerenciador de arquivos do aaPanel
ou por `scp`/`rsync`):

```
index.html  cookies.html  robots.txt  sitemap.xml  assets/
```

**Não envie:** `README.md`, `tools/` e `em-breve/`.

Por `rsync`, do seu computador (envia só o que mudou):

```bash
cd orari/landing-page
rsync -av --delete \
  --exclude README.md --exclude tools --exclude em-breve \
  ./ root@IP_DO_SERVIDOR:/www/wwwroot/orariapp.com.br/
```

O `--delete` apaga na VPS o que não existe mais no computador. **Cuidado:** ele
também apagaria arquivos que só existem lá (ex.: os que o aaPanel cria, como o
`.user.ini`). Rode antes com `--dry-run` para ver o que faria.

**Não precisa reiniciar nada:** o Caddy lê os arquivos a cada pedido.

**Cache do navegador:** se a mudança não aparecer, recarregue com Ctrl+Shift+R.

## Conferir

```bash
curl -I https://orariapp.com.br                  # 200
curl -I https://www.orariapp.com.br              # 301 para https://orariapp.com.br/
curl -sI https://orariapp.com.br/assets/site.css | head -1   # 200
```

E no navegador: os botões de teste levam ao `/cadastro` com o plano certo, o
formulário de contato abre o WhatsApp.

## A página "em breve"

`landing-page/em-breve/index.html`: uma página provisória (logo + "Site novo em
breve" + botão para o sistema), num arquivo só, com o logo embutido. Serve para o
domínio não ficar em 404 enquanto a landing não está pronta. Ao publicar a landing,
o `index.html` dela substitui este.

## Problemas comuns

| Sintoma                              | Causa e solução                                                              |
| ------------------------------------ | ---------------------------------------------------------------------------- |
| 404 em branco no domínio             | Pasta vazia, ou apagada e recriada no aaPanel (`dcp restart caddy`)          |
| Layout quebrado / classes sem efeito | `assets/site.css` antigo: rode `npm run build` e envie de novo               |
| Mudança não aparece                  | Cache do navegador (Ctrl+Shift+R)                                            |
| "Sem SSL" num navegador              | Cache do navegador ou da rede; confira com `curl -I https://orariapp.com.br` |

## Para outros projetos

- Site institucional **estático**, separado do sistema: cai menos, é mais rápido e
  qualquer servidor web serve.
- **Gere o CSS antes** (Tailwind CLI) em vez de usar o modo CDN em produção.
- O mesmo Caddy do sistema pode servir o site (`root` + `file_server`), sem
  precisar de outro servidor ou painel.
