# Domínio: Portal do cliente

> Parte de [`domain/`](README.md). Contas do cliente, verificação, vínculo com a clínica, sessões, push e configurações.

## PortalVerification

- Código pelo WhatsApp, pedido por telefone (ver `business-rules/portal-do-cliente.md`, "Portal do cliente"). Sem rotas desde a etapa 6a; volta para confirmar o telefone da conta.

| Nome       | Descrição                                                    |
| ---------- | ------------------------------------------------------------ |
| id         | Identificador único                                          |
| companyId  | Clínica do portal                                            |
| phone      | Telefone com DDD, só dígitos                                 |
| codeHash   | HMAC do código (o código em si não é gravado)                |
| attempts   | Tentativas erradas                                           |
| expiresAt  | Fim da validade do código (10 minutos)                       |
| verifiedAt | Quando o código foi conferido                                |
| usedAt     | Quando virou sessão (cada conferência vira uma só)           |
| ip         | IP do pedido                                                 |

---

## PortalAccessLink

- Link de acesso ao portal gerado pela clínica para um cliente (uso único, 24 horas).

| Nome      | Descrição                                           |
| --------- | --------------------------------------------------- |
| id        | Identificador único                                 |
| companyId | Clínica                                             |
| peopleId  | Cliente do link                                     |
| tokenHash | SHA-256 do token (o token não é gravado)            |
| expiresAt | Fim da validade                                     |
| usedAt    | Quando foi usado (ou substituído por um novo)       |
| createdAt | Quando foi gerado (quem gerou fica na auditoria)    |

---

## ClientAccount

- Conta do cliente no app, única no Orari, com telefone e senha. Em cada clínica, o cliente é o cadastro dela (`People`) ligado à conta.

| Nome         | Descrição                                    |
| ------------ | -------------------------------------------- |
| id           | Identificador único                          |
| phone        | Telefone com DDD, só dígitos (único; é o login) |
| name         | Nome do cliente                              |
| passwordHash | Hash bcrypt da senha                         |
| email, document, birthDate, profession | Meus dados (opcionais; CPF sem máscara) |
| photoUrl     | Foto da conta (cada clínica tem a própria cópia) |
| addressCep, addressStreet, addressNumber, addressComplement, addressNeighborhood, addressCityId | Endereço principal (opcional) |
| notifyAppointments | Avisos de lembretes e agendamentos (padrão ligado) |
| notifyPromotions | Avisos de novidades e promoções (padrão ligado) |
| createdAt    | Data de criação                              |
| updatedAt    | Última alteração (ex.: troca de senha)       |

- Não pertence a uma empresa.

---

## PortalSession

- Sessão da conta do cliente no app, por aparelho.

| Nome            | Descrição                                        |
| --------------- | ------------------------------------------------ |
| id              | Identificador único                              |
| clientAccountId | Conta do cliente                                 |
| tokenHash       | SHA-256 do token (o token não é gravado)         |
| expiresAt       | Fim da validade (90 dias)                        |
| revokedAt       | Quando o cliente saiu (ou a sessão foi revogada) |
| lastUsedAt      | Último uso (reservado)                           |
| userAgent       | Aparelho que abriu a sessão                      |

- Pertence a uma conta do cliente (vale em todos os estabelecimentos dela).

---

## PushSubscription

- Aparelho em que o cliente ativou os avisos do app (Web Push).

| Nome            | Descrição                                                  |
| --------------- | ---------------------------------------------------------- |
| id              | Identificador único                                        |
| clientAccountId | Conta do cliente                                           |
| portalSessionId | Sessão do aparelho (ao sair do app, a inscrição é apagada) |
| endpoint        | Endereço de entrega do serviço de push (único)             |
| p256dh, auth    | Chaves do aparelho que cifram o conteúdo do aviso          |
| userAgent       | Aparelho que ativou                                        |
| createdAt       | Data de criação                                            |

- Pertence a uma conta do cliente e a uma sessão. Não tem exclusão lógica: some ao sair, ao desativar ou quando o serviço de push diz que o aparelho não existe mais.

---

## PortalSettings

- Regras do portal do cliente definidas pela clínica (um registro por empresa, criado na primeira gravação).

| Nome              | Descrição                                        |
| ----------------- | ------------------------------------------------ |
| companyId         | Empresa (também é o identificador)               |
| enabled           | Portal ligado (padrão: desligado)                |
| listed            | Aparece na busca de estabelecimentos do app (padrão: não) |
| segment           | Ramo do estabelecimento (`BusinessSegment`); obrigatório para aparecer na busca |
| minAdvanceMinutes | Antecedência mínima para agendar, em minutos     |
| maxDaysAhead      | Até quantos dias à frente o cliente agenda       |
| cancelUntilHours  | Até quantas horas antes o cliente cancela        |
| updatedAt         | Última alteração                                 |

---
