# Domínio: Serviços

> Parte de [`domain/`](README.md). Serviços e os profissionais que os atendem.

## Services

- Representa os serviços que cada empresa cadastra na aplicação.

### Atributos

| Nome          | Descrição                                        |
| ------------- | ------------------------------------------------ |
| id            | Identificador único                              |
| name          | Nome do serviço                                  |
| description   | Descrição do serviço (opcional)                  |
| price         | Valor cobrado pelo serviço (opcional)            |
| duration      | Duração do serviço em minutos                    |
| companyId     | Empresa a qual pertence o serviço                |
| isActive      | Serviço Ativo ou inativo                         |
| color         | Cor associada ao serviço (opcional)              |
| allowsClasses | Aceita atendimento em turma (padrão: não aceita) |

### Relacionamentos

- Uma empresa pode ter vários serviços.
- Um serviço pode estar em vários agendamentos e agendamentos recorrentes.
- Um serviço que aceita turma pode estar em várias turmas (ClassGroup).

---

## ServiceProfessional

- Profissional que atende um serviço. No portal, o serviço só aparece com ao menos um profissional ativo.

| Nome      | Descrição                          |
| --------- | ---------------------------------- |
| serviceId | Serviço                            |
| peopleId  | Profissional (pessoa PROFESSIONAL) |
| createdAt | Quando foi ligado                  |

- Chave composta (serviço + profissional).

---
