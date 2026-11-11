# Regras de negócio

As regras de funcionamento do sistema, divididas por área. Antes de alterar um
módulo, leia o arquivo da área dele (e os das áreas que ele toca).

| Arquivo                                            | Seções                                                                                                                                                                                |
| -------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| [`empresa-e-acesso.md`](empresa-e-acesso.md)       | Tipos de usuário, Empresas, Acessos e limites da empresa, Usuários e acesso, Senhas                                                                                                   |
| [`pessoas.md`](pessoas.md)                         | Pessoas, Contatos e endereços, Unicidade, Estados e cidades                                                                                                                           |
| [`servicos.md`](servicos.md)                       | Serviços                                                                                                                                                                              |
| [`agenda.md`](agenda.md)                           | Agendamentos, Status dos Agendamentos, Fuso horário, Horário de funcionamento, Bloqueio de horários                                                                                   |
| [`recorrencias.md`](recorrencias.md)               | Agendamentos recorrentes                                                                                                                                                              |
| [`planos.md`](planos.md)                           | Planos                                                                                                                                                                                |
| [`pagamentos.md`](pagamentos.md)                   | Pagamentos                                                                                                                                                                            |
| [`turmas.md`](turmas.md)                           | Turmas                                                                                                                                                                                |
| [`anamnese.md`](anamnese.md)                       | Anamnese                                                                                                                                                                              |
| [`portal-do-cliente.md`](portal-do-cliente.md)     | Portal do cliente, Avisos do app                                                                                                                                                      |
| [`mensagens.md`](mensagens.md)                     | Mensagens automáticas, Mensagens da clínica, Notificações                                                                                                                             |
| [`relatorios.md`](relatorios.md)                   | Carteira de clientes, Análise de recebíveis (antes "Contas a receber"), Relatório de agendamentos, Rankings, Relatório financeiro, Relatório de pacotes, Perfil do cliente, Dashboard |
| [`financeiro.md`](financeiro.md)                   | Comissão, Categorias de despesa, Contas a pagar                                                                                                                                       |
| [`categorias-produtos.md`](categorias-produtos.md) | Categorias de produto, Produtos                                                                                                                                                       |

## Convenções

- Cada arquivo agrupa seções `##` de uma mesma área; a seção é a unidade de regra.
- **Regra nova:** entra na seção da funcionalidade. Funcionalidade nova ganha uma
  seção no arquivo da área; se não couber em nenhuma, cria-se um arquivo novo e ele
  entra na tabela acima.
- **Referência a uma regra** (no código, nos documentos e nos prompts):
  `docs/business-rules/<arquivo>.md`, seguido do nome da seção quando o arquivo
  tem mais de uma (ex.: `business-rules/relatorios.md, "Rankings"`).
- As entidades, os atributos e os relacionamentos ficam em [`../domain/`](../domain/README.md);
  aqui ficam só as regras.
