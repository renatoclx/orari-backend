# 08 – Agendamentos

O atendimento marcado entre um cliente e um profissional.

**PR:** 6 (`feat/agenda`) · **Regras:** [business-rules.md § Agendamentos](../business-rules.md)

## Regras em resumo

- Cliente, profissional e serviço precisam ser da empresa do usuário.
  `clientId` tem que ser uma pessoa `CLIENT` e `professionalId`, `PROFESSIONAL`.
- **`endAt` é calculado** somando a duração do serviço ao início; enviá-lo no
  payload retorna 400.
- **Sem sobreposição** para o mesmo profissional nem para o mesmo cliente.
  Horários que apenas se encostam são permitidos, e cancelados liberam a agenda.
- Não se agenda no passado, nem se remarca para o passado. Alterar status ou
  observação de um atendimento já realizado continua permitido.
- Precisa caber em uma janela de atendimento (guia 07).
- **Não há exclusão:** o ciclo é controlado pelo `status` (`SCHEDULED`,
  `CONFIRMED`, `COMPLETED`, `CANCELLED`, `NO_SHOW`), começando em `SCHEDULED`.

## Onde está

| Arquivo | Responsabilidade |
| ------- | ---------------- |
| `modules/appointment/appointment.service.ts` | Participantes, cálculo do fim, conflito, janela e data futura |
| — `ensureSlotIsFree()` | Consulta de sobreposição (aceita cliente de transação) |
| — `createFromRecurrence()` / `cancelFutureFromRecurrence()` | Usados pela recorrência (guia 09) |
| `modules/appointment/dto/find-appointments-query.dto.ts` | Filtros `status`, participantes e período |

## Rotas

| Método | Rota | Observação |
| ------ | ---- | ---------- |
| POST | `/appointments` | |
| GET | `/appointments` (`?status`, `?professionalId`, `?clientId`, `?from`, `?to`) | Ordenado por início |
| GET/PATCH | `/appointments/:id` | Sem DELETE: cancelar é mudar o status |

## Testes

`appointment.service.spec.ts` (22).

## O que olhar com atenção

- **A checagem de conflito é uma consulta por agendamento.** Na geração de uma
  recorrência isso vira uma consulta por ocorrência (dezenas por chamada).
- **A janela só é revalidada quando `startAt` ou `serviceId` mudam** no PATCH;
  mudar só o status não revalida (proposital, para permitir cancelar/concluir).
- **Cancelado não disputa horário:** um agendamento cancelado deixa de bloquear
  e o mesmo horário pode ser reutilizado.
- O conflito considera cliente **e** profissional na mesma consulta (`OR`), e a
  mensagem identifica qual dos dois causou o 409.
