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

**Impacto:** uma recorrência avulsa (até 60 dias) gera poucos agendamentos. Uma
contratação de plano de 12 meses, com 2 serviços e 2 dias por semana, gera cerca
de 200 agendamentos, ou seja, cerca de 1.000 consultas. Com o banco em outro
servidor, a transação pode passar do tempo limite do Prisma (5 segundos por
padrão).

**Mitigação atual:** a transação da contratação de plano tem tempo limite maior
(30 segundos). A recorrência avulsa não foi alterada.

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
