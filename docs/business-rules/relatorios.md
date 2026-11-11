# Regras de negócio: Relatórios

> Parte de [`business-rules/`](README.md). Carteira, recebíveis, relatórios, rankings, perfil do cliente e dashboard.

## Carteira de clientes

> **Estado:** backend em 2026-11-09 (Relatórios → Carteira de clientes). Funcionalidade `client-portfolio`, só Visualiza, **marcada no modelo padrão** de empresa nova (desde 2026-11-09); as empresas existentes não ganharam linha (liberar em Acessos e limites).

- Relatório só de leitura, **por profissional**, só do **ADMIN** (mostra o faturamento): quais clientes ele atende e como está cada um. Tudo sai dos agendamentos e pagamentos; não há "profissional responsável" no cadastro.
- **Na carteira:** cliente **ativo** (não inativado) com ao menos um agendamento **não cancelado** com o profissional (avulso, recorrência, pacote ou turma). Um cliente pode estar na carteira de vários profissionais. Profissional inexistente, de outra empresa ou que não é profissional: 404.
- **Período:** `from` e `to` em dias do fuso da empresa (AAAA-MM-DD, pontas incluídas); sem eles, o mês atual. Fim antes do início: 400.
- **Situação** (uma só, nesta ordem):
  - `NEW` (Novo): o **primeiro** atendimento `COMPLETED` com o profissional caiu no período;
  - `ACTIVE` (Ativo): atendimento `COMPLETED` nos últimos **60 dias** ou agendamento futuro (`SCHEDULED`/`CONFIRMED`, começando de agora em diante) com o profissional;
  - `LAPSED` (Sem retorno): nenhum dos dois. Inclui quem nunca concluiu e não tem nada marcado.
  - Novo vale para o período; Ativo e Sem retorno, para hoje. Os 60 dias são fixos (sem configuração por empresa).
- `GET /client-portfolio?professionalId=&from=&to=` (resumo): `clients`, `newClients`, `lapsedClients`; `completed` (atendimentos `COMPLETED` no período) e, deles, `packageSessions` (sessões de pacote, contadas **sem valor**: o pagamento é da contratação; o rateio por sessão fica para a comissão); `received` e `pending` (pagamentos `PAID` e `PENDING`, não excluídos, dos concluídos no período); `averageTicket` = (recebido + pendente) ÷ quantidade desses pagamentos, ou `null` sem nenhum. Valores em texto com duas casas. `series`: o gráfico do período, `unit` `day` (até 62 dias) ou `week` (acima disso, semanas de 7 dias contadas do início do período, a última podendo ser menor) e `points` com todos os intervalos, inclusive os vazios: `date` (primeiro dia do intervalo, AAAA-MM-DD no fuso da empresa), `completed`, `received` e `pending`, pelo dia do atendimento.
- `GET /client-portfolio/clients` (mesmos filtros, mais `status`, `search` pelo nome sem acentos nem caixa, `page` e `limit` até 100): cada item traz `id`, `name`, `photoUrl`, `phone` (do contato principal), `status`, `lastCompleted` (`startAt` e `serviceName` do último concluído, ou `null`), `nextAt` (próximo agendamento futuro, ou `null`), `completedInPeriod` e `pending` (pagamentos `PENDING` dos agendamentos não cancelados do cliente com o profissional, **qualquer vencimento**).
- **Ordem da lista:** quem precisa de contato primeiro: sem atendimento concluído e sem nada marcado; depois pelo último atendimento, do mais antigo ao mais recente; quem só tem agendamento futuro, por último. Empate: nome.

## Análise de recebíveis (antes "Contas a receber")

> **2026-11-10:** o relatório foi renomeado na tela (rota `/relatorios/analise-de-recebiveis` no frontend); a API (`/receivables`) e a funcionalidade `receivables` não mudaram. "Contas a receber" passou a ser o nome da tela operacional de pagamentos dos clientes (Financeiro).

> **Estado:** backend em 2026-11-09 (Relatórios → Contas a receber). Funcionalidade `receivables`, só Visualiza, **marcada no modelo padrão** de empresa nova; as empresas existentes não ganharam linha (liberar em Acessos e limites).

- Relatório só de leitura da **empresa inteira**, só do **ADMIN**: o que há para receber, o que está atrasado e há quanto tempo. Tudo sai dos **pagamentos** (atendimento avulso, recorrência e contratação de plano); `CANCELLED` e excluídos ficam de fora. Atrasado segue a regra de Pagamentos: `PENDING` com vencimento **antes de hoje** no calendário da empresa.
- Desde 2026-11-11, os pagamentos de **venda de produtos** também entram (o cliente vem da venda).
- `GET /receivables?from=&to=` (resumo). Período como na carteira (AAAA-MM-DD, fuso da empresa, pontas incluídas; padrão: o mês atual; fim antes do início: 400).
  - Hoje, sem período: `open` (todo `PENDING`, inclusive sem vencimento), `overdue` (atrasado, com `clients`, quantos clientes devem) e `aging` (o atrasado por dias de atraso: `1-30`, `31-60`, `61-90` e `90+`; todas as faixas, mesmo vazias).
  - No período: `received` (`PAID` com `paidAt` no período) e `default` (inadimplência: `due` = pagamentos `PAID` ou `PENDING` com vencimento no período **até ontem**; `unpaid` = os que seguem `PENDING`; `rate` = `unpaid` ÷ `due`, de 0 a 1, ou `null` sem nada vencido).
  - `months`: gráfico fixo de 9 meses (os 5 anteriores, o atual e os 3 seguintes), pelo **vencimento**: `month` (AAAA-MM), `paid`, `overdue` e `upcoming`. Sem vencimento não entra no gráfico.
  - Totais com `total` (texto com duas casas) e `count`.
- `GET /receivables/debtors` (`search` pelo nome sem acentos nem caixa, `page`, `limit` até 100): um item por cliente com atraso, também cliente inativado (a dívida continua): `id`, `name`, `photoUrl`, `phone` (contato principal), `overdue` (soma em atraso), `count` e `oldestDueDate` (vencimento mais antigo em atraso). Ordem: maior valor em atraso primeiro; empate pelo nome.

## Relatório de agendamentos

> **Estado:** backend em 2026-11-10 (Relatórios → Agendamentos). Funcionalidade `appointments-report`, só Visualiza, marcada no modelo padrão de empresa nova.

- Relatório só de leitura, só do **ADMIN**, da empresa toda ou de um profissional (`professionalId` opcional; inexistente, de outra empresa ou que não é profissional: 404). Período como nos demais relatórios (`from`/`to`, AAAA-MM-DD no fuso da empresa, pontas incluídas; padrão: o mês atual; fim antes do início: 400), pelo **início** do agendamento.
- `GET /appointment-report`:
  - `total`: agendamentos **não cancelados** (concluídos, faltas e os ainda sem desfecho); `open`: agendado, confirmado ou em andamento; `fromPortal`: dos não cancelados, os marcados pelo cliente no app.
  - `completed`, `noShow` e `cancelled`. O cancelamento de aula pela clínica (sessão cancelada, saída da turma) também conta como cancelado. Na turma, cada aluno é um agendamento.
  - `noShowRate` = faltas ÷ (concluídos + faltas), só o que já deveria ter acontecido; `cancelRate` = cancelados ÷ todos (com os cancelados). De 0 a 1; `null` sem base.
  - `series`: `unit` `day` (até 62 dias) ou `week`, com todos os intervalos: `date`, `completed`, `noShow`, `cancelled` e `open`.
  - `peak`: os não cancelados por dia da semana (`weekDay`, 0 = domingo) e hora de início no fuso da empresa (`hour`), só as células com algum agendamento.
  - `byProfessional` e `byService`: `id`, `name`, `total` (não cancelados), `completed`, `noShow`, `cancelled`; no serviço, também `minutes` (duração somada dos não cancelados). Ordem: maior total; empate pelo nome.
- **Ocupação** (horas marcadas ÷ horas disponíveis) fica de fora: o horário de funcionamento é da empresa, não de cada profissional, e a conta sairia errada.

## Rankings

> **Estado:** backend em 2026-11-10 (Relatórios → Rankings). Funcionalidade `rankings`, só Visualiza, marcada no modelo padrão de empresa nova.

- Relatório só de leitura, só do **ADMIN**, da empresa toda. Período como nos demais relatórios (padrão: o mês atual).
- Base: atendimentos `COMPLETED` no período (pelo início) e o **pagamento próprio** de cada um, quando `PAID` ou `PENDING` e não excluído. **Faturado** é a soma desses pagamentos (a mesma conta da Carteira de clientes). A sessão de pacote conta na quantidade, **sem valor** (o pagamento é da contratação; o rateio fica para a comissão).
- `GET /rankings?from=&to=&sort=`: `summary` (`amount`, `completed`, `average` = faturado ÷ concluídos com pagamento, e `packages`: quantidade e valor dos pacotes contratados no período); `services` (com `share`, a parte do faturado, de 0 a 1), `professionals` (com `clients`, clientes distintos atendidos) e `clients` (com `packages` e `lastVisit`, o último concluído no período).
- **Clientes** somam ao faturado os **pacotes contratados no período** (pela data da contratação; o valor é a soma dos pagamentos `PAID` ou `PENDING` não excluídos da contratação, então a parte cancelada não conta). O ticket médio do cliente continua só dos atendimentos.
- Listas inteiras, ordenadas por `sort`: `amount` (padrão: faturado, depois quantidade) ou `count` (quantidade, depois faturado); empate pelo nome. A tela mostra os 10 primeiros; a impressão, todos. `sort` inválido: 400.

## Relatório financeiro

> **Estado:** backend em 2026-11-10 (Relatórios → Financeiro). Funcionalidade `financial-report`, só Visualiza, exige ver Pagamentos; marcada no modelo padrão de empresa nova.

- Relatório só de leitura, só do **ADMIN**, da empresa toda: o que **entrou no caixa**. Complementa o Contas a receber (o que falta receber) e os Rankings (o faturado pelos atendimentos).
- Base: pagamentos `PAID`, não excluídos, pela **data do pagamento** (`paidAt`) no período, no fuso da empresa (padrão: o mês atual). Filtro opcional por método de pagamento (`paymentMethodId`; de outra empresa: 404).
- `GET /financial-report?from=&to=&paymentMethodId=`: `received` (total), `appointments`, `packages` e `products` (pela origem: pagamento de atendimento, de contratação ou de venda de produtos, desde 2026-11-11), `series` (por dia até 62 dias, senão por semana, separando atendimentos, pacotes e produtos) e `byMethod` (valor, quantidade e `share`, do maior para o menor; pagamento sem método fica numa linha com `id` null).
- `GET /financial-report/payments` (paginado, mesmos filtros): o extrato, do pagamento mais recente para o mais antigo, com data, valor, origem (`appointment`, `package` ou `product`), descrição (serviço do atendimento, nome do pacote ou os produtos vendidos, ex.: "Sérum, Faixa (2)"), cliente e método.

## Relatório de pacotes

> **Estado:** backend em 2026-11-10 (Relatórios → Pacotes). Funcionalidade `packages-report`, só Visualiza, exige ver Contratações; marcada no modelo padrão de empresa nova.

- Relatório só de leitura, só do **ADMIN**, da empresa toda: a vida das contratações de pacote. Os valores recebidos e em atraso ficam no Financeiro e no Contas a receber.
- No período (padrão: o mês atual, no fuso da empresa): **novas** (pela data da contratação, com o valor contratado, `totalAmount`) e **canceladas** (pela data do cancelamento).
- Hoje: **ativas** (não canceladas e com data final de hoje em diante, inclusive as que ainda vão começar; vale o período contratado, mesmo sem sessões restantes) e **terminando em breve** (ativas com data final até hoje + 30 dias, quando o cliente não tem outra contratação ativa terminando depois, ou seja, ainda não renovou).
- `GET /packages-report?from=&to=`: `created` (quantidade e valor), `active`, `cancelled`, `ending` e `byPlan` (os mesmos números por pacote, só os pacotes com algum deles, do maior valor contratado para o menor).
- `GET /packages-report/ending` (paginado): as contratações terminando, do fim mais próximo ao mais distante (empate pelo nome do cliente), com o cliente (e o celular principal), o pacote, a data final e as **sessões**: concluídas de quantas a contratação tem (os agendamentos das recorrências dela, sem os cancelados).

## Perfil do cliente

> **Estado:** backend em 2026-11-10 (Relatórios → Perfil do cliente). Funcionalidade `clients-report`, só Visualiza, exige ver Clientes e Agendamentos; marcada no modelo padrão de empresa nova.

- Relatório só de leitura, só do **ADMIN**, da empresa toda. A base são os clientes **ativos no cadastro** (não inativados); os inativados ficam fora de tudo.
- Hoje: **ativo** (atendimento `COMPLETED` nos últimos **60 dias** ou agendamento futuro `SCHEDULED`/`CONFIRMED`; a mesma regra da Carteira de clientes) e **sem retorno** (o resto, inclusive quem nunca foi atendido); **com o app** (cadastro ligado a uma conta do app).
- No período (padrão: o mês atual, no fuso da empresa): **novos** (o primeiro atendimento concluído na empresa caiu no período); **atendidos** (com concluído no período) e **frequência** (concluídos ÷ atendidos).
- **Tipo de atendimento**, sobre os atendidos: avulso, recorrência, pacote (recorrência de uma contratação) e turma (sessão de turma). Não são exclusivos: o pacote numa turma conta nos dois, e um cliente pode ter vários tipos.
- **Por onde agendam:** os concluídos do período pela origem (clínica ou app).
- **Cadastro:** faixas de idade (até 17, 18 a 29, 30 a 44, 45 a 59, 60 ou mais, em anos completos hoje) e cidades (pelo endereço principal: as 5 mais comuns, "Outras" e sem endereço). Sem o dado, conta como não informado.
- `GET /clients-report?from=&to=`: os números acima, cada um com a quantidade e a parte da base (`share`, de 0 a 1).
- `GET /clients-report/birthdays` (paginado, mesmo período): **aniversariantes**, pela data do aniversário (empate pelo nome), com a data de nascimento, a idade que completa e o celular principal. Quem nasceu em 29/02 comemora em 28/02 nos anos que não são bissextos.

## Dashboard

> **Estado:** 2026-11-10. Funcionalidade `dashboard`, só Visualiza, marcada no modelo padrão de empresa nova. Não tem rota própria na API.

- Tela do **ADMIN** que junta os números dos relatórios, só com métricas e gráficos. Os dados vêm das rotas dos relatórios (Financeiro, Contas a receber, Agendamentos, Rankings, Pacotes, Perfil do cliente), então os números são sempre os mesmos dos relatórios.
- Cada bloco só aparece quando a empresa tem a funcionalidade do relatório de origem; a API de cada relatório continua conferindo a sua.
- As métricas do período comparam com o **período anterior**: um mês inteiro com o mês anterior inteiro (ex.: novembro com outubro); qualquer outro período com os dias imediatamente antes, do mesmo tamanho. A tela consulta as mesmas rotas com as datas anteriores.
