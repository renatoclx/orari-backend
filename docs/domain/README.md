# Domínio

## Objetivo

- Criar as entidades que irão compor a base de dados.

> Esta pasta descreve apenas **o que existe**: entidades, responsabilidades,
> atributos e relacionamentos. Regras de funcionamento ficam em
> [`../business-rules/`](../business-rules/README.md), e convenções de persistência
> (datas de auditoria, exclusão lógica, tipos de coluna) ficam no
> [`../database.md`](../database.md).

## Arquivos

As entidades estão divididas pelas mesmas áreas das regras de negócio.

| Arquivo                                            | Entidades                                                                                                            |
| -------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------- |
| [`empresa-e-acesso.md`](empresa-e-acesso.md)       | Company, CompanyFeatureAccess, CompanyLimit, User, RefreshToken, AuditLog                                            |
| [`pessoas.md`](pessoas.md)                         | State, City, People, Contact, Address                                                                                |
| [`servicos.md`](servicos.md)                       | Services, ServiceProfessional                                                                                        |
| [`agenda.md`](agenda.md)                           | BusinessHours, AgendaBlock, Appointments                                                                             |
| [`recorrencias.md`](recorrencias.md)               | RecurringAppointment, RecurringDays                                                                                  |
| [`planos.md`](planos.md)                           | Plan, PlanItem, PlanPeriod, ClientPlan                                                                               |
| [`pagamentos.md`](pagamentos.md)                   | PaymentMethod, Payment                                                                                               |
| [`turmas.md`](turmas.md)                           | ClassGroup, ClassGroupDay, ClassSession                                                                              |
| [`anamnese.md`](anamnese.md)                       | Anamnese, AnamnesisTemplate, AnamnesisTemplateVersion, AnamnesisQuestion, Anamnesis, AnamnesisEntry, AnamnesisAnswer |
| [`portal-do-cliente.md`](portal-do-cliente.md)     | PortalVerification, PortalAccessLink, ClientAccount, PortalSession, PushSubscription, PortalSettings                 |
| [`mensagens.md`](mensagens.md)                     | ClientMessage, AutoMessage, MessageCampaign, AutoMessageLog, Notification                                            |
| [`categorias-produtos.md`](categorias-produtos.md) | ProductCategory, Product, StockMovement, ProductSale, ProductSaleItem                                                |

## Convenções

- Cada entidade é uma seção `##`, com atributos e relacionamentos.
- **Entidade nova:** entra no arquivo da área. Se não couber em nenhuma, cria-se um
  arquivo novo, com o mesmo nome usado em `business-rules/` quando a área existir
  lá, e ele entra na tabela acima.
- **Referência a uma entidade:** `docs/domain/<arquivo>.md`, seguido do nome da
  entidade (ex.: `domain/agenda.md, "Appointments"`).
