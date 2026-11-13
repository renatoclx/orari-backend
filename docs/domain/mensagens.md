# Domínio: Mensagens

> Parte de [`domain/`](README.md). Mensagens da clínica, mensagens automáticas, campanhas e notificações.

## ClientMessage

- Aviso recebido pelo cliente no app (a caixa de Avisos).

| Nome            | Descrição                                                                   |
| --------------- | --------------------------------------------------------------------------- |
| id              | Identificador único                                                         |
| clientAccountId | Conta do cliente                                                            |
| companyId       | Clínica que enviou (nula no aviso de teste)                                 |
| kind            | `REMINDER`, `APPOINTMENT`, `BIRTHDAY`, `MISS_YOU`, `CAMPAIGN` ou `TEST`     |
| title, body     | Título (até 100) e texto (até 500)                                          |
| url             | Caminho do app aberto ao tocar (ex.: `/app/agendamentos`)                   |
| readAt          | Quando o cliente viu (opcional)                                             |
| createdAt       | Data do envio                                                               |

- Pertence a uma conta do cliente; a clínica é opcional. Não é a `Notification` (aviso para a clínica).

---

## AutoMessage

- Configuração de uma situação de mensagem automática numa clínica. Sem linha, valem os padrões; a linha nasce no primeiro "Salvar".

| Nome            | Descrição                                                                                                      |
| --------------- | -------------------------------------------------------------------------------------------------------------- |
| id              | Identificador único                                                                                            |
| companyId       | Clínica                                                                                                        |
| kind            | `REMINDER`, `APPOINTMENT_CREATED`, `APPOINTMENT_RESCHEDULED`, `APPOINTMENT_CANCELLED`, `BIRTHDAY` ou `MISS_YOU` |
| enabled         | Ligada                                                                                                         |
| body            | Texto com as variáveis (até 500)                                                                               |
| reminderOffsets | Lembrete: minutos antes do horário (ex.: 1440 e 30)                                                            |
| missYouDays     | Sentimos sua falta: dias sem vir                                                                               |
| createdAt, updatedAt | Criação e última alteração                                                                                |

- Uma por situação em cada clínica (único: `companyId` + `kind`).

---

## MessageCampaign

- Mensagem escrita pela clínica e enviada a todos os clientes com o app (Mensagens → Enviar).

| Nome        | Descrição                                                   |
| ----------- | ----------------------------------------------------------- |
| id          | Identificador único                                         |
| companyId   | Clínica                                                     |
| createdById | Usuário que enviou                                          |
| title       | Título da notificação (até 100)                             |
| body        | Texto com `{nome}` e `{estabelecimento}` (até 500)          |
| recipients  | Quantos receberam na caixa de Avisos                        |
| createdAt   | Data do envio (uma por dia por clínica, no fuso dela)       |

- Pertence a uma clínica e a um usuário. Não tem exclusão.

---

## AutoMessageLog

- Uma mensagem automática já enviada; a chave única impede o envio repetido.

| Nome            | Descrição                                                                      |
| --------------- | ------------------------------------------------------------------------------ |
| id              | Identificador único                                                            |
| companyId       | Clínica                                                                        |
| kind            | A situação                                                                     |
| dedupKey        | Chave única do envio (ex.: `reminder:<agendamento>:1440:<início>`, `birthday:<pessoa>:2026`) |
| clientAccountId | Conta do cliente que recebeu                                                   |
| createdAt       | Data do envio                                                                  |

- Pertence a uma clínica. Não tem exclusão.

---

## UserNotification

- A notificação de um usuário do sistema (ADMIN ou PROFESSIONAL): o sino do painel e do app do profissional. Substitui a antiga `Notification` por empresa, que nunca teve tipo em uso.
- Fica na caixa do usuário mesmo sem push. A mesma `dedupeKey` para o mesmo usuário grava uma só vez (um job rodando de novo, ou a API reiniciada, não duplica).

### Atributos

| Nome      | Descrição                                                           |
| --------- | ------------------------------------------------------------------- |
| id        | Identificador único                                                 |
| companyId | Código da empresa                                                   |
| userId    | Usuário que recebe                                                  |
| category  | `APPOINTMENT` (cresce com as fontes de aviso)                       |
| title     | Título (até 100 caracteres)                                         |
| body      | Texto (até 500 caracteres)                                          |
| url       | Caminho aberto ao tocar (do painel ou do app, conforme quem recebe) |
| dedupeKey | Chave do evento, única por usuário                                  |
| readAt    | Data da leitura (opcional)                                          |
| clearedAt | Data em que o usuário limpou a caixa (opcional): some da lista e do contador, a linha fica |

`UserNotificationPreference` (usuário × categoria × `push`) e `UserPushSubscription` (aparelho do usuário: endereço e chaves) completam o conjunto.
