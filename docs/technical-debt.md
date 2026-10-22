# Dívida técnica

Pontos conhecidos que foram adiados de forma consciente. Cada item diz o que é,
por que foi adiado e o que fazer quando for tratado.

---

## Validação da agenda consulta o banco a cada ocorrência

**Onde:** `AppointmentService.createFromRecurrence` e
`BusinessHourService.ensureWithinBusinessHours`.

**O que é:** cada ocorrência gerada por uma recorrência consulta o horário de
funcionamento (contagem, fuso e janelas do dia) e a agenda do cliente e do
profissional. São cerca de 4 a 5 consultas por agendamento, todas dentro da
transação de criação.

**Impacto:** uma recorrência ou contratação de plano longa gera muitos
agendamentos. Uma contratação de 12 meses, com 2 serviços e 2 dias por semana,
gera cerca de 200 agendamentos, ou seja, cerca de 1.000 consultas; uma
recorrência avulsa de um ano, 2 dias por semana, cerca de 104. Com o banco em outro
servidor, a transação pode passar do tempo limite do Prisma (5 segundos por
padrão).

**Mitigação atual:** a criação da recorrência avulsa e a contratação de plano usam
um tempo limite maior (30 segundos), definido em um só lugar
(`src/prisma/transaction-options.ts`). As demais transações mantêm o padrão de 5
segundos, que funciona como alarme para uma transação comum que trave.

**Como resolver:** buscar uma vez o horário de funcionamento da empresa e os
agendamentos do cliente e do profissional no período inteiro, e validar as
ocorrências em memória.

**Medição:** no banco local, um plano mensal de 12 meses com 2 serviços e 2 dias
por semana (208 agendamentos) foi contratado em cerca de 0,5 s. Em produção, a
latência de cada consulta é maior; vale medir de novo no ambiente real.

**Registrado em:** 2026-10-09 (Etapa 6.3).

---

## Fotos em pasta local e com acesso público

**Onde:** `src/common/storage/local-file-storage.service.ts` e `main.ts`
(`useStaticAssets`).

**O que é:** as fotos de pessoas ficam numa pasta do próprio servidor
(`UPLOADS_DIR`, padrão `uploads/`) e são servidas em `/uploads` **sem
autenticação**: quem tiver o link abre a imagem. O nome do arquivo é um UUID,
então o link não é adivinhável, mas não expira.

**Impacto:** foto de pessoa é dado pessoal (LGPD). As logos das empresas
(`/uploads/companies`) seguem o mesmo esquema de armazenamento e acesso; por
serem identidade visual pública, o acesso aberto não é problema de privacidade,
mas valem a perda de arquivos e a falta de réplica abaixo. Em produção, com mais de uma
instância do servidor ou com deploy que recria o disco, os arquivos locais
também se perdem ou ficam só em uma das instâncias.

**Mitigação atual:** uso só em ambiente local; formato conferido pelo conteúdo
(JPEG ou PNG), até 2 MB, nome aleatório.

**Como resolver:** trocar o `LocalFileStorage` por um armazenamento em nuvem
privado (ex.: S3 ou compatível) e servir as fotos por links temporários
assinados. Como o resto do código só conhece `save` e `remove`, a troca fica
concentrada nesse service.

**Registrado em:** 2026-10-13.

---

## Agenda sem trava contra marcações simultâneas

**Onde:** `AppointmentService.ensureSlotIsFree` (criação, edição, recorrência e
contratação).

**O que é:** a conferência de horário livre e a gravação são passos separados.
Duas marcações do mesmo profissional ou cliente, no mesmo horário e no mesmo
instante, passam pela conferência e são gravadas.

**Impacto:** raro com poucos usuários por empresa; o resultado aparece na agenda
e é corrigido à mão. Fica mais provável com agendamento online pelo cliente ou
com mais volume.

**Como resolver:** restrição de sobreposição no PostgreSQL (`EXCLUDE USING gist`,
extensão `btree_gist`) por profissional e por cliente, ignorando cancelados, com o
erro convertido em 409. Conferir antes se já existem sobreposições gravadas.

**Registrado em:** 2026-10-22.

---

## Configuração de produção

**Onde:** `main.ts` e variáveis de ambiente.

**O que é:** sem `CORS_ORIGIN`, qualquer origem é aceita; o Swagger fica público
em `/docs`; não há headers de segurança (`helmet`); as variáveis de ambiente não
são validadas na subida (um `JWT_SECRET` fraco é aceito); o access token dura 1
dia; sem `trust proxy`, atrás de um proxy todos os clientes aparecem com o mesmo
IP e dividem o limite de tentativas do login.

**Impacto:** nenhum no desenvolvimento; obrigatório antes do primeiro deploy.

**Como resolver:** definir `CORS_ORIGIN`, restringir ou desligar o Swagger em
produção, adicionar `helmet`, validar as variáveis na subida, reduzir
`JWT_EXPIRES_IN` (ex.: 15m) e configurar `trust proxy` conforme o proxy usado.

**Registrado em:** 2026-10-22.

---

## Vulnerabilidade moderada no Swagger

**Onde:** `@nestjs/swagger` (dependência `js-yaml`).

**O que é:** o `npm audit` aponta 2 vulnerabilidades moderadas, corrigidas só no
`@nestjs/swagger` 12 (versão major).

**Impacto:** baixo: o `js-yaml` é usado ao gerar a documentação, não processa
dados enviados por usuários.

**Como resolver:** atualizar para o `@nestjs/swagger` 12 numa branch própria e
conferir a documentação gerada.

**Registrado em:** 2026-10-22.

---

## Regras pendentes de decisão

**O que é:** comportamentos que funcionam, mas sem regra definida:

- **Excluir pessoa com agenda futura:** excluir um cliente ou profissional com
  agendamentos futuros, recorrência ou contratação ativos não mexe na agenda.
  Opções: recusar (409) ou cancelar o que é futuro.
- **Pagamento pago:** qualquer tipo de usuário pode excluir ou alterar o valor de
  um pagamento `PAID`, sem registro de quem fez. Opções: restringir a `ADMIN` ou
  impedir a exclusão de pagamento pago.
- **Notificações:** o módulo lista e marca como lida, mas nada cria notificações;
  a rota responde sempre vazia.

**Registrado em:** 2026-10-22.

---

## Legibilidade

- **"Hoje no fuso da empresa" repetido:** `ClientPlanService.todayIn`,
  `PaymentService.toLocalDate` e o cálculo do dia da semana em
  `RecurringAppointmentService` repetem o que poderia ser uma função em
  `common/time/time-zone.ts`.
- **Comentários de tutorial** em `appointment-status.job.ts` (ex.: "lte: less
  than or equal"): explicam a ferramenta, não a decisão.
- **`payment.service.ts` extenso:** mistura cadastro, cobranças geradas, baixas e
  comandas; as comandas poderiam ir para um service próprio.
- **Erros do Prisma sem tradução:** registro removido no meio da operação ou chave
  estrangeira inválida respondem 500; um filtro global de exceções os
  converteria em 404 ou 409.

**Registrado em:** 2026-10-22.
