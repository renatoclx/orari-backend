# Regras de negócio: Anamnese

> Parte de [`business-rules/`](README.md). Modelos, fichas, acompanhamentos, acesso e auditoria.

## Anamnese

> As regras abaixo valem na API. O item marcado com **(adiado)** fica para uma
> atualização futura da funcionalidade.

A anamnese guarda **dados de saúde**, que a LGPD trata como dados pessoais sensíveis. Por
isso o acesso é restrito, as respostas são criptografadas e toda ação fica registrada.

### Modelos de ficha

- Um modelo pertence à empresa do usuário que o cadastrou; a empresa não é informada no payload.
- O nome do modelo é obrigatório, com até 100 caracteres, e único entre os modelos da mesma empresa, sem diferenciar maiúsculas nem acentos. A descrição é opcional, com até 1000 caracteres.
- Não há exclusão: o modelo é inativado (`isActive`) e pode ser reativado. Um modelo inativo não inicia novas fichas; as fichas já existentes continuam acessíveis e recebendo acompanhamentos.
- Cada modelo tem **versões** numeradas a partir de 1. Criar o modelo cria a versão 1. Editar as perguntas cria uma nova versão (a lista informada substitui a anterior); reenviar a mesma lista também cria uma nova versão. Uma versão existente nunca muda.
- A versão pode ter um **termo de responsabilidade** (texto opcional, até 3.000 caracteres), impresso no PDF acima da assinatura. Ele fica na versão, e não no modelo, porque o que o cliente assinou não pode mudar depois: alterá-lo cria a versão seguinte, e por isso só é enviado junto com as perguntas (sozinho, 400). Renomear ou inativar o modelo não cria versão.
- Quem cria, edita e inativa modelos é **somente o ADMIN**. Os profissionais consultam os modelos e os usam para preencher fichas.

### Perguntas

- Um modelo precisa de ao menos uma pergunta. A ordem é a da lista enviada: o servidor numera as perguntas de 1 em diante, e o cliente não informa posição.
- A ordem das perguntas pode ser alterada no frontend antes de enviar para salvar.
- O texto da pergunta é obrigatório. O texto de ajuda é opcional.
- Tipos: texto curto, texto longo, sim ou não, escolha única, escolha múltipla, número, data e escala de 0 a 10.
- Escolha única e múltipla exigem ao menos 2 opções, sem repetir; os demais tipos não aceitam opções.
- A pergunta de sim ou não pode ter um texto de detalhe (ex.: "Qual?"); o detalhe só vale quando a resposta é "sim".
- Cada pergunta é obrigatória ou opcional.
- Limites: texto da pergunta até 400 caracteres, ajuda até 500, opção até 100, até 100 perguntas por modelo, resposta de texto até 5.000 caracteres e evolução até 10.000.
- Não há perguntas condicionais, anexos nem imagens nesta versão.

### Fichas e acompanhamentos

- Existe **uma ficha por cliente e por versão do modelo**. O cliente deve ser do tipo `CLIENT` e estar ativo; o modelo deve estar ativo.
- Quando o modelo ganha uma versão nova, a ficha pode ser **atualizada**: nasce uma ficha nova na versão nova, com as respostas mais recentes da antiga (acompanhamentos incluídos) levadas às perguntas iguais (mesmo texto, sem diferenciar acentos nem maiúsculas, e mesmo tipo; nas escolhas, só as opções que continuam existindo). A antiga fica guardada, com o histórico dela.
- Criar a ficha é gravar o **registro inicial**, com as respostas. A ficha fica presa à versão do modelo vigente nesse momento, e todos os registros seguintes respondem às mesmas perguntas. Uma edição posterior do modelo vale só para fichas novas.
- Pergunta obrigatória sem resposta é recusada (400). Cada resposta é validada pelo tipo da pergunta: tamanho do texto, sim ou não (com detalhe só se a pergunta o permite e a resposta é "sim"), opções existentes, número, data válida e escala de 0 a 10.
- O **acompanhamento** registra o que o profissional observou na consulta: a evolução (texto obrigatório) e, se algo mudou, as respostas atualizadas, **só das perguntas alteradas**.
- O acompanhamento pode apontar o agendamento da visita; ele deve ser do mesmo cliente e da mesma empresa.
- A **data da consulta** é informada no registro: o padrão é hoje no fuso da empresa, pode ser passada (para lançar um acompanhamento esquecido), não pode ser futura nem anterior à data do registro inicial.
- Os registros são **imutáveis**: não há edição nem exclusão pela API. Para corrigir, cria-se um novo acompanhamento. Um acompanhamento atualiza respostas, mas não as apaga: não há como limpar uma resposta já dada.
- As fichas de um cliente são listadas pelo cliente (`clientId` obrigatório): não existe listagem geral de fichas da empresa.
- Os **clientes que têm ficha** podem ser listados com a quantidade de fichas de cada um (`GET /anamnesis/clients`, paginado, com busca por nome sem diferenciar acentos nem maiúsculas, em ordem alfabética): só entram os clientes da empresa com ao menos uma ficha (inclusive inativos), e a resposta traz apenas o nome e a contagem, nenhum conteúdo. Exige o acesso da anamnese e grava **uma** auditoria de listagem por consulta (alvo: a empresa, sem cliente), e não uma por cliente.
- É possível consultar **quais agendamentos já têm acompanhamento** (`GET /anamnesis/appointments-with-entry?appointmentIds=a,b,c`, de 1 a 100 ids, da empresa do usuário): a resposta traz só os ids de agendamento que têm acompanhamento, sem nenhum conteúdo da ficha, cliente ou modelo. Exige o mesmo acesso da anamnese (os demais recebem 403) e **não entra na auditoria**, por não expor dado de saúde e por ser chamada a cada carregamento da agenda do frontend, que avisa os atendimentos ainda sem acompanhamento.
- A **situação atual** da ficha é a resposta mais recente de cada pergunta; o histórico completo, em ordem de data, continua disponível.
- Cliente inativo: as fichas continuam legíveis, mas não recebem novos registros.
- Cada registro guarda o usuário que o gravou e, se ele for vinculado a um profissional, esse profissional.

### Acesso

- Veem e registram fichas: o **ADMIN** e o usuário **vinculado a um profissional ativo** da empresa. Os demais recebem 403.
- Quem tem acesso vê as fichas de **todos os clientes da empresa**.
- O SUPER_ADMIN não acessa fichas, salvo se estiver vinculado a um profissional da própria empresa. Fichas de outras empresas respondem 404, como os demais dados.
- O **vínculo** entre usuário e profissional é opcional e único: um usuário se liga a uma pessoa do tipo `PROFESSIONAL` (ou `EMPLOYEE`, sem acesso à anamnese), ativa e da mesma empresa, e uma pessoa se liga a no máximo um usuário ativo. ADMIN e SUPER_ADMIN definem e alteram o vínculo. O `/auth/me` informa o profissional vinculado (`professional`) e a pessoa vinculada (`person`).
- O acesso por vínculo vale enquanto o profissional estiver ativo.

### Segurança e privacidade

- As respostas e o texto da evolução são **criptografados** no aplicativo (AES-256-GCM), com uma chave guardada no servidor (`ANAMNESIS_ENCRYPTION_KEY`). A API não sobe em produção sem ela.
- A chave **não** entra no backup do banco e precisa ser guardada à parte: sem ela, as fichas não podem ser lidas. O backup do banco contém só dados criptografados.
- Toda ação sensível é gravada na **auditoria**: leitura de ficha, histórico e lista de fichas do cliente, criação de registro, geração de PDF, criação e edição de modelo e alteração do vínculo. O registro de auditoria não é alterado nem excluído pela API. A consulta a ela está descrita abaixo.
- Também são auditadas as ações que dão ou tiram o acesso aos dados de saúde: a **criação de usuário do tipo ADMIN**, **toda mudança de tipo** de um usuário (inclusive a retirada do ADMIN) e a **reativação** de um usuário ADMIN ou vinculado a uma pessoa. Valem para o ADMIN e para o SUPER_ADMIN, e o registro fica na empresa do usuário alterado: o ADMIN dela vê, por exemplo, quando o SUPER_ADMIN cria um administrador. O registro diz quem alterou, qual usuário, quando e de qual IP; o tipo anterior e o novo não são guardados.
- Não há exclusão de ficha pela API. O prazo de guarda e a exclusão a pedido do titular (LGPD) dependem de definição com o conselho da categoria ou com um jurídico **(adiado)**: ficam para uma atualização futura da funcionalidade.

### Consulta à auditoria

- A API lista os registros de auditoria, só leitura, **apenas para o ADMIN**, que vê somente os da própria empresa. Os demais perfis recebem 403, inclusive o SUPER_ADMIN.
- A lista é paginada, da mais recente para a mais antiga, e filtra por cliente, usuário, ação e período.
- Cada item informa quem (usuário), o quê (ação, tipo e código do alvo), a qual cliente se refere, o IP e quando. A própria consulta não é auditada.
- Não há edição nem exclusão de registros de auditoria.

### PDF para impressão

- A ficha é exportada em PDF, **gerado no backend**; a impressão é feita pelo frontend.
- O PDF tem duas partes. A **ficha** é o que o cliente assina: traz o título e o modelo com a versão (centralizados), os **dados do cliente** (nome, idade, CPF, telefone e endereço principais), uma linha separando as respostas, as respostas do **registro inicial** (não as atualizações posteriores, para que o papel assinado reflita o que o cliente declarou), o **termo de responsabilidade** da versão, se houver (justificado), e a linha de assinatura **só do cliente**, centralizada, com o nome dele e a data a preencher. A assinatura é conferida manualmente.
- No sim ou não, a resposta é "Sim" ou "Não", e o detalhe vem abaixo, com a pergunta auxiliar (ex.: "Qual?") em negrito. A pergunta e a resposta não se separam entre páginas, salvo resposta muito longa (acima de ~1.200 caracteres), que quebra normalmente. O termo e a assinatura também ficam juntos.
- O **histórico de acompanhamento** vem em página própria: cada registro com a data da consulta, o profissional (ou o usuário, sem vínculo), a evolução e as respostas atualizadas. É controle do profissional, anotado conforme a evolução do cliente, e **não leva assinatura**. A ficha continua como foi assinada: o histórico só cresce, com novos acompanhamentos.
- Como o histórico é do profissional, o PDF pode ser emitido **sem ele** (`includeHistory=false`), para a via do cliente. O padrão é incluí-lo.
- A clínica aparece só no cabeçalho de todas as páginas: a **logomarca**, centralizada, quando existe e é PNG ou JPEG (o único formato aceito no upload); sem logo, ou com um valor que não seja um arquivo de logo válido, o nome da clínica, sem erro. O rodapé traz a data e hora da emissão no fuso da empresa e a paginação.
- Cada geração de PDF fica registrada na auditoria, e o arquivo só é entregue se o registro for gravado. O PDF não é guardado em cache.

### Fora desta versão

- Banco de perguntas reutilizáveis entre modelos (duplicar um modelo existente é uma possibilidade, ainda não decidida).
- Perguntas condicionais, anexos e imagens, assinatura digital.
