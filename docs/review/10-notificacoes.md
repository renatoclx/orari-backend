# 10 – Notificações

Avisos para a empresa agir. Hoje existe um único tipo: a recorrência está
chegando ao fim dos agendamentos gerados.

**PR:** 8 (`feat/notificacoes-e-demo`) · **Regras:** [business-rules.md § Notificações, Extensão do horizonte](../business-rules.md)

## Regras em resumo

- Criadas e resolvidas **pela própria API**; o cliente não cria nem exclui.
- O aviso aparece quando faltam menos de **30 dias** de agenda gerada para uma
  recorrência ativa que ainda tem período pela frente.
- **A lista se sincroniza a cada consulta:** cria o que falta e resolve o que já
  foi atendido. Não há rotina agendada no projeto.
- Pode ser marcada como lida. Ao ser resolvida, sai da lista padrão, mas continua
  no histórico (`?includeResolved=true`).
- Notificações não são excluídas.

## Onde está

| Arquivo | Responsabilidade |
| ------- | ---------------- |
| `modules/notification/notification.service.ts` | Listagem, leitura e `syncRecurringHorizon()` |
| `modules/recurring-appointment/recurring-appointment.service.ts` | `findNeedingExtension()` e `extend()` |

## Rotas

| Método | Rota |
| ------ | ---- |
| GET | `/notifications` (`?onlyUnread`, `?includeResolved`) |
| GET | `/notifications/:id` |
| PATCH | `/notifications/:id/read` |

## Testes

`notification.service.spec.ts` (8).

## O que olhar com atenção

- **O aviso depende de alguém consultar `/notifications`.** Sem consulta, não há
  criação. Foi a alternativa escolhida para não depender de um agendador — se o
  front consultar ao abrir a agenda, o efeito é o mesmo.
- **Sincronizar dentro de um GET** faz uma leitura ter efeito colateral de
  escrita. É o ponto mais discutível do módulo.
- **Direção das dependências:** `NotificationModule` importa
  `RecurringAppointmentModule` (e não o contrário), para evitar ciclo. Por isso
  a recorrência não resolve a notificação ao ser estendida — ela é resolvida na
  próxima consulta.
- Os 30 dias e o horizonte de 90 estão em constantes no service da recorrência.
