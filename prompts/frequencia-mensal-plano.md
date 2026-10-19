O frontend está montando o cadastro de planos e a contratação. Precisamos que o
plano defina a frequência de cada serviço (atendimentos por semana). Siga o
CLAUDE.md (plano, aprovação, código, testes) e não faça nada fora do escopo.

**1. Frequência semanal no item do plano.**

- `PlanItem` ganha `sessionsPerWeek` (inteiro, de 1 a 7, obrigatório).
- Migração: os itens já existentes recebem `sessionsPerWeek = 1`.
- `POST /plans` e `PATCH /plans/:id` passam a receber, no lugar de `serviceIds`:
  `services: [{ "serviceId": "<uuid>", "sessionsPerWeek": 2 }]`
  com as mesmas regras de hoje (ao menos um, sem repetir serviço, só serviços
  ativos; no PATCH a lista substitui a anterior). Remover `serviceIds`.
- A resposta do plano (listagem, consulta, criação e edição) devolve
  `sessionsPerWeek` em cada item de `services`:
  `{ "id", "name", "isActive", "sessionsPerWeek" }`.
- O valor mensal (`monthlyPrice`) continua definido pela empresa e não é
  calculado pela API (o frontend sugere: preço do serviço × vezes por semana × 4
  semanas, somado; serviço sem preço conta como zero).

**2. Contratação respeita a frequência.**

- Em `POST /client-plans`, a agenda de cada serviço (`schedules[].days`) precisa
  ter **exatamente** `sessionsPerWeek` dias. Quantidade diferente responde 400
  com mensagem clara, ex.: "Pilates: escolha 2 dias da semana (o plano prevê
  2 atendimentos por semana)".
- A frequência é congelada na contratação, como os valores: alterar o plano depois
  não muda contratações já feitas (as recorrências já guardam os dias, então
  basta não depender do plano depois de criadas).

Testes (vitest), Swagger e `docs/business-rules.md` (seção "Planos": catálogo,
serviços e horários, contratação) atualizados. Sem push.

**Ao final, devolva:** rotas, JSON de exemplo (criação e resposta do plano, e o
erro de quantidade de dias na contratação) e as decisões que tomou onde deixei
aberto.
