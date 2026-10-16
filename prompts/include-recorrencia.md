O frontend (Next.js) está montando as telas de Recorrências. Preciso de 4 mudanças na API, todas de leitura ou mensagem, sem mudar nenhuma regra de negócio. Siga o CLAUDE.md (plano, aprovação, código, testes) e não faça nada fora do escopo.

**1. Dados relacionados nas respostas de recorrência.** Hoje `GET /recurring-appointments`, `GET /recurring-appointments/:id`, `POST` e `PATCH` devolvem só ids (clientId, professionalId, serviceId) e os dias. Incluir, como já foi feito nos agendamentos (commit 7cae73d): `client` e `professional` (`id`, `name`, `photoUrl`) e `service` (`id`, `name`, `color`, `duration`), mantendo os ids planos. Pessoa ou serviço excluídos continuam com o nome. Incluir também `clientPlanId` (já existe na recorrência) para o frontend saber se ela é de um pacote.

**2. Origem do agendamento.** Na resposta de agendamento (listagem, consulta, criação e alteração) já vem `recurringAppointmentId`. Acrescentar a informação de que a recorrência é de um pacote (por exemplo `clientPlanId` no agendamento, ou um objeto `recurringAppointment: { id, clientPlanId }`). Escolha a forma mais simples e me diga.

**3. Sessões de uma recorrência.** Permitir listar os agendamentos de uma recorrência: filtro `recurringAppointmentId` em `GET /appointments` (aproveitando a ordenação, a paginação e os dados relacionados que já existem). Sem filtro, nada muda.

**4. Conflito na criação.** A criação da recorrência é tudo ou nada. Quando uma ocorrência conflita (profissional, cliente, janela de atendimento ou outra regra), a mensagem do erro deve informar **qual data e horário** (no fuso da empresa) causaram o problema, por exemplo "Conflito em 28/10/2026 às 09:00: O profissional já possui um agendamento neste horário". Mantenha os códigos de status atuais.

**Opcional (me diga se acha viável e o custo):** uma forma de simular a criação sem gravar (dry-run), que devolva as datas que seriam geradas e as ocorrências que conflitariam, para o frontend mostrar o resultado antes de confirmar.

Testes (vitest), `docs/business-rules.md` e Swagger atualizados. Sem push.

**Ao final, devolva:** rotas, JSON de exemplo, as decisões que tomou onde deixei aberto e o custo do dry-run.
