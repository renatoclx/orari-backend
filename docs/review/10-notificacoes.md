# 10 – Notificações

A caixa de notificações de cada usuário do sistema (o sino do painel e do app do
profissional), com o push por categoria.

**Regras:** [business-rules/mensagens.md § Notificações](../business-rules/mensagens.md)

## Regras em resumo

- Cada usuário só lê e altera as **próprias**; criadas pela própria API.
- A caixa recebe tudo; só o **push** tem interruptor por categoria. O push é
  genérico (sem o nome do cliente).
- **`dedupeKey` única por usuário:** o mesmo evento não duplica.
- Fonte atual: o cliente marca ou cancela pelo app (avisa os ADMIN e o
  profissional do horário).

## Avisos ao profissional

O que a clínica faz nos horários dele (`professional-appointment.listener.ts`),
o lembrete de 30 minutos e o resumo das 7h30 (`professional-notifier.job.ts`,
regras puras em `professional-notifier.ts`). Texto e liga/desliga em Mensagens →
Automáticas (`PROFESSIONAL_REMINDER` e `PROFESSIONAL_SUMMARY`).

## Onde está

| Arquivo | Responsabilidade |
| ------- | ---------------- |
| `modules/notification/notification.service.ts` | Caixa, preferências e aparelhos |
| `modules/notification/notification-dispatcher.service.ts` | Grava e envia o push (o ponto único de envio) |
| `modules/notification/appointment-notifier.listener.ts` | A primeira fonte: o que o cliente faz pelo app |

## Rotas

`GET /notifications`, `GET /notifications/unread-count`, `PATCH /notifications/read-all`,
`DELETE /notifications` (limpar),
`PATCH /notifications/:id/read`, `GET` e `PUT /notifications/preferences`,
`POST` e `DELETE /notifications/push/subscriptions`.

## O que olhar com atenção

- **O despachante envia o push em série,** dentro do evento (o ouvinte roda fora
  da requisição, mas sem fila). Com muitos destinatários, uma fila seria melhor
  (ver `technical-debt.md`).
- **Sem horário de silêncio** nem limite de frequência por enquanto.
