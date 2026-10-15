O frontend (Next.js) está montando a tela de Agendamentos (agenda do dia, somente leitura). Preciso de 1 mudança na API. Siga o CLAUDE.md (plano, aprovação, código) e não faça nada fora do escopo.

**Dados relacionados nas respostas de agendamento.** Hoje `GET /appointments` e `GET /appointments/:id` devolvem só `clientId`, `professionalId` e `serviceId`. A agenda precisa dos nomes e da cor para desenhar cada bloco, e montar isso com várias chamadas por dia é caro.

- Incluir, em cada agendamento das duas rotas, os objetos:
  - `client`: `id`, `name`, `photoUrl`
  - `professional`: `id`, `name`, `photoUrl`
  - `service`: `id`, `name`, `color`, `duration`
- Só esses campos (nada de documento, contatos, etc.). Os ids planos continuam na resposta, sem quebrar quem já consome.
- Pessoa excluída (inativa) ou serviço excluído que ainda está ligado a um agendamento antigo deve continuar aparecendo com o nome (o histórico não pode ficar sem nome). Me diga como tratou isso.
- Garanta que a listagem aceite a janela de um dia (`from` e `to` já existem) e devolva ordenada por `startAt` crescente. Se o limite de 100 por página puder ser insuficiente para um dia cheio, me avise e sugira o tratamento.
- As respostas de criação e alteração (`POST` e `PATCH`) devem ter o mesmo formato.

Testes (vitest), `docs/business-rules.md` ou `domain.md` (se couber) e Swagger atualizados. Sem push.

**Ao final, devolva:** rotas, JSON de exemplo, e as decisões que tomou onde deixei aberto.
