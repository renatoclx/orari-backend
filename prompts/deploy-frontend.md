# Publicar o frontend em produção (Docker, mesmo servidor do backend)

O backend já está em produção em https://api.orariapp.com.br (VPS próprio, Docker Compose com db, api e Caddy). O objetivo agora é publicar este frontend em https://app.orariapp.com.br, no mesmo servidor, containerizado. Siga o CLAUDE.md do projeto (analisar, explicar o plano, aguardar aprovação, só então alterar) e não faça push nem commit sem eu pedir.

## Contexto do backend (já decidido)

- A API sobe na rede interna do Docker como `api:3333`. Dentro do Compose, a `API_URL` do frontend será `http://api:3333`.
- O Caddy (no repositório do backend) recebe o tráfego de fora, cuida do HTTPS e vai repassar `app.orariapp.com.br` para o contêiner do frontend na porta 3000. Isso e o serviço `frontend` no Compose do backend serão feitos em outra sessão: aqui é só o lado do frontend.
- O Compose do backend vai construir a imagem a partir de `../orari-frontend` (pasta do repositório clonado no servidor, ao lado de `orari-backend`). Por isso o `Dockerfile` precisa ficar na **raiz** deste repositório.
- A API de produção limita tentativas por IP: login 5 por minuto e renovação 20 por minuto. O backend usa `TRUST_PROXY=1`.
- O token de acesso dura 15 minutos em produção; o `proxy.ts` já renova pelo refresh token.

## Tarefas neste repositório (uma branch nova, por exemplo `chore/deploy-docker`)

1. **Dockerfile e `.dockerignore`** (imagem para produção):
   - Em etapas (instalar, construir, executar). O build precisa das dependências de desenvolvimento (TypeScript, Tailwind), então instale tudo antes de construir e só então defina `NODE_ENV=production`.
   - **A `API_URL` precisa existir no build e na execução:** o `next.config.ts` a lê para reescrever `/uploads`, e esse valor é gravado no build. Use `ARG API_URL` + `ENV API_URL`, e confirme na prática que a reescrita funciona.
   - Rodar como usuário não root, porta 3000, `HOSTNAME=0.0.0.0`, e um healthcheck que aceite 200 em uma rota pública (por exemplo `/login`).
   - Sem segredos na imagem. **`AUTH_GUARD=off` nunca pode existir em produção** (libera as rotas sem login).
   - Recomendo `output: "standalone"` no `next.config.ts` (imagem menor). Decida e me explique no plano, incluindo copiar `public/` e `.next/static`, e se o `sharp` é necessário.
   - `.dockerignore`: `node_modules`, `.next`, `.git`, `coverage`, `.env*` (menos o `.env.example`), `docs`, `.claude` e o que mais não deva entrar.

2. **Repassar o IP real do usuário à API no login e na renovação.** Hoje a API recebe todas as chamadas do servidor do Next, então enxerga um único IP e o limite de tentativas vale para **todos os usuários juntos** (5 logins por minuto no total). Não há nenhum `x-forwarded-for` no código hoje.
   - No login (Server Action) e na renovação (`proxy.ts`), envie à API o cabeçalho `X-Forwarded-For` com o IP do usuário, lido do cabeçalho `x-forwarded-for` da requisição que chegou ao Next (o Caddy o preenche). Use só o primeiro valor, e não envie nada se ele não existir.
   - Mantenha a regra de arquitetura do projeto: as chamadas continuam passando pelos services/`apiFetch` (o `proxy.ts` é a única exceção, por não poder importar `server-only`).
   - Escreva testes (vitest) para isso.

3. **Documentação do frontend:** `frontend-architecture.md` (deploy, Docker, variáveis de ambiente), `frontend-auth.md` (repasse do IP) e `frontend-technical-debt.md` (a `API_URL` é lida no build para `/uploads`; outras limitações que encontrar).

## Como verificar (de verdade, antes de entregar)

- Rodar os testes dos arquivos alterados, o `typecheck` e o `lint`; informar o que foi executado.
- Construir a imagem com `docker build --build-arg API_URL=http://api:3333 .`, subir o contêiner e conferir: `/login` responde 200, o healthcheck fica saudável, o contêiner roda sem ser root e a imagem não contém `.env*`.
- Provar o repasse do IP com um teste que simule a requisição com `x-forwarded-for` e confirme o cabeçalho enviado à API.
- Medir o tamanho da imagem e o tempo/memória do build (o servidor tem 3,8 GB de RAM e 1 GB de troca).

## Ao final, devolva

Os arquivos criados e alterados, o resumo, os impactos, os comandos que o Compose do backend precisa saber (variáveis de ambiente, porta, healthcheck, argumento de build) e os próximos passos.
