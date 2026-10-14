O frontend (Next.js) está montando a tela de Serviços. Preciso de 1 mudança na API. Siga o CLAUDE.md (plano, aprovação, código) e não faça nada fora do escopo.

**Exclusão só sem relacionamentos.** Hoje `DELETE /services/:id` faz exclusão lógica (`deletedAt`) sempre, mesmo com o serviço usado em agendamentos, agendamentos recorrentes ou itens de plano. A regra de negócio é: o serviço só pode ser excluído se não tiver nenhum relacionamento.

- Antes de excluir, verificar se existe qualquer `Appointment`, `RecurringAppointment` ou `PlanItem` com o `serviceId`. Considere todos, inclusive cancelados ou encerrados (o histórico precisa continuar apontando para o serviço).
- Se existir: 409 (`ConflictException`) com mensagem em pt-BR que oriente a inativar, por exemplo "O serviço possui agendamentos, recorrências ou planos vinculados. Inative-o em vez de excluir." Nada é alterado.
- Sem relacionamentos: mantém o comportamento atual (204, exclusão lógica). Serviço inexistente ou de outra empresa continua 404.
- Inativar continua sendo `PATCH /services/:id` com `isActive: false`. Nada muda aí.
- Se algum planItem de plano já excluído conta como relacionamento, me avise e sugira o tratamento.

Testes (vitest), `docs/business-rules.md` (seção Serviços) e Swagger atualizados. Sem push.

**Ao final, devolva:** rota, status e mensagens de erro, e as decisões que tomou onde deixei aberto.
