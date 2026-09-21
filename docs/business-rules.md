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
- O documento da pessoa é um CPF válido, sem máscara.
- Pessoas podem ser filtradas por nome (busca parcial que ignora acentos e maiúsculas), por CPF (exato) e por tipo.

## Contatos e endereços

- Contatos e endereços pertencem a exatamente um dono: uma empresa ou uma pessoa, nunca ambos.
- O dono precisa ser a empresa do usuário ou uma pessoa dela; caso contrário, responde 404.
- O dono é definido na criação e não pode ser alterado.
- Usuários só acessam contatos e endereços da própria empresa e de suas pessoas.
- Contatos e endereços de uma pessoa excluída deixam de ser acessíveis junto com ela.
- Um contato deve ter ao menos um meio de contato: telefone e/ou e-mail. Uma edição não pode remover o último deles.

## Unicidade

- São únicos:
  - o CNPJ e o subdomínio da empresa;
  - entre os registros não excluídos, o e-mail do usuário;
  - entre os registros não excluídos, o documento da pessoa dentro da mesma empresa.
- E-mails e documentos de registros excluídos podem ser reutilizados.

## Serviços

- Um serviço pertence à empresa do usuário que o cadastrou; a empresa não é informada no payload.
- O nome do serviço é único entre os serviços não excluídos da mesma empresa.
- A duração é informada em minutos e é o que define o fim dos agendamentos desse serviço.
- Serviços inativos não podem ser usados em novos agendamentos nem em recorrências.

## Agendamentos

- Um agendamento pertence à empresa do usuário, e cliente, profissional e serviço precisam ser dessa mesma empresa.
- O `clientId` precisa ser uma pessoa do tipo `CLIENT`, e o `professionalId`, do tipo `PROFESSIONAL`.
- O fim (`endAt`) é sempre calculado somando a duração do serviço ao início; não é aceito no payload.
- Não pode haver sobreposição de horário para o mesmo profissional nem para o mesmo cliente. Horários que apenas se encostam (fim de um igual ao início do outro) são permitidos.
- Agendamentos cancelados não ocupam horário e liberam a agenda.
- Não há exclusão de agendamento: o ciclo de vida é controlado pelo status (`SCHEDULED`, `CONFIRMED`, `COMPLETED`, `CANCELLED`, `NO_SHOW`), e um agendamento novo começa como `SCHEDULED`.
- Não é possível agendar em data e hora que já passaram, nem remarcar um agendamento para o passado. Alterar status ou observação de um agendamento já realizado continua permitido.
- O agendamento precisa caber inteiro em uma janela de atendimento da empresa (ver "Horário de funcionamento"). Cancelar um agendamento não passa por essa verificação.

## Fuso horário

- Cada empresa tem um fuso (`timezone`, padrão `America/Sao_Paulo`).
- Todos os instantes são gravados em UTC. O fuso é usado para interpretar horários "de relógio": janelas de atendimento e horários reservados por recorrências.
- Datas puras, como início e fim de uma recorrência, valem pelo calendário e não sofrem conversão de fuso.

## Horário de funcionamento

- Cada empresa define janelas de atendimento por dia da semana, e pode ter mais de uma no mesmo dia (ex.: manhã e tarde), desde que não se sobreponham.
- Dias sem janela cadastrada são considerados fechados.
- Enquanto a empresa não cadastrar nenhuma janela, o horário não é restringido: a regra passa a valer a partir do primeiro cadastro.
- Um atendimento precisa começar e terminar dentro da mesma janela.

## Agendamentos recorrentes

- Valem as mesmas regras de empresa, tipos de pessoa e serviço ativo dos agendamentos.
- A recorrência precisa de ao menos um dia; cada dia tem dia da semana, horário inicial e final, e o fim deve ser posterior ao início.
- Dois dias da mesma recorrência não podem se sobrepor no mesmo dia da semana.
- Quando informada, a data final não pode ser anterior à inicial.
- Informar a lista de dias em uma edição substitui todos os dias anteriores.
- Não há exclusão: a recorrência é desativada por `isActive`.
- Cada dia precisa reservar ao menos a duração do serviço, que é o que define o fim dos agendamentos gerados.

### Geração de agendamentos

- Ao criar uma recorrência ativa, os agendamentos são gerados até a data final ou, quando não houver, até 90 dias à frente. Cada geração cobre no máximo esse horizonte, e ocorrências no passado não são geradas.
- Os agendamentos gerados seguem todas as regras de um agendamento avulso: janela de atendimento e ausência de conflito para cliente e profissional.
- A criação é tudo ou nada: se qualquer ocorrência conflitar, a recorrência não é criada.
- Alterar dias, período, serviço, cliente, profissional ou o `isActive` regera a agenda: os agendamentos futuros ainda em `SCHEDULED` são cancelados e recriados. Passados, confirmados, concluídos, no-show e cancelados à mão são preservados.
- Alterar apenas a observação não mexe na agenda.
- Desativar a recorrência cancela os futuros em `SCHEDULED`, sem gerar novos.

### Extensão do horizonte

- O horizonte **não avança sozinho**: não há rotina automática.
- Quando faltam menos de 30 dias de agenda gerada, a empresa recebe uma notificação do tipo `RECURRING_APPOINTMENT_HORIZON`.
- A ampliação é manual, por `POST /recurring-appointments/:id/extend`, que gera mais um bloco a partir do último agendamento existente.
- Recorrência inativa não pode ser estendida, e estender sem novos horários a gerar é recusado.

## Notificações

- São avisos por empresa, criados e resolvidos pela própria API; não são criadas nem excluídas pelo cliente.
- A lista de notificações é sincronizada a cada consulta: cria os avisos que faltam e resolve os que já foram atendidos.
- Uma notificação pode ser marcada como lida. Ao ser resolvida, sai da lista padrão, mas continua no histórico.

## Pagamentos

- Cada agendamento tem no máximo um pagamento. Excluir o pagamento libera o agendamento para um novo.
- O agendamento e o método de pagamento precisam ser da empresa do usuário. O agendamento não muda depois da criação.
- Um pagamento novo nasce como `PENDING`.
- Quando o valor não é informado, assume o preço do serviço do agendamento. Se o serviço não tiver preço, o valor passa a ser obrigatório. Valores diferentes do preço continuam permitidos.
- `paidAt` é obrigatório quando o status é `PAID` e recusado nos demais status. Sair de `PAID` limpa a data.
- O nome do método de pagamento é único entre os métodos não excluídos da mesma empresa.

## Estados e cidades

- Estados e cidades são mantidos via seed (base do IBGE) e são somente leitura pela API.
- A busca de cidades por nome é parcial e ignora acentos e maiúsculas (ex.: "sao paulo" encontra "São Paulo"). A mesma regra vale para as buscas por nome de pessoas, serviços e métodos de pagamento.
