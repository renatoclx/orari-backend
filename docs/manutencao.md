# Manutenção do backend: o que fazer a cada mudança

Roteiro curto, na ordem. O detalhe do servidor está no `docs/deploy.md`.

## 1. No seu computador

1. Crie uma branch: `git switch -c feature/nome-da-mudanca`.
2. Faça a mudança e teste (`npm run test`).
3. Mudou o **banco** (`prisma/schema.prisma`)? Crie a migração com `npx prisma migrate dev --name o_que_mudou` e **commite o arquivo gerado** em `prisma/migrations/`. Sem a migração no repositório, o servidor não cria a tabela ou a coluna.
4. Rode as conferências:
   ```bash
   npm run lint
   npx tsc --noEmit -p tsconfig.json
   npm run test
   ```
5. Faça o commit, envie a branch e abra o PR no GitHub:
   ```bash
   git push -u origin feature/nome-da-mudanca
   ```
   O CI (aba **Actions**) roda sozinho no PR. Só faça o merge com ele **verde**.
6. Faça o merge do PR na `main`.

> Não faça o merge direto na `main` pela linha de comando: o PR é o que passa pelo CI antes.

## 2. O frontend precisa mudar junto?

Se o frontend depende da mudança (rota nova, campo novo), o **backend sobe primeiro**; depois o frontend (veja o arquivo de manutenção dele). Se for uma correção que não muda o que a API devolve, o frontend nem precisa de deploy.

## 3. No servidor

Entre por SSH e rode **nesta ordem**:

```bash
cd ~/orari-backend
git pull
git log --oneline -1          # confira: é o último commit que você fez?

orari-backup                  # BACKUP antes de subir (banco e fotos)
ls -lh ~/backups              # confira que o arquivo novo apareceu

dcp build api                 # constrói a API
dcp up -d                     # sobe; as migrações novas rodam sozinhas
dcp ps                        # api "healthy" e os outros serviços de pé
dcp logs --tail 100 api       # sem erro de "Configuração inválida" nem de migração
```

- **O backup vem antes, sempre.** As migrações não são desfeitas: o backup é a sua volta.
- Mudou uma variável no `.env.production`? Aplique com `dcp up -d --force-recreate api`. Não cole o conteúdo desse arquivo em lugar nenhum: tem segredos.
- Construa **um serviço de cada vez**: o servidor tem pouca memória (`dcp build api`, depois `dcp build frontend`, se os dois mudaram).

## 4. Conferir

1. `https://api.orariapp.com.br/` responde "Hello World!".
2. Entre no site (`https://app.orariapp.com.br`) e use a parte que mudou.
3. O Swagger continua desligado: `https://api.orariapp.com.br/docs` deve dar **404**.

## 5. Se deu errado

- **A API não sobe:** `dcp logs --tail 100 api`. A mensagem diz a variável errada ou a migração que falhou. Me mande o trecho.
- **Voltar o código:**
  ```bash
  cd ~/orari-backend
  git log --oneline -5          # o commit anterior que funcionava
  git checkout <esse commit>
  dcp build api && dcp up -d
  ```
  As migrações **não** voltam sozinhas. Se a versão nova trocou o banco, restaure o backup (etapa 9 do `docs/deploy.md`) em vez de só voltar o código.
- Depois, corrija no seu computador e suba de novo pelo fluxo normal. (De volta ao normal: `git checkout main && git pull`.)

## Quadro rápido

| O que quero                | Comando                   |
| -------------------------- | ------------------------- |
| Ver se está tudo no ar     | `dcp ps`                  |
| Ver os logs da API         | `dcp logs --tail 100 api` |
| Reiniciar a API            | `dcp restart api`         |
| Fazer um backup agora      | `orari-backup`            |
| **Nunca** (apaga os dados) | `dcp down -v`             |
