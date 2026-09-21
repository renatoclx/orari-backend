# Guias de revisão

Um arquivo por funcionalidade, para revisar o código sem precisar reconstruir o
contexto. Cada guia traz: o que a funcionalidade faz, as regras em resumo, onde
elas estão no código, quais testes as cobrem, em qual PR revisar e **o que
merece atenção** — incluindo decisões discutíveis.

> As regras normativas ficam no [`business-rules.md`](../business-rules.md).
> Aqui elas aparecem resumidas, com o ponteiro para o código.

## Ordem de revisão

As PRs são encadeadas: cada uma tem como base a anterior e mostra só a sua fatia.

| PR | Branch | Guia |
| -- | ------ | ---- |
| 1 | `chore/ci-e-deps` | [13 – Dados, seed e ambiente](13-dados-seed-e-ambiente.md) |
| 2 | `feat/schema-e-migrations` | [13 – Dados, seed e ambiente](13-dados-seed-e-ambiente.md) |
| 3 | `feat/common` | [00 – Convenções transversais](00-convencoes-transversais.md) |
| 4 | `feat/company-e-usuarios` | [01 – Autenticação](01-autenticacao-e-autorizacao.md), [02 – Empresas](02-empresas.md), [03 – Usuários](03-usuarios.md) |
| 5 | `feat/entidades-base` | [04 – Pessoas](04-pessoas.md), [05 – Contatos e endereços](05-contatos-e-enderecos.md), [12 – Estados e cidades](12-estados-e-cidades.md) |
| 6 | `feat/agenda` | [06 – Serviços](06-servicos.md), [07 – Horário de funcionamento](07-horario-de-funcionamento.md), [08 – Agendamentos](08-agendamentos.md), [09 – Recorrentes](09-agendamentos-recorrentes.md) |
| 7 | `feat/pagamentos` | [11 – Pagamentos](11-pagamentos.md) |
| 8 | `feat/notificacoes-e-demo` | [10 – Notificações](10-notificacoes.md), [13 – Dados, seed e ambiente](13-dados-seed-e-ambiente.md) |
| 9 | `docs/regras-e-resumo` | documentação |
| 10 | `chore/prompts` | fluxo de trabalho |

## Índice

| # | Funcionalidade | Resumo |
| - | -------------- | ------ |
| 00 | [Convenções transversais](00-convencoes-transversais.md) | Escopo por empresa, 404 × 403, paginação, exclusão lógica, validadores |
| 01 | [Autenticação e autorização](01-autenticacao-e-autorizacao.md) | Login, JWT, guards, tipos de usuário |
| 02 | [Empresas](02-empresas.md) | Cadastro, inativação, CNPJ, fuso |
| 03 | [Usuários](03-usuarios.md) | CRUD, alcance por tipo, senha |
| 04 | [Pessoas](04-pessoas.md) | Clientes, profissionais e funcionários; CPF |
| 05 | [Contatos e endereços](05-contatos-e-enderecos.md) | Dono exclusivo (empresa ou pessoa) |
| 06 | [Serviços](06-servicos.md) | Preço, duração e inativação |
| 07 | [Horário de funcionamento](07-horario-de-funcionamento.md) | Janelas por dia da semana e fuso |
| 08 | [Agendamentos](08-agendamentos.md) | Conflito de horário, status, data futura |
| 09 | [Agendamentos recorrentes](09-agendamentos-recorrentes.md) | Geração, regeração e extensão manual |
| 10 | [Notificações](10-notificacoes.md) | Aviso de horizonte da recorrência |
| 11 | [Pagamentos](11-pagamentos.md) | Um por agendamento, status e valor |
| 12 | [Estados e cidades](12-estados-e-cidades.md) | Somente leitura, base do IBGE |
| 13 | [Dados, seed e ambiente](13-dados-seed-e-ambiente.md) | Schema, migrations, seeds e execução |
