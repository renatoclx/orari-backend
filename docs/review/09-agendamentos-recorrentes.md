# 09 – Agendamentos recorrentes

Atendimentos que se repetem em dias fixos da semana e **geram agendamentos
reais**.

**PR:** 6 (`feat/agenda`) · **Regras:** [business-rules.md § Agendamentos recorrentes](../business-rules.md)

## Regras em resumo

- Valem as mesmas regras de empresa, tipos de pessoa e serviço ativo dos
  agendamentos avulsos.
- A recorrência precisa de ao menos um dia; cada dia tem dia da semana, início e
  fim, e precisa **reservar ao menos a duração do serviço**.
- Dois dias da mesma recorrência não podem se sobrepor no mesmo dia da semana.
- Informar `days` numa edição **substitui todos** os dias anteriores.
- **Geração:** ao criar, os agendamentos são criados até a data final ou 90 dias
  à frente, dentro de uma transação. Conflito em qualquer data desfaz tudo.
- **Regeração:** alterar dias, período, serviço, participantes ou `isActive`
  cancela os futuros ainda em `SCHEDULED` e recria. Passados, confirmados,
  concluídos e cancelados à mão são preservados. Mudar só a observação não mexe
  na agenda.
- **Não há exclusão:** a recorrência é desativada por `isActive`.
- O horizonte **não avança sozinho**: a ampliação é manual
  (`POST /recurring-appointments/:id/extend`), avisada por notificação (guia 10).

## Onde está

| Arquivo | Responsabilidade |
| ------- | ---------------- |
| `modules/recurring-appointment/recurring-appointment.service.ts` | Validações, geração, regeração e extensão |
| — `buildOccurrences()` | Percorre o calendário da empresa e monta os horários |
| — `findNeedingExtension()` | Alimenta a notificação de horizonte |
| `modules/appointment/appointment.service.ts` | Cria e cancela os agendamentos gerados |

## Rotas

| Método | Rota |
| ------ | ---- |
| POST | `/recurring-appointments` |
| GET | `/recurring-appointments` (`?professionalId`, `?clientId`, `?isActive`) |
| GET/PATCH | `/recurring-appointments/:id` |
| POST | `/recurring-appointments/:id/extend` |

## Testes

`recurring-appointment.service.spec.ts` (26) — inclui geração com relógio fixo,
fuso, regeração e extensão.

## O que olhar com atenção

- **Tudo ou nada:** um único agendamento avulso ocupando um dos novos horários
  bloqueia a edição inteira da recorrência (409). A alternativa seria pular as
  datas em conflito e avisar quais ficaram de fora.
- **`buildOccurrences()` mistura dois tipos de data:** `startDate`/`endDate` são
  datas puras (calendário, sem fuso) e `from`/horizonte são instantes (lidos no
  fuso). Essa distinção já causou um defeito — o último dia da recorrência era
  descartado em UTC-3 — e é o ponto que mais merece leitura atenta.
- **A recorrência não reserva horário por si:** quem bloqueia a agenda são os
  agendamentos gerados. Fora do horizonte gerado, o horário está livre.
- **Cada regeração cancela e recria**, acumulando registros `CANCELLED` na
  tabela a cada edição.
