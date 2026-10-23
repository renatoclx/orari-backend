# Diário de decisões

Registro cronológico das decisões do projeto e do **motivo** de cada uma, para
não ser preciso reconstruí-las depois. O estado atual está em
[`progress.md`](progress.md); as regras vigentes, em
[`business-rules.md`](business-rules.md).

## 2026-09 · Base do projeto

- **Projeto multiempresa desde o início.** Toda consulta filtra por `companyId`,
  e registro de outra empresa responde 404, como se não existisse. Motivo: não
  revelar a existência de dados de outro cliente.
- **Exclusão lógica (`deletedAt`) nas entidades que têm histórico; exclusão
  física só em itens que fazem parte do pai.** Motivo: o histórico de
  agendamentos e pagamentos precisa continuar apontando para pessoas e serviços.
- **Refresh token opaco, com só o hash gravado, e rotação a cada uso.** Motivo:
  um vazamento do banco não entrega tokens utilizáveis.
- **Fluxo de trabalho: plano, aprovação, código, testes.** Motivo: manter o
  escopo sob controle (ver `CLAUDE.md`).

## 2026-10-09 e 10-10 · Planos e pagamentos

- **Todo pagamento nasce `PENDING`, e o método é informado na baixa.** Motivo: o
  método só é conhecido quando o cliente paga.
- **Duas modalidades: integral (um pagamento) e mensal (um por mês).** O valor
  mensal do plano é definido pela empresa, não calculado pelos serviços.
- **O item do plano se chama `PlanItem`.** Motivo: `PlanService` colidiria com a
  classe do NestJS.
- **A contratação congela os valores.** Alterar o plano depois não muda
  contratações feitas.
- **Atraso é derivado, não gravado.** Motivo: um valor gravado precisaria de um
  job para se manter correto; derivado a cada consulta, no fuso da empresa, nunca
  fica desatualizado.
- **Sem multa nem reembolso no cancelamento; sem troca de serviço no plano.**
  Motivo: simplificar o MVP.
- **Valores arredondados a duas casas, metade para cima; no mensal, a parcela é
  arredondada antes do total.** Motivo: a soma das parcelas fecha com o total.
- **Parar de acrescentar funcionalidade para terminar o MVP.** Decisão do
  desenvolvedor durante a etapa 8, depois de várias ideias fora do escopo.

## 2026-10-13 e 10-14 · Frontend começa a pedir ajustes

- **Foto de pessoa: JPEG ou PNG, até 2 MB, conferida pelo conteúdo do arquivo.**
  Motivo: a extensão e o tipo informado pelo navegador podem ser falsificados.
- **CPF e data de nascimento opcionais; o telefone é o contato principal.**
  Motivo: o cliente pode se cadastrar só com nome e telefone.
- **Serviço só é excluído se não tiver relacionamentos; senão, é inativado.**
  Motivo: o histórico precisa continuar com o nome do serviço.

## 2026-10-15 e 10-16 · Agenda

- **Encaixe (`overBooking`) escolhido pelo frontend, sem sobreposição de cliente
  ou profissional.** Motivo: a agenda precisa permitir encaixes conscientes sem
  abrir mão do conflito de pessoas.
- **Só se cancela agendamento antes de iniciar, comparando o horário e não só o
  status.** Motivo: o job de status roda a cada 5 minutos, então um agendamento
  que já começou pode ainda estar `SCHEDULED`.
- **Cancelar a recorrência cancela também os pagamentos pendentes.** Motivo:
  cobrar o que não vai acontecer.
- **Simulação (dry-run) da criação de recorrência adiada.** Motivo: custo maior
  que o benefício para o MVP.

## 2026-10-17 a 10-19 · Empresas, recorrência e contratação

- **O ADMIN altera só o nome fantasia e a logo da própria empresa; o restante
  continua com o SUPER_ADMIN.** Motivo: dados cadastrais e fiscais não devem ser
  editados por quem opera o dia a dia.
- **Recorrência sem limite de 60 dias.** Motivo: um pacote precisa de meses. O
  tempo da transação passou a ser uma constante única (30 s) para as criações
  longas.
- **Falta em sessão de pacote pode ser reposta (só `NO_SHOW`, só pacote).**
  Motivo: o cliente pagou pelo número de sessões. Em recorrência avulsa, não.
- **Frequência semanal no plano (`sessionsPerWeek`) e `CHECK` de 1 a 7 no
  banco.** Motivo: o banco garante o limite mesmo se uma validação for esquecida.
  A frequência não é copiada para a contratação, porque as recorrências já
  guardam os dias.
- **Reativar usuário, pessoa e método de pagamento em vez de recriar.** Motivo:
  o histórico fica ligado ao registro original.

## 2026-10-22 · Pagamentos, segurança e fechamento

- **Sessão de pacote não recebe pagamento próprio.** Motivo: a contratação já a
  cobra, e um pagamento a mais cobraria o cliente duas vezes.
- **Comandas partem das visitas do dia, não dos pagamentos.** Motivo: o
  Financeiro trabalha por cliente atendido. Um atendimento já pago em outro dia
  aparece pago, mas não entra no total do dia.
- **`paidAt` no futuro é recusado na baixa e na criação, mas não na edição.**
  Decisão do desenvolvedor de manter a edição como estava.
- **Segurança da autenticação:** renovação do token atômica (duas renovações
  simultâneas com o mesmo token geram um só par), fim das sessões ao trocar a
  senha ou inativar o usuário, e limite de tentativas (login 5 e refresh 20 por
  minuto, por IP). O login compara a senha mesmo sem usuário, para o tempo de
  resposta não revelar quais e-mails têm conta.
- **Revisão de código local, sem a versão `ultra` (cobrada).** Achou um erro de
  regra real: à noite, em UTC-3, uma recorrência começava no dia anterior ao
  contratado. Lição: data de calendário e instante não se comparam diretamente.
- **Testes da camada HTTP com serviços simulados e as rotas descobertas pelos
  decoradores.** Motivo: os controllers tinham 0% de cobertura, e uma rota nova
  sem proteção passa a falhar sozinha. Os testes foram validados quebrando de
  propósito a ordem das rotas, o `@Roles` e o limite de tentativas.
- **Configuração de produção validada na subida.** A API se recusa a iniciar com
  segredo fraco ou sem `CORS_ORIGIN` quando `NODE_ENV=production`; o Swagger fica
  desligado por padrão em produção. Motivo: falhar cedo e com mensagem clara é
  melhor que descobrir em produção.
- **O que ficou para depois do MVP,** com o motivo, está em `technical-debt.md`
  (marcações simultâneas do mesmo horário, validação em lote de recorrências
  longas, Swagger 12 e legibilidade).

## Lições de processo

- **Branches por funcionalidade, a partir da `main`;** quando uma depende de
  outra não mergeada, ficam encadeadas e os PRs entram em ordem.
- **Merge commit, não squash,** para o histórico mostrar cada funcionalidade.
- **Verificar na API real, não só nos testes.** Os testes unitários passavam
  enquanto a ordem das rotas e a relação `People` ainda não tinham sido
  exercitadas de ponta a ponta.
- **Todo comando que apaga ou altera dados filtra por `companyId`.** O banco de
  desenvolvimento é multiempresa, não um ambiente descartável.
