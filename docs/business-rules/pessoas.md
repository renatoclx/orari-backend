# Regras de negócio: Pessoas

> Parte de [`business-rules/`](README.md). Clientes e profissionais, contatos, endereços e a base de estados e cidades.

## Pessoas

- Uma pessoa pertence à empresa do usuário que a cadastrou; a empresa não é informada no payload.
- Usuários só acessam pessoas da própria empresa. Pessoas de outra empresa respondem 404.
- Tipos de pessoa: cliente (`CLIENT`), funcionário (`EMPLOYEE`), profissional (`PROFESSIONAL`) e, desde 2026-11-10, **fornecedor** (`SUPPLIER`, favorecido das contas a pagar), todos com os mesmos campos. Cada tipo tem a sua funcionalidade em Acessos e limites (`clients`, `employees`, `professionals`, `suppliers`); a listagem sem tipo exige todas.
- Só o nome e o tipo da pessoa são obrigatórios; CPF e data de nascimento são opcionais, para qualquer tipo de pessoa. Assim um cliente pode ser cadastrado só com o nome e um telefone (contato).
- O documento da pessoa, quando informado, é um CPF válido, sem máscara. Só o **fornecedor** pode ter **CNPJ** (14 dígitos, válido; nos demais tipos: 400).
- Só o fornecedor tem **categoria principal** (`expenseCategoryId`, opcional): uma categoria de despesa ativa da empresa (400), usada para pré-preencher as contas a pagar dele; em outro tipo: 400. Se a pessoa deixar de ser fornecedor, a categoria sai. A listagem traz a categoria (`expenseCategory`).
- Pessoas podem ser filtradas por nome (busca parcial que ignora acentos e maiúsculas), por CPF (exato) e por tipo.
- A observação da pessoa é opcional, de texto livre, com até 1000 caracteres.
- O cadastro da pessoa pode trazer, de uma vez, um telefone principal, uma lista de contatos e uma lista de endereços (até 10 de cada). Pessoa, contatos e endereços são criados juntos: se qualquer parte falhar, nada é criado.
  - O telefone principal tem 10 ou 11 dígitos (DDD + número) e é gravado como o contato principal da pessoa, de tipo principal (`MAIN`). A lista de contatos é gravada à parte, em lote.
  - Contatos e endereços enviados seguem as mesmas validações dos cadastrados avulsos, sem informar o dono: ele é a pessoa criada.
  - O principal é definido apenas pela marca `isPrincipal`, sem relação com o tipo do contato. Quando o telefone principal é informado, nenhum contato da lista pode ser principal. Há no máximo um contato principal e um endereço principal.
  - Nenhum item é marcado como principal automaticamente.
  - Uma cidade inexistente em qualquer endereço recusa o cadastro inteiro (404), sem criar a pessoa.
  - Depois do cadastro, telefone, contatos e endereços são mantidos pelas rotas de contatos e endereços; a edição da pessoa não os altera.
- A listagem de pessoas traz ativas e excluídas (inativas): o status é derivado da data de exclusão (`deletedAt`). O filtro opcional `isActive` traz só as ativas (`true`) ou só as inativas (`false`).
- Uma pessoa excluída continua na listagem e pode ser consultada (`GET /people/:id`, só leitura, com o `deletedAt`; ex.: o histórico do cliente), mas não pode ser editada nem excluída de novo (404), nem ser usada em agendamentos.
- Uma pessoa excluída pode ser reativada. A reativação é recusada quando a pessoa não existe (404), já está ativa (409) ou quando o CPF dela está em uso por outra pessoa ativa da empresa (409). Ao reativar, os contatos e endereços dela voltam a ser acessíveis.
- A foto da pessoa é opcional e enviada por uma rota própria, em JPEG ou PNG, com até 2 MB. O formato é conferido pelo conteúdo do arquivo, e não só pela extensão.
- O caminho da foto (`photoUrl`) é preenchido pelo sistema; não é informado no cadastro nem na edição da pessoa.
- Enviar uma nova foto substitui a anterior, que é apagada. A foto também pode ser removida.
- A exclusão (lógica) da pessoa mantém a foto.
- **Acesso à foto:** a API devolve a foto num link assinado (`photoUrl` com `?exp=…&sig=…`), que vale até o fim da hora seguinte. Sem assinatura, com assinatura adulterada ou vencida, o `/uploads` responde 403. O banco guarda o caminho puro; cada resposta traz um link novo. A logo da empresa (`/uploads/companies`) é pública: aparece no portal e no login.

## Clientes do profissional (app)

- `GET /professional-app/clients?search=&page=` lista os clientes do **próprio profissional** (o do vínculo do usuário; `professionalId` na consulta é recusado, 400): clientes **ativos** com ao menos um agendamento **não cancelado** com ele, a mesma regra da Carteira de clientes. Ordem alfabética, 10 por página (`limit` até 100), busca pelo nome sem acento nem caixa. Cada item: `id`, `name`, `photoUrl` (assinada), `phone` (celular do contato principal), `lastCompleted` (`startAt` e `serviceName`) e `nextAt`.
- `GET /professional-app/clients/:id`: o mesmo cliente com o `history`, os 50 atendimentos mais recentes **dele** com esse cliente (horário, status, observação, encaixe, serviço com preço, origem e se foi em turma). Cliente que não é da carteira dele, ou inexistente: 404.
- Não saem por estas rotas: pagamento, anamnese, e-mail, CPF, endereço, nascimento nem a conta do app.

## Contatos e endereços

- Contatos e endereços pertencem a exatamente um dono: uma empresa ou uma pessoa, nunca ambos.
- O dono precisa ser a empresa do usuário ou uma pessoa dela; caso contrário, responde 404.
- O dono é definido na criação e não pode ser alterado.
- Usuários só acessam contatos e endereços da própria empresa e de suas pessoas.
- Contatos e endereços de uma pessoa excluída deixam de ser acessíveis junto com ela.
- Um contato deve ter ao menos um meio de contato: telefone e/ou e-mail. Uma edição não pode remover o último deles.
- Cada dono tem no máximo um contato principal e um endereço principal (`isPrincipal`), considerando apenas os registros não excluídos.
- Marcar um contato ou endereço como principal desmarca automaticamente o principal anterior do mesmo dono.
- Excluir o principal não promove outro: o dono fica sem principal até que um seja marcado.
- A listagem de pessoas traz o contato principal de cada uma (`principalContact`); o detalhe da pessoa traz também o endereço principal (`principalAddress`). Sem principal marcado, o campo vem `null`.

## Unicidade

- São únicos:
  - o documento (CPF ou CNPJ) e o subdomínio da empresa;
  - entre os registros não excluídos, o e-mail do usuário;
  - entre os registros não excluídos, o documento da pessoa dentro da mesma empresa, quando informado.
- E-mails e documentos de registros excluídos podem ser reutilizados.

## Estados e cidades

- Estados e cidades são mantidos via seed (base do IBGE) e são somente leitura pela API.
- A busca de cidades por nome é parcial e ignora acentos e maiúsculas (ex.: "sao paulo" encontra "São Paulo"). A mesma regra vale para as buscas por nome de pessoas, serviços e métodos de pagamento.
