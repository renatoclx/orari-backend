# Regras de Negócio

## Tipos de usuário

- **SUPER_ADMIN**: Cadastra, edita, inativa e reativa empresas, e gerencia usuários de qualquer empresa ativa.
- **ADMIN**: administra a própria empresa. Gerencia os usuários dela.
- **USER**: opera os dados da própria empresa (pessoas, contatos e endereços), sem gerenciar usuários.

## Empresas

- Apenas SUPER_ADMIN cadastra e edita empresas.
- ADMIN e USER consultam apenas a própria empresa. O filtro por status (`isActive`) é exclusivo do SUPER_ADMIN.
- Uma empresa é criada ativa, salvo indicação contrária.
- Empresas não são excluídas: são inativadas.
- Enquanto uma empresa estiver inativa, seus dados relacionados ficam inacessíveis:
  - seus usuários não fazem login e perdem imediatamente o acesso, inclusive com tokens já emitidos;
  - o SUPER_ADMIN não lista, consulta nem cria usuários dessa empresa;
  - a própria empresa continua visível ao SUPER_ADMIN, para que possa ser reativada.
- Ao reativar a empresa, os dados voltam a ficar acessíveis.
- Um SUPER_ADMIN não pode inativar a própria empresa.
- O CNPJ deve ser válido, no formato numérico ou alfanumérico, sem máscara (letras são convertidas para maiúsculas).

## Usuários e acesso

- Todo usuário pertence a uma empresa, que não pode ser alterada.
- SUPER_ADMIN cria usuários informando a empresa, que deve estar ativa.
- ADMIN cria usuários sempre na própria empresa; informar outra empresa responde 403.
- ADMIN gerencia apenas usuários da própria empresa e não enxerga contas SUPER_ADMIN. Usuários fora do alcance respondem 404.
- Apenas SUPER_ADMIN pode criar contas SUPER_ADMIN ou promover alguém a esse tipo.
- Ninguém pode excluir a própria conta nem alterar o próprio tipo.
- O login é recusado para usuários excluídos e para usuários de empresas inativas, sempre com a mesma mensagem genérica de credenciais inválidas.
- Um usuário autenticado perde o acesso imediatamente quando é excluído ou quando sua empresa fica inativa.

## Senhas

- A senha deve ter entre 8 e 72 caracteres e ser confirmada no cadastro e na redefinição.
- A senha é armazenada apenas como hash (bcrypt) e nunca é retornada pela API.
- A senha não é alterada pela edição do usuário: SUPER_ADMIN ou ADMIN a redefinem por rota própria, sem precisar da senha atual, respeitando o alcance de cada um.

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
- A listagem de pessoas traz ativas e excluídas (inativas): o status é derivado da data de exclusão (`deletedAt`). Não há filtro de status por enquanto.
- Uma pessoa excluída continua na listagem, mas não pode ser consultada, editada nem excluída de novo (404), nem ser usada em agendamentos.
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
  - o CNPJ e o subdomínio da empresa;
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
- Não podem ser cancelados: o que já iniciou ("Agendamento que já iniciou não pode ser cancelado"), o concluído, aquele em que o cliente não compareceu e o já cancelado. Nesses casos nada é alterado. A regra vale também quando o cancelamento vem junto com outras alterações, considerando o estado do agendamento antes delas.
- Ao cancelar um agendamento avulso, o pagamento dele ainda `PENDING` também é cancelado; o pagamento `PAID` não muda (não há reembolso).
- Um agendamento concluído que tem pagamento (pendente ou pago) não sofre mais nenhuma alteração: nem observação, nem status, nem serviço, cliente ou horário (400). O pagamento foi gerado a partir dele, e mudar o agendamento o deixaria divergente. Pagamento cancelado ou excluído libera a edição. Agendamento de plano não tem pagamento próprio e não é travado por esta regra.
- `CANCELLED` é o estado final do agendamento: um agendamento cancelado não volta a nenhum outro status (400). Para marcar de novo, cria-se outro agendamento. A observação de um cancelado continua editável.
- O agendamento precisa caber inteiro em uma janela de atendimento da empresa (ver "Horário de funcionamento"), exceto quando é um encaixe autorizado. Cancelar um agendamento não passa por essa verificação.
- Toda resposta de agendamento (listagem, consulta, criação e alteração) traz, além dos códigos, o cliente e o profissional (`id`, `name`, `photoUrl`) e o serviço (`id`, `name`, `color`, `duration`), e nenhum outro dado deles.
- Uma pessoa ou serviço excluídos depois continuam aparecendo com o nome nos agendamentos que já os usavam: o histórico não perde o nome.
- A listagem é ordenada pelo início do agendamento, do mais antigo para o mais novo; horários iguais seguem uma ordem fixa, para a paginação não repetir nem perder registros.
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
- O período entre a data inicial e a final não pode ultrapassar 60 dias. Esse limite vale para a criação de recorrências avulsas; contratações de plano seguem as regras de Planos.
- Informar a lista de dias em uma edição substitui todos os dias anteriores.
- Não há exclusão: a recorrência é desativada por `isActive`.
- Cada dia precisa reservar ao menos a duração do serviço, que é o que define o fim dos agendamentos gerados.

### Geração de agendamentos

- Ao criar uma recorrência ativa, os agendamentos são gerados até a data final. Ocorrências no passado não são geradas.
- Os agendamentos gerados seguem todas as regras de um agendamento avulso: janela de atendimento e ausência de conflito para cliente e profissional.
- A criação é tudo ou nada: se qualquer ocorrência conflitar, a recorrência não é criada.
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
- Cada serviço gera uma recorrência própria, com o período da contratação. Seus agendamentos seguem todas as regras de agendamentos recorrentes, exceto o limite de 60 dias.
- Os agendamentos de um plano podem ser remanejados dentro do período da contratação, e um agendamento pode ser cancelado individualmente; a sessão cancelada não é reposta.
- Reposição por falta: quando o cliente não comparece a uma sessão do plano e a empresa a marca como `NO_SHOW`, a sessão pode ser remanejada para uma nova data dentro do período da contratação, desde que haja horário disponível (funcionamento da empresa, sem conflito). Ela volta a `SCHEDULED` e a quantidade de sessões do plano se mantém; o registro da falta deixa de existir, porque é a mesma sessão que muda de data. Só sessões `NO_SHOW` entram: concluídas e em andamento continuam não podendo ser remanejadas. A regra vale só para pacotes; recorrências avulsas seguem remanejando apenas antes de iniciar.
- A recorrência de um serviço do plano não é encerrada isoladamente: o encerramento acontece pelo cancelamento da contratação.

### Contratação

- Só podem ser contratados planos ativos, com o período escolhido cadastrado e com todos os serviços ativos. O cliente precisa ser do tipo `CLIENT`.
- Ao contratar um plano, são definidos a modalidade de pagamento (integral ou mensal) e o número de meses, que precisa corresponder a um período do plano. São congelados o valor mensal, o percentual de desconto aplicado conforme a modalidade e o total do período.
- A data de início é, por padrão, a data atual no fuso da empresa. Pode ser futura, mas não passada.
- A data final é a data de início somada ao número de meses, menos um dia (ex.: 3 meses a partir de 15/10 terminam em 14/01).
- A contratação, as recorrências dos serviços e os pagamentos são criados juntos: se qualquer horário conflitar, nada é gravado.
- Alterar preços de serviços ou o plano depois da contratação não altera o valor da contratação.
- Ao fim do período contratado, a continuidade exige uma nova contratação, como nas recorrências.

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
- A contratação cancelada registra a data do cancelamento e não pode ser cancelada de novo. Uma contratação cujo período já terminou não pode ser cancelada.
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
- O nome do método de pagamento é único entre os métodos não excluídos da mesma empresa.
- Quando um agendamento avulso (não gerado por recorrência ou contratação de plano) passa para o status `COMPLETED`, gera um novo pagamento como `PENDING` para aquele agendamento, seja a conclusão feita pelo job de status ou manualmente.
- Cancelar um agendamento avulso cancela o pagamento `PENDING` dele (ex.: um sinal lançado antes do atendimento); o `PAID` não muda.
- Não é possível registrar pagamento para um agendamento cancelado (409): não há atendimento a cobrar.
- `CANCELLED` é o estado final do pagamento: um pagamento cancelado não volta a `PENDING` nem vai para `PAID` (409). Repetir `CANCELLED` é aceito, sem efeito, e os demais campos (ex.: valor) continuam editáveis.
  - O pagamento é gerado por um job de cobrança, que roda periodicamente; pode haver alguns minutos entre a conclusão e o pagamento.
  - O valor é o preço do serviço, e o vencimento é a data do agendamento no fuso da empresa.
  - Serviço sem preço é considerado gratuito e não gera pagamento.
  - Um agendamento que já teve pagamento, inclusive excluído, não gera outro.
- Agendamentos gerados por recorrência já nascem com pagamento `PENDING`, com vencimento na data do agendamento, e não geram novo pagamento ao serem concluídos (ver Agendamentos recorrentes).
- Agendamentos gerados por contratação de plano não geram pagamento por agendamento: os pagamentos pertencem à contratação (ver Planos).
  - Esses pagamentos deverão ser registrados como `PENDING`, onde deverá ser alterado manualmente para `PAID` quando este for pago;

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
