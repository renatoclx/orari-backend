O frontend vai montar as telas de Contratações (listagem, nova contratação e
detalhes). Preciso de 2 mudanças de leitura na API, sem mudar nenhuma regra de
negócio. Siga o CLAUDE.md (plano, aprovação, código, testes) e não faça nada fora
do escopo.

**1. Dados relacionados nas respostas de contratação.**
Hoje `GET /client-plans`, `GET /client-plans/:id`, `POST /client-plans` e
`PATCH /client-plans/:id/cancel` devolvem só ids, e cada item de
`recurringAppointments` traz apenas `id`, `serviceId` e `professionalId`.
Incluir, como já foi feito em agendamentos e recorrências:

- `client`: `id`, `name`, `photoUrl`;
- `plan`: `id`, `name`;
- em cada item de `recurringAppointments`: `service` (`id`, `name`, `color`,
  `duration`), `professional` (`id`, `name`, `photoUrl`), `days` (`weekDay`,
  `startTime`, `endTime`) e `isActive`.
  Mantenha os ids planos. Pessoa, plano ou serviço excluídos/inativados depois
  continuam aparecendo com o nome.

**2. Filtro de status e ordem na listagem.**
Em `GET /client-plans`, acrescentar o filtro opcional `status`:

- `active`: não cancelada e com `endDate` a partir de hoje (inclui as que ainda
  vão começar);
- `cancelled`: com `cancelledAt`;
- `ended`: não cancelada e com `endDate` antes de hoje.
  "Hoje" no fuso da empresa. Sem o filtro, nada muda. Ordenar da contratação mais
  recente para a mais antiga (`createdAt` decrescente), se ainda não for assim.

Testes (vitest), Swagger (DTOs de resposta, como em recorrências) e
`docs/business-rules.md` atualizados. Sem push.

**Ao final, devolva:** rotas, JSON de exemplo (listagem e consulta), as decisões
que tomou onde deixei aberto e a ordem da listagem.
