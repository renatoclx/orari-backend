Contexto: o frontend do Orari já usa todas as rotas de turma (etapas 1 a 5 de
backend/docs/turmas.md). Faltam duas coisas no backend. Siga o fluxo do
CLAUDE.md: analise, proponha o plano e aguarde aprovação. Ao final, registre as
regras em turmas.md e business-rules.md ("Turmas").

1. Encaixe de vários alunos de uma vez, tudo ou nada
   - POST /class-sessions/:id/participants e POST /class-groups/:id/participants
     passam a aceitar `clientIds: string[]` (1 ou mais, sem repetidos), com o
     `note` opcional valendo para todos. Avalie se mantém `clientId` por
     compatibilidade (o frontend se adapta).
   - Tudo numa transação, com a trava da sessão: as vagas são conferidas para a
     lista inteira. Se faltar vaga, ou se qualquer cliente for recusado (já está
     na sessão, conflito de horário do cliente, cliente inativo etc.), nada é
     gravado.
   - Na recusa, a resposta diz qual cliente falhou e por quê, para o frontend
     mostrar o motivo ao lado de cada nome. Proponha o formato do erro (ex.:
     409 com `errors: [{ clientId, message }]`). Na falta de vaga, informe as
     vagas livres e quantos foram pedidos.
   - Na turma fixa, a sessão do dia continua nascendo no primeiro encaixe,
     dentro da mesma transação.
   - O retorno pode passar a ser a sessão atualizada (formato de
     GET /class-sessions/:id), em vez do agendamento criado. Hoje o frontend
     busca a sessão depois de cada encaixe.

2. Alunos fixos da turma
   - GET /class-groups/:id passa a trazer `members`: clientes com recorrência ou
     plano ativo encaixado na turma e sem saída (classLeftAt vazio). Cada item
     traz o cliente (id, name, photoUrl), a origem (recorrência ou plano, com o
     id e o nome do plano) e os dias da turma em que ele está.
   - Se fizer mais sentido, proponha uma rota própria
     (GET /class-groups/:id/members) em vez de engordar o findOne.
   - Uso no frontend: a Visualização da turma mostra os alunos fixos acima das
     próximas sessões.
