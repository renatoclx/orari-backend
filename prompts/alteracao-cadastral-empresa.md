O frontend vai ter uma área "Configurações da empresa", usada pelo administrador
da própria empresa (ADMIN). Preciso de 2 mudanças na API. Siga o CLAUDE.md
(plano, aprovação, código, testes) e não faça nada fora do escopo.

**1. O administrador altera a própria empresa (só o nome fantasia).**
Hoje `PATCH /companies/:id` é só de SUPER_ADMIN e aceita todos os campos.
Criar uma rota para a empresa do usuário logado (sugestão: `PATCH /companies/me`)
que aceite apenas `fantasyName`. Regras:

- Disponível para ADMIN e SUPER_ADMIN; o id da empresa vem do token, não da URL.
- Razão social, CNPJ, data de fundação, subdomínio, fuso e status continuam só
  no `PATCH /companies/:id` do SUPER_ADMIN (sem mudança).
- `fantasyName` vazio ou `null` remove o nome fantasia (o `/auth/me` já devolve a
  razão social nesse caso).
- Também quero ler a própria empresa com os dados cadastrais (razão social, CNPJ,
  data de fundação, subdomínio, fuso, logo): se `GET /companies/:id` já permite ao
  ADMIN ler a própria, basta confirmar; senão, `GET /companies/me`.

**2. Envio da logo da empresa.**
No mesmo padrão da foto de pessoa (`POST /people/:id/photo` e `DELETE /people/:id/photo`):

- `POST /companies/me/logo` (multipart, campo `logo`) e `DELETE /companies/me/logo`.
- JPEG ou PNG, até 2 MB; servida publicamente em `/uploads/companies/<arquivo>`;
  `logoUrl` guarda o caminho relativo (como a foto de pessoa). Ao trocar ou remover,
  o arquivo anterior é apagado.
- Mesmos perfis da rota 1.
- O `/auth/me` já devolve `company.logoUrl`; ele deve refletir a logo nova.

Observação: a seed tem `logoUrl: "https://example.com/logo.png"`, que não é uma
imagem real. Trocar por `null` na seed.

Os horários de funcionamento (`/business-hours`, inclusive `batch`) já atendem o
frontend; não mexer.

Testes (vitest), Swagger (com os campos multipart) e `docs/business-rules.md`
atualizados. Sem push.

**Ao final, devolva:** rotas, JSON de exemplo (GET e PATCH da empresa), regras de
perfil e as decisões que tomou onde deixei aberto.
