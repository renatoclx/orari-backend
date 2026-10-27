# Regras de Negócio

## Tipos de usuário

- **SUPER_ADMIN**: Cadastra, edita, inativa e reativa empresas, e gerencia usuários de qualquer empresa ativa.
- **ADMIN**: administra a própria empresa. Gerencia os usuários dela.
- **USER**: opera os dados da própria empresa (pessoas, contatos e endereços), sem gerenciar usuários.

## Empresas

- Apenas SUPER_ADMIN cadastra e edita os dados cadastrais das empresas (razão social, documento, data de fundação, subdomínio, fuso e status).
- O ADMIN (e o SUPER_ADMIN, para a própria empresa) altera, na própria empresa, somente o nome fantasia e a logo. A empresa vem do token, nunca da URL. O USER não altera nada. O nome fantasia tem até 100 caracteres; texto vazio ou nulo o remove, e então a razão social passa a ser o nome exibido.
- A logo é opcional, em JPEG ou PNG, com até 2 MB; o formato é conferido pelo conteúdo do arquivo. É servida publicamente e o `logoUrl` guarda o caminho relativo. Enviar uma nova logo substitui a anterior, que é apagada; a logo também pode ser removida. Só se apaga do disco arquivo da pasta das logos: uma URL externa gravada no `logoUrl` pelo SUPER_ADMIN nunca é apagada.
- ADMIN e USER consultam apenas a própria empresa. O filtro por status (`isActive`) é exclusivo do SUPER_ADMIN.
- Uma empresa é criada ativa, salvo indicação contrária.
- Empresas não são excluídas: são inativadas.
- Enquanto uma empresa estiver inativa, seus dados relacionados ficam inacessíveis:
  - seus usuários não fazem login e perdem imediatamente o acesso, inclusive com tokens já emitidos;
  - o SUPER_ADMIN não lista, consulta nem cria usuários dessa empresa;
  - a própria empresa continua visível ao SUPER_ADMIN, para que possa ser reativada.
- Ao reativar a empresa, os dados voltam a ficar acessíveis.
- Um SUPER_ADMIN não pode inativar a própria empresa.
- O documento da empresa (`document`) é um CPF (11 dígitos) ou um CNPJ (14 caracteres), válido e sem máscara. O CNPJ pode ser numérico ou alfanumérico (letras são convertidas para maiúsculas). Quem não tem CNPJ usa o CPF, e a razão social passa a ser o nome da pessoa.
- A data de fundação é opcional: não se aplica a quem usa CPF.

## Usuários e acesso

- Todo usuário pertence a uma empresa, que não pode ser alterada.
- SUPER_ADMIN cria usuários informando a empresa, que deve estar ativa.
- ADMIN cria usuários sempre na própria empresa; informar outra empresa responde 403.
- ADMIN gerencia apenas usuários da própria empresa e não enxerga contas SUPER_ADMIN. Usuários fora do alcance respondem 404.
- Apenas SUPER_ADMIN pode criar contas SUPER_ADMIN ou promover alguém a esse tipo.
- Ninguém pode excluir a própria conta nem alterar o próprio tipo.
- O login é recusado para usuários excluídos e para usuários de empresas inativas, sempre com a mesma mensagem genérica de credenciais inválidas.
- Um usuário autenticado perde o acesso imediatamente quando é excluído ou quando sua empresa fica inativa.
- A exclusão é lógica (inativação): preenche o `deletedAt`. A listagem (`GET /users`) traz ativos e inativos; consultar, alterar, trocar a senha e excluir valem só para ativos (inativo responde 404).
- Um usuário inativado pode ser reativado por `PATCH /users/:id/restore` (limpa o `deletedAt`), pelos mesmos perfis e com o mesmo alcance da gestão de usuários. Reativar um usuário já ativo responde 409; se o e-mail dele estiver em uso por outro usuário ativo, também responde 409.
- Um usuário pode ser vinculado a um profissional (pessoa do tipo `PROFESSIONAL`, ativa e da mesma empresa); o vínculo é o que dá acesso às fichas de anamnese (ver Anamnese, em desenho).

## Senhas

- A senha deve ter entre 8 e 72 caracteres e ser confirmada no cadastro e na redefinição.
- A senha é armazenada apenas como hash (bcrypt) e nunca é retornada pela API.
- A senha não é alterada pela edição do usuário: SUPER_ADMIN ou ADMIN a redefinem por rota própria, sem precisar da senha atual, respeitando o alcance de cada um.
- Redefinir a senha encerra as sessões do usuário: os refresh tokens dele deixam de valer. O mesmo acontece ao inativar ou reativar o usuário.
- O login aceita até 5 tentativas por minuto do mesmo IP, e a renovação do token, até 20; acima disso, a API responde 429.

## Pessoas

- Uma pessoa pertence à empresa do usuário que a cadastrou; a empresa não é informada no payload.
- Usuários só acessam pessoas da própria empresa. Pessoas de outra empresa respondem 404.
- Só o nome e o tipo da pessoa são obrigatórios; CPF e data de nascimento são opcionais, para qualquer tipo de pessoa. Assim um cliente pode ser cadastrado só com o nome e um telefone (contato).
- O documento da pessoa, quando informado, é um CPF válido, sem máscara.
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

## Serviços

- Um serviço pertence à empresa do usuário que o cadastrou; a empresa não é informada no payload.
- O nome do serviço é único entre os serviços não excluídos da mesma empresa.
- A duração é informada em minutos e é o que define o fim dos agendamentos desse serviço.
- Serviços inativos não podem ser usados em novos agendamentos nem em recorrências.
- A cor (`color`), quando informada, deve ser uma string hexadecimal válida (`#RGB` ou `#RRGGBB`).
- Um serviço só pode ser excluído se não tiver nenhum relacionamento: agendamentos, agendamentos recorrentes ou itens de plano. Contam todos os registros, inclusive cancelados ou encerrados, porque o histórico precisa continuar apontando para o serviço.
- Com relacionamento, a exclusão é recusada (409), nada é alterado, e o caminho é inativar o serviço (`isActive` falso). Serviço inexistente ou de outra empresa responde 404.
- Um plano não é excluído (só inativado), e os serviços de um plano editado deixam de ser seus itens: por isso um serviço que consta na composição de qualquer plano, ativo ou não, não pode ser excluído.

## Agendamentos

- Um agendamento pertence à empresa do usuário, e cliente, profissional e serviço precisam ser dessa mesma empresa.
- O `clientId` precisa ser uma pessoa do tipo `CLIENT`, e o `professionalId`, do tipo `PROFESSIONAL`.
- O fim (`endAt`) é sempre calculado somando a duração do serviço ao início; não é aceito no payload.
- Não pode haver sobreposição de horário para o mesmo profissional nem para o mesmo cliente. Horários que apenas se encostam (fim de um igual ao início do outro) são permitidos.
- Agendamentos cancelados não ocupam horário e liberam a agenda.
- Não há exclusão de agendamento: o ciclo de vida é controlado pelo status (`SCHEDULED`, `CONFIRMED`, `COMPLETED`, `CANCELLED`, `NO_SHOW`), e um agendamento novo começa como `SCHEDULED`.
- Não é possível agendar em data e hora que já passaram, nem remarcar um agendamento para o passado. Alterar status ou observação de um agendamento já realizado continua permitido, exceto cancelá-lo e exceto quando ele está concluído com pagamento.
- Um agendamento só pode ser cancelado antes de iniciar: em `SCHEDULED` ou `CONFIRMED` e com início ainda no futuro. Vale o horário, e não só o status, porque o status é atualizado periodicamente e um agendamento que já começou pode ainda constar como agendado ou confirmado.
- Não podem ser cancelados: o que já iniciou ("Agendamento que já iniciou não pode ser cancelado"), o concluído, aquele em que o cliente não compareceu e o já cancelado. Nesses casos nada é alterado. A regra vale também quando o cancelamento vem junto com outras alterações, considerando o estado do agendamento antes delas. Se o agendamento mudar de situação entre a leitura e a gravação (ex.: o job de status o inicia no mesmo instante), o cancelamento é recusado com 409 e nada é alterado.
- Ao cancelar um agendamento avulso, o pagamento dele ainda `PENDING` também é cancelado; o pagamento `PAID` não muda (não há reembolso).
- Um agendamento concluído que tem pagamento (pendente ou pago) não sofre mais nenhuma alteração: nem observação, nem status, nem serviço, cliente ou horário (400). O pagamento foi gerado a partir dele, e mudar o agendamento o deixaria divergente. Pagamento cancelado ou excluído libera a edição. Agendamento de plano não tem pagamento próprio e não é travado por esta regra.
- `CANCELLED` é o estado final do agendamento: um agendamento cancelado não volta a nenhum outro status (400). Para marcar de novo, cria-se outro agendamento. A observação de um cancelado continua editável.
- O agendamento precisa caber inteiro em uma janela de atendimento da empresa (ver "Horário de funcionamento"), exceto quando é um encaixe autorizado. Cancelar um agendamento não passa por essa verificação.
- Toda resposta de agendamento (listagem, consulta, criação e alteração) traz, além dos códigos, o cliente e o profissional (`id`, `name`, `photoUrl`) e o serviço (`id`, `name`, `color`, `duration`), e nenhum outro dado deles.
- Uma pessoa ou serviço excluídos depois continuam aparecendo com o nome nos agendamentos que já os usavam: o histórico não perde o nome.
- A listagem é ordenada pelo início do agendamento, do mais antigo para o mais novo; com `order=desc`, do mais novo para o mais antigo (ex.: atendimentos anteriores do cliente). Horários iguais seguem uma ordem fixa, na mesma direção, para a paginação não repetir nem perder registros.
- A resposta do agendamento informa a origem: `recurringAppointment` com o `id` da recorrência e o `clientPlanId` (preenchido quando ela é de um pacote), ou nulo no agendamento avulso.
- A listagem de agendamentos pode ser filtrada por recorrência (as sessões de uma recorrência ou de um pacote), mantendo a ordem, a paginação e o escopo da empresa. Sem o filtro, nada muda.
- A agenda de um dia usa o período `from` e `to` (início incluído, fim excluído) com instantes em UTC: o início do dia e o início do dia seguinte, no fuso da empresa.

## Fuso horário

- Cada empresa tem um fuso (`timezone`, padrão `America/Sao_Paulo`).
- Todos os instantes são gravados em UTC. O fuso é usado para interpretar horários "de relógio": janelas de atendimento e horários reservados por recorrências.
- Datas puras, como início e fim de uma recorrência, valem pelo calendário e não sofrem conversão de fuso.

## Horário de funcionamento

- Cada empresa define janelas de atendimento por dia da semana, e pode ter mais de uma no mesmo dia (ex.: manhã e tarde), desde que não se sobreponham.
- Dias sem janela cadastrada são considerados fechados.
- Enquanto a empresa não cadastrar nenhuma janela, o horário não é restringido: a regra passa a valer a partir do primeiro cadastro.
- Um atendimento precisa começar e terminar dentro da mesma janela.
- `POST /business-hours/batch` cadastra várias janelas de uma vez (ex.: a semana inteira no setup da empresa). É tudo ou nada: valem as mesmas regras do cadastro individual, tanto contra janelas já existentes quanto entre os itens do próprio lote.
- Encaixe de agendamentos:
  - O expediente do dia são as janelas de atendimento cadastradas. Estar "fora do funcionamento" é não caber inteiro em uma janela, e inclui antes da abertura, depois do fechamento, dias sem janela e o intervalo entre duas janelas (almoço, por exemplo). O intervalo não tem regra própria: é só um horário fora de qualquer janela.
  - Agendamentos sem recorrência podem ser feitos nos horários em que a empresa estiver fechada, inclusive em dias sem janela e no intervalo entre janelas.
  - Um atendimento que começa dentro de uma janela e termina fora dela (ex.: 17:30 às 18:30, com fechamento às 18:00) também não cabe em uma janela: com a autorização, é marcado como encaixe.
  - O encaixe precisa ser autorizado no pedido (`overBooking: true`). Sem a autorização, um horário fora do funcionamento continua recusado, para um erro de horário não virar encaixe sem ninguém perceber.
  - O agendamento registra se é encaixe (`overBooking`). O valor registrado é o real: um pedido autorizado em horário dentro do funcionamento não fica marcado como encaixe.
  - O registro é o retrato do momento em que o agendamento foi marcado: mudar depois o horário de funcionamento não o altera.
  - O encaixe libera só o horário de funcionamento: continuam valendo a ausência de conflito para cliente e profissional e a proibição de horário no passado.
  - Ao remarcar um agendamento (mudar horário ou serviço), o encaixe é reavaliado: levar para fora do funcionamento exige a mesma autorização, e trazer de volta para dentro desfaz a marcação. Mudar só status ou observação não altera a marcação.
  - Enquanto a empresa não cadastrar nenhuma janela, nada é restringido e não há encaixe.
  - Agendamentos de recorrência e de plano, inclusive o remanejamento deles, não têm encaixe: continuam precisando caber em uma janela.

## Agendamentos recorrentes

- Valem as mesmas regras de empresa, tipos de pessoa e serviço ativo dos agendamentos.
- A recorrência precisa de ao menos um dia; cada dia tem dia da semana, horário inicial e final, e o fim deve ser posterior ao início.
- Dois dias da mesma recorrência não podem se sobrepor no mesmo dia da semana.
- A data final é obrigatória e não pode ser anterior à inicial.
- Não há limite de duração entre a data inicial e a final (ex.: uma recorrência de um ano); o prazo é definido por quem cria a recorrência. A data final não pode ser anterior à inicial.
- Todos os agendamentos e pagamentos do período são gerados na criação: uma recorrência longa gera muitos registros de uma vez.
- Informar a lista de dias em uma edição substitui todos os dias anteriores.
- Não há exclusão: a recorrência é desativada por `isActive`.
- Cada dia precisa reservar ao menos a duração do serviço, que é o que define o fim dos agendamentos gerados.

### Geração de agendamentos

- Ao criar uma recorrência ativa, os agendamentos são gerados até a data final. Ocorrências no passado não são geradas.
- Os agendamentos gerados seguem todas as regras de um agendamento avulso: janela de atendimento e ausência de conflito para cliente e profissional.
- A criação é tudo ou nada: se qualquer ocorrência conflitar, a recorrência não é criada.
- O erro informa a data e o horário, no fuso da empresa, da ocorrência que impediu a criação (a primeira encontrada), seja conflito de agenda do profissional ou do cliente, seja horário fora do funcionamento. Ex.: "Conflito em 28/10/2026 às 09:00: O profissional já possui um agendamento neste horário". Vale também na contratação de plano, que cria as agendas da mesma forma.
- Toda resposta de recorrência (listagem, consulta, criação e edição) traz, além dos códigos, o cliente e o profissional (`id`, `name`, `photoUrl`), o serviço (`id`, `name`, `color`, `duration`) e o `clientPlanId` (preenchido quando a recorrência é de um pacote). Pessoa ou serviço excluídos depois continuam aparecendo com o nome.
- A agenda de uma recorrência não é regenerada. Para mudar dias, período, serviço, cliente ou profissional, encerra-se a recorrência e cria-se outra.
- Alterar apenas a observação não mexe na agenda.
- Cancelar a recorrência (`isActive` = falso) cancela os agendamentos futuros em `SCHEDULED` ou `CONFIRMED`, sem gerar novos, e seus pagamentos `PENDING` passam para `CANCELLED` (ver Cancelamento). Uma recorrência cancelada não é reativada.

### Valor e pagamento

- O valor de cada agendamento é o preço vigente do serviço no momento da criação da recorrência. Não há descontos.
- Um serviço sem preço não pode ser usado em uma recorrência.
- A recorrência não é fidelização nem pacote.
- Cada agendamento gerado tem um pagamento `PENDING`, com vencimento na data do agendamento.
- O cliente pode optar por pagar integralmente a recorrência, somente na contratação e sem desconto. Os pagamentos continuam nascendo `PENDING`; a baixa para `PAID` é feita pagamento a pagamento ou de uma vez, em lote, com o mesmo método de pagamento.

### Remanejamento

- O cliente pode remanejar agendamentos da recorrência para outros dias e horários. Remanejar é remarcar o mesmo agendamento, que mantém seu pagamento.
- Remanejar só é permitido desde que:
  - a quantidade de serviços contratados seja mantida;
  - a nova data, no calendário da empresa, fique entre a data inicial e a final da recorrência;
  - haja dia e horário disponíveis, pelas regras de agendamento.
- Só agendamentos `SCHEDULED` ou `CONFIRMED` que ainda não iniciaram (início no futuro) podem ser remanejados, e o status não muda. Vale o horário, e não só o status, porque o status é atualizado periodicamente. Uma recorrência cancelada não tem agendamentos remanejados.
- Data, serviço, cliente e profissional de um agendamento de recorrência não mudam pela edição comum do agendamento; data e horário mudam só pelo remanejamento. Observação e os demais status continuam editáveis.
- Se o pagamento do agendamento estiver `PENDING`, o vencimento passa para a nova data.
- Remanejar não gera nova cobrança nem reembolso.

### Cancelamento

- Um único agendamento da recorrência pode ser cancelado pela própria recorrência, com a mesma regra do agendamento avulso: só antes de iniciar (`SCHEDULED` ou `CONFIRMED` com início no futuro). O horário fica livre e o pagamento `PENDING` dele passa para `CANCELLED`. Pagamento já pago não muda. Esse cancelamento não é feito pela edição comum do agendamento.
- Cancelar a recorrência não gera reembolso de pagamentos já pagos.
- Os pagamentos `PENDING` dos agendamentos futuros cancelados passam para `CANCELLED`.
- Após o cancelamento, as novas datas negociadas diretamente com a empresa passam a ser agendamentos avulsos.

## Planos

### Catálogo de planos

- Um plano pertence à empresa do usuário que o cadastrou; a empresa não é informada no payload.
- O nome do plano é único entre os planos da mesma empresa.
- Um plano é o pacote de serviços; os períodos (ex.: 3, 6 ou 12 meses) são opções de contratação do mesmo plano.
- Um plano é composto por um ou mais serviços da própria empresa, ativos no momento do cadastro ou da edição.
- Um serviço não pode aparecer mais de uma vez no mesmo plano.
- Cada serviço do plano define `sessionsPerWeek`, a quantidade de atendimentos por semana (inteiro de 1 a 7, obrigatório). O cadastro e a edição recebem `services: [{ serviceId, sessionsPerWeek }]`.
- Os serviços e os períodos de um plano podem ser editados; a lista informada substitui a anterior. Contratações já feitas não mudam.
- O valor mensal do plano (`monthlyPrice`) é definido pela empresa no cadastro e não depende dos preços dos serviços.
- Não há exclusão: o plano é desativado por `isActive` e pode ser reativado.
- Planos inativos não podem ser contratados.
- Um plano pode ser cadastrado sem períodos, mas só pode ser contratado se tiver ao menos um.
- Um plano com algum serviço inativo não pode ser contratado.

### Descontos por período

- Cada plano define, por período (ex.: 3, 6 ou 12 meses), dois percentuais fixos de desconto, ambos obrigatórios:
  - `discountPercent`: para pagamento integral (uma única cobrança do total do período);
  - `monthlyDiscountPercent`: para pagamento mensal.
- O número de meses é inteiro, a partir de 1, e não se repete no mesmo plano.
- Os percentuais vão de 0 a 100, com até duas casas decimais.
- No pagamento integral, o total do período é o valor mensal × número de meses, com `discountPercent` aplicado.
- No pagamento mensal, cada parcela é o valor mensal com `monthlyDiscountPercent` aplicado, e o total é a parcela × número de meses.
- Os valores são arredondados para duas casas decimais, com a metade arredondada para cima. No mensal, a parcela é arredondada antes de calcular o total, para que a soma das parcelas feche com o total.
- Alterar os percentuais de um plano não altera contratações já feitas.

### Serviços e horários

- Cada serviço do plano tem seus próprios dias, horários e profissional, informados na contratação. A contratação informa exatamente os serviços do plano, nem mais nem menos.
- A agenda de cada serviço precisa ter exatamente `sessionsPerWeek` horários por semana (cada item de `days` é um atendimento semanal; o mesmo dia pode ter dois horários que não se sobrepõem). Quantidade diferente é recusada (400), com a mensagem indicando o serviço e a quantidade prevista.
- A frequência vale só no momento da contratação: as recorrências guardam os dias, então alterar o plano depois não muda contratações já feitas.
- Cada serviço gera uma recorrência própria, com o período da contratação. Seus agendamentos seguem todas as regras de agendamentos recorrentes.
- Os agendamentos de um plano podem ser remanejados dentro do período da contratação, e um agendamento pode ser cancelado individualmente; a sessão cancelada não é reposta.
- Reposição por falta: quando o cliente não comparece a uma sessão do plano e a empresa a marca como `NO_SHOW`, a sessão pode ser remanejada para uma nova data dentro do período da contratação, desde que haja horário disponível (funcionamento da empresa, sem conflito). Ela volta a `SCHEDULED` e a quantidade de sessões do plano se mantém; o registro da falta deixa de existir, porque é a mesma sessão que muda de data. Só sessões `NO_SHOW` entram: concluídas e em andamento continuam não podendo ser remanejadas. A regra vale só para pacotes; recorrências avulsas seguem remanejando apenas antes de iniciar.
- A recorrência de um serviço do plano não é encerrada isoladamente: o encerramento acontece pelo cancelamento da contratação.

### Contratação

- Só podem ser contratados planos ativos, com o período escolhido cadastrado e com todos os serviços ativos. O cliente precisa ser do tipo `CLIENT`.
- Ao contratar um plano, são definidos a modalidade de pagamento (integral ou mensal) e o número de meses, que precisa corresponder a um período do plano. São congelados o valor mensal, o percentual de desconto aplicado conforme a modalidade e o total do período.
- A data de início é, por padrão, a data atual no fuso da empresa. Pode ser futura, mas não passada. A agenda nunca começa antes dela, inclusive à noite, quando em UTC já é o dia seguinte.
- A data final é a data de início somada ao número de meses, menos um dia (ex.: 3 meses a partir de 15/10 terminam em 14/01).
- A contratação, as recorrências dos serviços e os pagamentos são criados juntos: se qualquer horário conflitar, nada é gravado.
- Alterar preços de serviços ou o plano depois da contratação não altera o valor da contratação.
- Ao fim do período contratado, a continuidade exige uma nova contratação, como nas recorrências.

### Consulta das contratações

- As respostas de contratação (listagem, consulta, criação e cancelamento) trazem o cliente (`id`, `name`, `photoUrl`), o plano (`id`, `name`) e, em cada recorrência, o serviço, o profissional, os dias (`weekDay`, `startTime`, `endTime` em HH:MM) e `isActive`. Os ids continuam planos. Cliente, plano, serviço ou profissional excluídos ou inativados depois continuam aparecendo com o nome.
- A listagem aceita o filtro opcional `status`, com "hoje" no fuso da empresa: `active` (não cancelada e com data final de hoje em diante, inclusive as que ainda vão começar), `cancelled` (com data de cancelamento) e `ended` (não cancelada e com data final anterior a hoje). Sem o filtro, todas são listadas.
- A listagem vem da contratação mais recente para a mais antiga (data de criação decrescente).

### Troca de serviços

- O plano fecha o contrato com os serviços contratados: não há troca de serviço durante a contratação.

### Pagamento da contratação

- A contratação tem uma modalidade: **integral** ou **mensal**.
- Na modalidade integral, é gerado um único pagamento com o valor total do período. O sistema registra apenas esse valor total, sem o número de parcelas nem os juros do cartão. O meio de pagamento (ex.: cartão) é um método de pagamento da empresa.
- Na modalidade mensal, é gerado um pagamento por mês contratado, cada um com o valor da parcela.
- Os pagamentos de uma contratação pertencem à contratação, não a um agendamento.
- O vencimento é definido na contratação por uma data de primeiro vencimento, obrigatória no mensal e opcional no integral. No integral, é o vencimento do pagamento único; no mensal, é o da primeira parcela, e as seguintes vencem no mesmo dia dos meses seguintes. Quando o dia não existe no mês, vale o último dia do mês. No integral sem essa data, o pagamento fica sem vencimento.
- Os pagamentos da contratação nascem `PENDING` e sem método de pagamento; a baixa para `PAID` é manual.
- Um pagamento pendente cujo vencimento é anterior à data atual, no fuso da empresa, consta como **atrasado**. O status do pagamento continua `PENDING` até ser pago.

### Cancelamento da contratação

- O cancelamento não gera multa nem reembolso, em qualquer modalidade.
- A contratação cancelada registra a data do cancelamento e não pode ser cancelada de novo (também quando dois cancelamentos chegam ao mesmo tempo: só o primeiro vale). Uma contratação cujo período já terminou não pode ser cancelada.
- Ao cancelar a contratação, as recorrências de todos os serviços do plano são encerradas, e os agendamentos futuros em `SCHEDULED` ou `CONFIRMED` passam para `CANCELLED`; os horários voltam a ficar disponíveis.
- Na modalidade mensal, as parcelas `PENDING` com vencimento na data do cancelamento ou depois passam para `CANCELLED`. As parcelas atrasadas continuam `PENDING`, e as pagas não mudam.
- Na modalidade integral, o pagamento não muda: ele é feito no ato da contratação.

## Notificações

- São avisos por empresa, criados e resolvidos pela própria API; não são criadas nem excluídas pelo cliente.
- Uma notificação pode ser marcada como lida. Ao ser resolvida, sai da lista padrão, mas continua no histórico.

## Pagamentos

- Cada agendamento tem no máximo um pagamento. Excluir o pagamento libera o agendamento para um novo.
- O pagamento pertence à empresa do usuário, assim como o agendamento e o método de pagamento. O agendamento não muda depois da criação.
- Todo pagamento pertence a um agendamento ou a uma contratação de plano, nunca aos dois.
- Um pagamento gerado pelo sistema nasce como `PENDING` e sem método de pagamento; a baixa para `PAID` é manual.
- O método de pagamento é opcional enquanto o pagamento não está `PAID`, e obrigatório quando está.
- Quando o valor não é informado, assume o preço do serviço do agendamento. Se o serviço não tiver preço, o valor passa a ser obrigatório. Valores diferentes do preço continuam permitidos.
- `paidAt` é obrigatório quando o status é `PAID` e recusado nos demais status. Sair de `PAID` limpa a data.
- O nome do método de pagamento é único entre os métodos não excluídos da mesma empresa, sem diferenciar maiúsculas nem acentos ("PIX" e "Pix" são o mesmo método).
- A exclusão do método de pagamento é lógica (inativação). A listagem (`GET /payment-methods`) traz ativos e inativos; com `isActive=true`, só os ativos (ex.: escolher o método na baixa de um pagamento). Consultar, alterar, excluir e usar na baixa valem só para ativos.
- Um método inativado pode ser reativado por `PATCH /payment-methods/:id/restore` (limpa o `deletedAt`). Reativar um método já ativo responde 409; se o nome estiver em uso por outro método ativo da empresa, também responde 409.
- A listagem de pagamentos (`GET /payments`) traz a origem de cada um, para a tela descrevê-lo: o atendimento (`appointment`, com a data, o serviço e o `recurringAppointmentId`, nulo no avulso) ou a contratação (`clientPlan`, com o nome do plano e a modalidade `billingType`). Traz também o cliente (`client`: o do atendimento ou o da contratação) e o método de pagamento (`paymentMethod`, preenchido quando pago). Cliente, serviço e plano são lidos pela chave, sem filtrar exclusão: o nome continua aparecendo depois de inativados. A ordem é o vencimento crescente, com os sem vencimento no fim, e os filtros combinam entre si (ex.: `status=PENDING&overdue=true`).
- `GET /payments/summary` devolve os totais da tela de Pagamentos, cada um com `total` (texto com duas casas) e `count`: `overdue` (pendentes com vencimento antes de hoje, no fuso da empresa), `upcoming` (pendentes com vencimento de hoje em diante ou sem vencimento) e `paid` (pagos). Cancelados e excluídos ficam de fora. Só `clientId`, `dueFrom` e `dueTo` filtram; `status` e os demais filtros da listagem são recusados (400). Com período, os três usam o vencimento nele (inclusive os pagos) e o pagamento sem vencimento não entra.
- A baixa (`PATCH /payments/settle` e a baixa em lote da recorrência) e a criação de um pagamento (`POST /payments`) não aceitam `paidAt` no futuro (400, comparando com o instante da requisição). Data passada é aceita, para lançar uma baixa esquecida. A edição de um pagamento (`PATCH /payments/:id`) não tem essa checagem.
- Quando um agendamento avulso (não gerado por recorrência ou contratação de plano) passa para o status `COMPLETED`, gera um novo pagamento como `PENDING` para aquele agendamento, seja a conclusão feita pelo job de status ou manualmente.
- Cancelar um agendamento avulso cancela o pagamento `PENDING` dele (ex.: um sinal lançado antes do atendimento); o `PAID` não muda.
- Não é possível registrar pagamento para um agendamento cancelado (409): não há atendimento a cobrar.
- Não é possível registrar pagamento para uma sessão de pacote (409): ela já é cobrada pela contratação. Agendamento de recorrência avulsa continua aceitando um novo pagamento quando o anterior foi excluído.
- `CANCELLED` é o estado final do pagamento: um pagamento cancelado não volta a `PENDING` nem vai para `PAID` (409). Repetir `CANCELLED` é aceito, sem efeito, e os demais campos (ex.: valor) continuam editáveis.
  - O pagamento é gerado por um job de cobrança, que roda periodicamente; pode haver alguns minutos entre a conclusão e o pagamento.
  - O valor é o preço do serviço, e o vencimento é a data do agendamento no fuso da empresa.
  - Serviço sem preço é considerado gratuito e não gera pagamento.
  - Um agendamento que já teve pagamento, inclusive excluído, não gera outro.
- Agendamentos gerados por recorrência já nascem com pagamento `PENDING`, com vencimento na data do agendamento, e não geram novo pagamento ao serem concluídos (ver Agendamentos recorrentes).
- Agendamentos gerados por contratação de plano não geram pagamento por agendamento: os pagamentos pertencem à contratação (ver Planos).
  - Esses pagamentos deverão ser registrados como `PENDING`, onde deverá ser alterado manualmente para `PAID` quando este for pago;

### Comandas do dia (Financeiro)

- `GET /payments/checkouts` lista as comandas do dia, uma por cliente, a partir das visitas. "Dia" é hoje no fuso da empresa.
- Tem comanda o cliente que tem um atendimento que começa hoje em `SCHEDULED`, `CONFIRMED`, `IN_PROGRESS` ou `COMPLETED` (cancelado e não comparecimento ficam de fora), ou que tem algum pagamento `PAID` com `paidAt` hoje (a comanda paga continua na lista). Cliente só com pendência, sem atendimento nem pagamento hoje, não entra. Pessoa inativada continua aparecendo.
- A paginação é por cliente, em ordem alfabética, e `search` filtra pelo nome do cliente sem diferenciar acentos nem maiúsculas.
- Cada comanda traz: `appointments` (os atendimentos de hoje, por horário, com serviço, profissional, `recurringAppointmentId`, `clientPlanId` quando é sessão de pacote e `payment`, que é o pagamento do atendimento ou `null` quando ainda não existe, como na sessão de pacote); `previousPayments` (pagamentos do cliente, de atendimento ou de contratação, que não são dos atendimentos listados: `PENDING` com vencimento até hoje, inclusive; `PENDING` de contratação integral sem vencimento; e `PAID` hoje, por vencimento crescente e sem vencimento por último, cada um com a origem); e os totais em texto com duas casas.
- Totais: `todayPending` (pendentes dos atendimentos de hoje), `previousPending` (pendentes dos anteriores) e `paidToday` (pagos hoje, nas duas listas). Um atendimento de hoje já pago em outro dia aparece com o pagamento pago, mas não entra em nenhum total. Pagamentos `CANCELLED` e excluídos nunca entram em lista nem total.
- `PATCH /payments/settle` dá baixa nos pagamentos escolhidos (`paymentIds`, ao menos um, sem repetir), com um `paymentMethodId` e `paidAt` opcional (padrão: o momento da requisição), tudo numa só transação. Todos precisam ser da empresa, não excluídos, `PENDING` e do mesmo cliente: inexistente (pagamento ou método) responde 404, algum fora de `PENDING` responde 409 e clientes diferentes respondem 400. O método precisa existir (não excluído) na empresa.

## Anamnese

> **Em desenho:** estas regras descrevem o que será implementado. Ainda não valem na API.
> O item marcado com **(adiado)** fica para uma atualização futura da funcionalidade.

A anamnese guarda **dados de saúde**, que a LGPD trata como dados pessoais sensíveis. Por
isso o acesso é restrito, as respostas são criptografadas e toda ação fica registrada.

### Modelos de ficha

- Um modelo pertence à empresa do usuário que o cadastrou; a empresa não é informada no payload.
- O nome do modelo é obrigatório e único entre os modelos da mesma empresa, sem diferenciar maiúsculas nem acentos.
- Não há exclusão: o modelo é inativado (`isActive`) e pode ser reativado. Um modelo inativo não inicia novas fichas; as fichas já existentes continuam acessíveis e recebendo acompanhamentos.
- Cada modelo tem **versões** numeradas a partir de 1. Criar o modelo cria a versão 1. Editar as perguntas cria uma nova versão (a lista informada substitui a anterior). Uma versão existente nunca muda. Renomear ou inativar o modelo não cria versão.
- Quem cria, edita e inativa modelos é **somente o ADMIN**. Os profissionais consultam os modelos e os usam para preencher fichas.

### Perguntas

- Um modelo precisa de ao menos uma pergunta.
- A ordem das perguntas pode ser alterada no frontend antes de enviar para salvar.
- O texto da pergunta é obrigatório. O texto de ajuda é opcional.
- Tipos: texto curto, texto longo, sim ou não, escolha única, escolha múltipla, número, data e escala de 0 a 10.
- Escolha única e múltipla exigem ao menos 2 opções, sem repetir; os demais tipos não aceitam opções.
- A pergunta de sim ou não pode ter um texto de detalhe (ex.: "Qual?"); o detalhe só vale quando a resposta é "sim".
- Cada pergunta é obrigatória ou opcional.
- Limites: texto da pergunta até 400 caracteres, ajuda até 500, opção até 100, até 100 perguntas por modelo, resposta de texto até 5.000 caracteres e evolução até 10.000.
- Não há perguntas condicionais, anexos nem imagens nesta versão.

### Fichas e acompanhamentos

- Existe **uma ficha por cliente e por modelo**. O cliente deve ser do tipo `CLIENT` e estar ativo; o modelo deve estar ativo.
- Criar a ficha é gravar o **registro inicial**, com as respostas. A ficha fica presa à versão do modelo vigente nesse momento, e todos os registros seguintes respondem às mesmas perguntas. Uma edição posterior do modelo vale só para fichas novas.
- Pergunta obrigatória sem resposta é recusada (400). Cada resposta é validada pelo tipo da pergunta: tamanho do texto, sim ou não (com detalhe só se a pergunta o permite e a resposta é "sim"), opções existentes, número, data válida e escala de 0 a 10.
- O **acompanhamento** registra o que o profissional observou na consulta: a evolução (texto obrigatório) e, se algo mudou, as respostas atualizadas, **só das perguntas alteradas**.
- O acompanhamento pode apontar o agendamento da visita; ele deve ser do mesmo cliente e da mesma empresa.
- A **data da consulta** é informada no registro: o padrão é hoje no fuso da empresa, pode ser passada (para lançar um acompanhamento esquecido), não pode ser futura nem anterior à data do registro inicial.
- Os registros são **imutáveis**: não há edição nem exclusão pela API. Para corrigir, cria-se um novo acompanhamento.
- A **situação atual** da ficha é a resposta mais recente de cada pergunta; o histórico completo, em ordem de data, continua disponível.
- Cliente inativo: as fichas continuam legíveis, mas não recebem novos registros.
- Cada registro guarda o usuário que o gravou e, se ele for vinculado a um profissional, esse profissional.

### Acesso

- Veem e registram fichas: o **ADMIN** e o usuário **vinculado a um profissional ativo** da empresa. Os demais recebem 403.
- Quem tem acesso vê as fichas de **todos os clientes da empresa**.
- O SUPER_ADMIN não acessa fichas, salvo se estiver vinculado a um profissional da própria empresa. Fichas de outras empresas respondem 404, como os demais dados.
- O **vínculo** entre usuário e profissional é opcional e único: um usuário se liga a uma pessoa do tipo `PROFESSIONAL`, ativa e da mesma empresa, e um profissional se liga a no máximo um usuário ativo. ADMIN e SUPER_ADMIN definem e alteram o vínculo. O `/auth/me` informa o profissional vinculado.
- O acesso por vínculo vale enquanto o profissional estiver ativo.

### Segurança e privacidade

- As respostas e o texto da evolução são **criptografados** no aplicativo (AES-256-GCM), com uma chave guardada no servidor (`ANAMNESIS_ENCRYPTION_KEY`). A API não sobe em produção sem ela.
- A chave **não** entra no backup do banco e precisa ser guardada à parte: sem ela, as fichas não podem ser lidas. O backup do banco contém só dados criptografados.
- Toda ação sensível é gravada na **auditoria**: leitura de ficha, histórico e lista de fichas do cliente, criação de registro, geração de PDF, criação e edição de modelo e alteração do vínculo. O registro de auditoria não é alterado nem excluído pela API. A consulta a ela está descrita abaixo.
- Não há exclusão de ficha pela API. O prazo de guarda e a exclusão a pedido do titular (LGPD) dependem de definição com o conselho da categoria ou com um jurídico **(adiado)**: ficam para uma atualização futura da funcionalidade.

### Consulta à auditoria

- A API lista os registros de auditoria, só leitura, **apenas para o ADMIN**, que vê somente os da própria empresa. Os demais perfis recebem 403, inclusive o SUPER_ADMIN.
- A lista é paginada, da mais recente para a mais antiga, e filtra por cliente, usuário, ação e período.
- Cada item informa quem (usuário), o quê (ação, tipo e código do alvo), a qual cliente se refere, o IP e quando. A própria consulta não é auditada.
- Não há edição nem exclusão de registros de auditoria.

### PDF para impressão

- A ficha é exportada em PDF, **gerado no backend**; a impressão é feita pelo frontend.
- O PDF traz os dados da clínica e do cliente, o modelo e a versão, a situação atual de cada pergunta, o histórico de acompanhamentos (data, profissional, evolução e respostas alteradas), as linhas de assinatura do cliente e do profissional, a data e hora da emissão no fuso da empresa e a paginação. A assinatura é conferida manualmente.
- Cada geração de PDF fica registrada na auditoria.

### Fora desta versão

- Banco de perguntas reutilizáveis entre modelos (duplicar um modelo existente é uma possibilidade, ainda não decidida).
- Atualizar uma ficha para uma versão nova do modelo.
- Perguntas condicionais, anexos e imagens, assinatura digital.

## Estados e cidades

- Estados e cidades são mantidos via seed (base do IBGE) e são somente leitura pela API.
- A busca de cidades por nome é parcial e ignora acentos e maiúsculas (ex.: "sao paulo" encontra "São Paulo"). A mesma regra vale para as buscas por nome de pessoas, serviços e métodos de pagamento.

## Status dos Agendamentos

- SCHEDULED - Quando o agendamento é criado na aplicação, status inicial.
- CONFIRMED - Quando o cliente confirma o agendamento (feature futura).
- IN_PROGRESS - Quando o agendamento começa a ser válido através do dia e horário agendado.
- COMPLETED - Quando o atendimento é encerrado, baseado no horário final do agendamento.
- CANCELLED - Quando o agendamento é encerrado manualmente pelo usuário.
- NO_SHOW - Quando o cliente não compareceu. É marcado manualmente pela empresa (não há automação). Em sessão de pacote, permite a reposição da sessão (ver Planos); nos demais agendamentos não tem regra própria por enquanto.
