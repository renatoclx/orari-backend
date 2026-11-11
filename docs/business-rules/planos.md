# Regras de negócio: Planos

> Parte de [`business-rules/`](README.md). Catálogo de planos (pacotes) e contratações.

## Planos

### Catálogo de planos

- Um plano pertence à empresa do usuário que o cadastrou; a empresa não é informada no payload.
- O nome do plano é único entre os planos da mesma empresa.
- Um plano é o pacote de serviços; os períodos (ex.: 3, 6 ou 12 meses) são opções de contratação do mesmo plano.
- Um plano é composto por um ou mais serviços da própria empresa, ativos no momento do cadastro ou da edição.
- Um serviço não pode aparecer mais de uma vez no mesmo plano.
- Cada serviço do plano define `sessionsPerWeek`, a quantidade de atendimentos por semana (inteiro de 1 a 7, obrigatório). O cadastro e a edição recebem `services: [{ serviceId, sessionsPerWeek }]`.
- Os serviços e os períodos de um plano podem ser editados; a lista informada substitui a anterior. Contratações já feitas não mudam.
- O valor mensal do plano (`monthlyPrice`) é definido pela empresa no cadastro e não depende dos preços dos serviços.
- Não há exclusão: o plano é desativado por `isActive` e pode ser reativado.
- Planos inativos não podem ser contratados.
- Um plano pode ser cadastrado sem períodos, mas só pode ser contratado se tiver ao menos um.
- Um plano com algum serviço inativo não pode ser contratado.

### Descontos por período

- Cada plano define, por período (ex.: 3, 6 ou 12 meses), dois percentuais fixos de desconto, ambos obrigatórios:
  - `discountPercent`: para pagamento integral (uma única cobrança do total do período);
  - `monthlyDiscountPercent`: para pagamento mensal.
- O número de meses é inteiro, a partir de 1, e não se repete no mesmo plano.
- Os percentuais vão de 0 a 100, com até duas casas decimais.
- No pagamento integral, o total do período é o valor mensal × número de meses, com `discountPercent` aplicado.
- No pagamento mensal, cada parcela é o valor mensal com `monthlyDiscountPercent` aplicado, e o total é a parcela × número de meses.
- Os valores são arredondados para duas casas decimais, com a metade arredondada para cima. No mensal, a parcela é arredondada antes de calcular o total, para que a soma das parcelas feche com o total.
- Alterar os percentuais de um plano não altera contratações já feitas.

### Serviços e horários

- Cada serviço do plano tem seus próprios dias, horários e profissional, informados na contratação. A contratação informa exatamente os serviços do plano, nem mais nem menos.
- A agenda de cada serviço precisa ter exatamente `sessionsPerWeek` horários por semana (cada item de `days` é um atendimento semanal; o mesmo dia pode ter dois horários que não se sobrepõem). Quantidade diferente é recusada (400), com a mensagem indicando o serviço e a quantidade prevista.
- A frequência vale só no momento da contratação: as recorrências guardam os dias, então alterar o plano depois não muda contratações já feitas.
- Cada serviço gera uma recorrência própria, com o período da contratação. Seus agendamentos seguem todas as regras de agendamentos recorrentes.
- Os agendamentos de um plano podem ser remanejados dentro do período da contratação, e um agendamento pode ser cancelado individualmente; a sessão cancelada não é reposta.
- Reposição por falta: quando o cliente não comparece a uma sessão do plano e a empresa a marca como `NO_SHOW`, a sessão pode ser remanejada para uma nova data dentro do período da contratação, desde que haja horário disponível (funcionamento da empresa, sem conflito). Ela volta a `SCHEDULED` e a quantidade de sessões do plano se mantém; o registro da falta deixa de existir, porque é a mesma sessão que muda de data. Só sessões `NO_SHOW` entram: concluídas e em andamento continuam não podendo ser remanejadas. A regra vale só para pacotes; recorrências avulsas seguem remanejando apenas antes de iniciar.
- A recorrência de um serviço do plano não é encerrada isoladamente: o encerramento acontece pelo cancelamento da contratação.

### Contratação

- Só podem ser contratados planos ativos, com o período escolhido cadastrado e com todos os serviços ativos. O cliente precisa ser do tipo `CLIENT`.
- Ao contratar um plano, são definidos a modalidade de pagamento (integral ou mensal) e o número de meses, que precisa corresponder a um período do plano. São congelados o valor mensal, o percentual de desconto aplicado conforme a modalidade e o total do período.
- A data de início é, por padrão, a data atual no fuso da empresa. Pode ser futura, mas não passada. A agenda nunca começa antes dela, inclusive à noite, quando em UTC já é o dia seguinte.
- A data final é a data de início somada ao número de meses, menos um dia (ex.: 3 meses a partir de 15/10 terminam em 14/01).
- A contratação, as recorrências dos serviços e os pagamentos são criados juntos: se qualquer horário conflitar, nada é gravado.
- Alterar preços de serviços ou o plano depois da contratação não altera o valor da contratação.
- Ao fim do período contratado, a continuidade exige uma nova contratação, como nas recorrências.

### Consulta das contratações

- As respostas de contratação (listagem, consulta, criação e cancelamento) trazem o cliente (`id`, `name`, `photoUrl`), o plano (`id`, `name`) e, em cada recorrência, o serviço, o profissional, os dias (`weekDay`, `startTime`, `endTime` em HH:MM), `isActive` e `classGroupId` (a turma em que o serviço está encaixado, ou `null`). Os ids continuam planos. Cliente, plano, serviço ou profissional excluídos ou inativados depois continuam aparecendo com o nome.
- A listagem aceita o filtro opcional `status`, com "hoje" no fuso da empresa: `active` (não cancelada e com data final de hoje em diante, inclusive as que ainda vão começar), `cancelled` (com data de cancelamento) e `ended` (não cancelada e com data final anterior a hoje). Sem o filtro, todas são listadas.
- A listagem vem da contratação mais recente para a mais antiga (data de criação decrescente).

### Troca de serviços

- O plano fecha o contrato com os serviços contratados: não há troca de serviço durante a contratação.

### Pagamento da contratação

- A contratação tem uma modalidade: **integral** ou **mensal**.
- Na modalidade integral, é gerado um único pagamento com o valor total do período. O sistema registra apenas esse valor total, sem o número de parcelas nem os juros do cartão. O meio de pagamento (ex.: cartão) é um método de pagamento da empresa.
- Na modalidade mensal, é gerado um pagamento por mês contratado, cada um com o valor da parcela.
- Os pagamentos de uma contratação pertencem à contratação, não a um agendamento.
- O vencimento é definido na contratação por uma data de primeiro vencimento, obrigatória no mensal e opcional no integral. No integral, é o vencimento do pagamento único; no mensal, é o da primeira parcela, e as seguintes vencem no mesmo dia dos meses seguintes. Quando o dia não existe no mês, vale o último dia do mês. No integral sem essa data, o pagamento fica sem vencimento.
- Os pagamentos da contratação nascem `PENDING` e sem método de pagamento; a baixa para `PAID` é manual.
- Um pagamento pendente cujo vencimento é anterior à data atual, no fuso da empresa, consta como **atrasado**. O status do pagamento continua `PENDING` até ser pago.

### Cancelamento da contratação

- O cancelamento não gera multa nem reembolso, em qualquer modalidade.
- A contratação cancelada registra a data do cancelamento e não pode ser cancelada de novo (também quando dois cancelamentos chegam ao mesmo tempo: só o primeiro vale). Uma contratação cujo período já terminou não pode ser cancelada.
- Ao cancelar a contratação, as recorrências de todos os serviços do plano são encerradas, e os agendamentos futuros em `SCHEDULED` ou `CONFIRMED` passam para `CANCELLED`; os horários voltam a ficar disponíveis.
- Na modalidade mensal, as parcelas `PENDING` com vencimento na data do cancelamento ou depois passam para `CANCELLED`. As parcelas atrasadas continuam `PENDING`, e as pagas não mudam.
- Na modalidade integral, o pagamento não muda: ele é feito no ato da contratação.
