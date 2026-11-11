# Regras de negócio: Recorrências

> Parte de [`business-rules/`](README.md). Agendamentos recorrentes, remanejamento e cancelamento.

## Agendamentos recorrentes

- Valem as mesmas regras de empresa, tipos de pessoa e serviço ativo dos agendamentos.
- A recorrência precisa de ao menos um dia; cada dia tem dia da semana, horário inicial e final, e o fim deve ser posterior ao início.
- Dois dias da mesma recorrência não podem se sobrepor no mesmo dia da semana.
- A data final é obrigatória e não pode ser anterior à inicial.
- Não há limite de duração entre a data inicial e a final (ex.: uma recorrência de um ano); o prazo é definido por quem cria a recorrência. A data final não pode ser anterior à inicial.
- Todos os agendamentos e pagamentos do período são gerados na criação: uma recorrência longa gera muitos registros de uma vez.
- Informar a lista de dias em uma edição substitui todos os dias anteriores.
- Não há exclusão: a recorrência é desativada por `isActive`.
- Cada dia precisa reservar ao menos a duração do serviço, que é o que define o fim dos agendamentos gerados.

### Geração de agendamentos

- Ao criar uma recorrência ativa, os agendamentos são gerados até a data final. Ocorrências no passado não são geradas.
- Os agendamentos gerados seguem todas as regras de um agendamento avulso: janela de atendimento e ausência de conflito para cliente e profissional.
- A criação é tudo ou nada: se qualquer ocorrência conflitar, a recorrência não é criada.
- O erro informa a data e o horário, no fuso da empresa, da ocorrência que impediu a criação (a primeira encontrada), seja conflito de agenda do profissional ou do cliente, seja horário fora do funcionamento. Ex.: "Conflito em 28/10/2026 às 09:00: O profissional já possui um agendamento neste horário". Vale também na contratação de plano, que cria as agendas da mesma forma.
- Toda resposta de recorrência (listagem, consulta, criação e edição) traz, além dos códigos, o cliente e o profissional (`id`, `name`, `photoUrl`), o serviço (`id`, `name`, `color`, `duration`), o `clientPlanId` (preenchido quando a recorrência é de um pacote) e o `classGroupId` (preenchido quando ela está encaixada numa turma). Pessoa ou serviço excluídos depois continuam aparecendo com o nome.
- A agenda de uma recorrência não é regenerada. Para mudar dias, período, serviço, cliente ou profissional, encerra-se a recorrência e cria-se outra.
- Alterar apenas a observação não mexe na agenda.
- Cancelar a recorrência (`isActive` = falso) cancela os agendamentos futuros em `SCHEDULED` ou `CONFIRMED`, sem gerar novos, e seus pagamentos `PENDING` passam para `CANCELLED` (ver Cancelamento). Uma recorrência cancelada não é reativada.

### Valor e pagamento

- O valor de cada agendamento é o preço vigente do serviço no momento da criação da recorrência. Não há descontos.
- Um serviço sem preço não pode ser usado em uma recorrência.
- A recorrência não é fidelização nem pacote.
- Cada agendamento gerado tem um pagamento `PENDING`, com vencimento na data do agendamento.
- O cliente pode optar por pagar integralmente a recorrência, somente na contratação e sem desconto. Os pagamentos continuam nascendo `PENDING`; a baixa para `PAID` é feita pagamento a pagamento ou de uma vez, em lote, com o mesmo método de pagamento.

### Remanejamento

- O cliente pode remanejar agendamentos da recorrência para outros dias e horários. Remanejar é remarcar o mesmo agendamento, que mantém seu pagamento.
- Remanejar só é permitido desde que:
  - a quantidade de serviços contratados seja mantida;
  - a nova data, no calendário da empresa, fique entre a data inicial e a final da recorrência;
  - haja dia e horário disponíveis, pelas regras de agendamento.
- Só agendamentos `SCHEDULED` ou `CONFIRMED` que ainda não iniciaram (início no futuro) podem ser remanejados, e o status não muda. Vale o horário, e não só o status, porque o status é atualizado periodicamente. Uma recorrência cancelada não tem agendamentos remanejados.
- Data, serviço, cliente e profissional de um agendamento de recorrência não mudam pela edição comum do agendamento; data e horário mudam só pelo remanejamento. Observação e os demais status continuam editáveis.
- Se o pagamento do agendamento estiver `PENDING`, o vencimento passa para a nova data.
- Remanejar não gera nova cobrança nem reembolso.
- Remanejar (inclusive a reposição de uma falta de pacote) uma sessão de turma **tira o aluno da sessão**: o agendamento vai para o novo horário como atendimento individual e a vaga fica livre (ver "Turmas").

### Cancelamento

- Um único agendamento da recorrência pode ser cancelado pela própria recorrência, com a mesma regra do agendamento avulso: só antes de iniciar (`SCHEDULED` ou `CONFIRMED` com início no futuro). O horário fica livre e o pagamento `PENDING` dele passa para `CANCELLED`. Pagamento já pago não muda. Esse cancelamento não é feito pela edição comum do agendamento.
- Cancelar a recorrência não gera reembolso de pagamentos já pagos.
- Os pagamentos `PENDING` dos agendamentos futuros cancelados passam para `CANCELLED`.
- Após o cancelamento, as novas datas negociadas diretamente com a empresa passam a ser agendamentos avulsos.
