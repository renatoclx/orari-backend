# Domínio: Empresa e acesso

> Parte de [`domain/`](README.md). Empresa, funcionalidades e limites contratados, usuários, sessões e auditoria.

## Company

- Representa uma empresa cadastrada na aplicação.

### Atributos

| Nome            | Descrição                                    |
| --------------- | -------------------------------------------- |
| id              | Identificador único                          |
| corporateReason | Razão Social da empresa                      |
| fantasyName     | Nome Fantasia (opcional)                     |
| document        | CPF ou CNPJ da empresa                       |
| foundationDate  | Data de fundação (opcional)                  |
| isActive        | Empresa ativa ou inativa                     |
| timezone        | Fuso horário da empresa (identificador IANA) |
| logoUrl         | caminho da logomarca da empresa (opcional)   |
| subdomain       | Subdomínio da empresa                        |

### Relacionamentos

- Uma empresa pode ter mais de um endereço.
- Uma empresa pode ter mais de um contato.
- Uma empresa pode ter vários usuários, pessoas, serviços, métodos de pagamento,
  horários de funcionamento, agendamentos, agendamentos recorrentes, planos e
  contratações de planos.
- Uma empresa tem uma linha de acesso por funcionalidade liberada (`CompanyFeatureAccess`) e um registro de limites (`CompanyLimit`).

---

## CompanyFeatureAccess

- O que os administradores da empresa podem fazer em uma funcionalidade (ver `business-rules/empresa-e-acesso.md`, "Acessos e limites da empresa"). Sem linha, a funcionalidade fica sem acesso.

### Atributos

| Nome      | Descrição                                                        |
| --------- | ---------------------------------------------------------------- |
| id        | Identificador único                                              |
| companyId | Empresa                                                          |
| feature   | Chave da funcionalidade (catálogo no código)                     |
| canView   | Pode visualizar                                                  |
| canEdit   | Pode editar                                                      |
| canCreate | Pode criar                                                       |
| canRemove | Pode excluir ou inativar                                         |

### Relacionamentos

- Pertence a uma empresa. É única por empresa e funcionalidade.

---

## CompanyLimit

- Limites da empresa, definidos pelo SUPER_ADMIN.

### Atributos

| Nome             | Descrição                                                  |
| ---------------- | ---------------------------------------------------------- |
| companyId        | Empresa (também é o identificador: um registro por empresa) |
| maxProfessionals | Profissionais ativos permitidos, contando o administrador   |
| maxAdmins        | Administradores (usuários com acesso) permitidos           |

### Relacionamentos

- Pertence a uma empresa.

---

## User

- Representa um usuário que terá acesso ao sistema.

### Tipos de Usuário (UserTypes)

- SUPER_ADMIN - Administrador da plataforma
- ADMIN - Administrador da empresa (o cliente)
- PROFESSIONAL - Profissional que usa só o app (PWA)

### Atributos

| Nome      | Descrição                                                            |
| --------- | -------------------------------------------------------------------- |
| id        | Identificador único                                                  |
| name      | Nome da pessoa                                                       |
| email     | E-mail para login                                                    |
| password  | Senha para login                                                     |
| type      | Tipo de usuário                                                      |
| companyId | Código da empresa                                                    |
| peopleId  | Código da pessoa vinculada ao usuário: profissional ou funcionário (opcional, ver Anamnese) |

### Relacionamentos

- Uma usuário pertence a uma empresa
- Um usuário pode estar vinculado a uma pessoa do tipo PROFESSIONAL ou EMPLOYEE (People)

---

## RefreshToken

- Representa uma sessão de autenticação renovável de um usuário (ver `auth.md`).

### Atributos

| Nome      | Descrição                                        |
| --------- | ------------------------------------------------ |
| id        | Identificador único                              |
| userId    | Código do usuário                                |
| tokenHash | Hash do token (o valor bruto nunca é persistido) |
| expiresAt | Data de expiração                                |
| revokedAt | Data em que o token foi revogado (opcional)      |

### Relacionamentos

- Um refresh token pertence a um usuário.
- Um usuário pode ter mais de um refresh token (uma sessão por dispositivo).

---

## AuditLog

- Representa o registro de uma ação sensível, para saber quem acessou ou alterou o quê.
- É gravado pelo sistema e não é alterado nem excluído pela API.

### Atributos

| Nome       | Descrição                                                   |
| ---------- | ----------------------------------------------------------- |
| id         | Identificador único                                         |
| companyId  | Código da empresa                                           |
| userId     | Código do usuário que executou a ação                       |
| action     | Ação realizada (ex.: leitura de ficha, criação de registro) |
| entityType | Tipo do que foi acessado (ex.: ficha, modelo)               |
| entityId   | Código do que foi acessado                                  |
| clientId   | Código do cliente a que a ação se refere (opcional)         |
| ip         | Endereço IP de quem fez a requisição (opcional)             |
| details    | Antes e depois da ação, quando altera valores (opcional)    |
| createdAt  | Data e hora da ação                                         |

### Relacionamentos

- Um registro de auditoria pertence a uma empresa e a um usuário.

---
