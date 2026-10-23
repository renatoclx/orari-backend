# Progresso

Estado atual do backend do Orari. O **como** de cada entrega está no
[`implementation-summary.md`](implementation-summary.md); as **regras** estão no
[`business-rules.md`](business-rules.md); o histórico de **decisões e motivos**
está no [`journal.md`](journal.md); o que foi adiado de propósito está no
[`technical-debt.md`](technical-debt.md).

**Última atualização:** 2026-10-22.

## Situação

O backend do MVP está **completo em funcionalidades**. Faltam definir três regras
e fazer o ajuste de ambiente do primeiro deploy (ver [O que falta](#o-que-falta)).
A fase seguinte é o frontend.

## O que está entregue

| Área                     | Entregue                                                                                                                                                                 |
| ------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Autenticação             | Login, access token, refresh token com rotação atômica, logout, `/auth/me`, perfis `SUPER_ADMIN`, `ADMIN` e `USER`, limite de tentativas no login e no refresh (429)     |
| Empresas                 | Cadastro e inativação (SUPER_ADMIN), nome fantasia e logo pelo próprio ADMIN, fuso horário                                                                               |
| Usuários                 | CRUD com alcance por tipo, redefinição de senha, inativação e reativação, fim das sessões ao trocar a senha ou inativar                                                  |
| Pessoas                  | Clientes, profissionais e funcionários; CPF e data de nascimento opcionais; foto; cadastro completo com contatos e endereços; inativação, reativação e filtro por status |
| Contatos e endereços     | Dono exclusivo (empresa ou pessoa), principal único                                                                                                                      |
| Serviços                 | Preço, duração, cor; exclusão só sem relacionamentos, senão inativação                                                                                                   |
| Horário de funcionamento | Janelas por dia da semana, cadastro em lote                                                                                                                              |
| Agendamentos             | Conflito de horário, encaixe (`overBooking`), cancelamento só antes de iniciar, status automático por job, dados relacionados nas respostas                              |
| Agendamentos recorrentes | Sem limite de período, dados relacionados, filtro de sessões, mensagem de conflito com data e horário, remanejamento e cancelamento por sessão                           |
| Planos                   | Catálogo com serviços e frequência semanal (`sessionsPerWeek`), períodos e descontos                                                                                     |
| Contratações             | Integral ou mensal, valores congelados, uma recorrência por serviço, cancelamento, reposição de falta, dados relacionados e filtro por status                            |
| Pagamentos               | Geração automática, baixa individual, em lote e por seleção, listagem com cliente e método, resumo de totais, comandas do dia a partir das visitas                       |
| Notificações             | Listagem e leitura (ver [pendência](#decisões-pendentes))                                                                                                                |
| Plataforma               | Validação do ambiente na subida, headers de segurança, CORS por lista, Swagger desligado em produção, `trust proxy`                                                      |

## Qualidade

- **Testes unitários:** mais de 650 passando.
- **Testes da camada HTTP** (rotas, autenticação, `@Roles`, validação, limite de
  tentativas), sem banco: 150, em `test/http-routes.e2e-spec.ts`
  (`npm run test:e2e`).
- **Cobertura:** cerca de 83% das linhas; os services estão bem cobertos.
- **Revisões feitas:** segurança e legibilidade, `/code-review` local nos módulos
  de maior risco, `npm audit` (restam 2 vulnerabilidades moderadas, sem uso em
  runtime; ver `technical-debt.md`).

## O que falta

### Para o primeiro deploy

- Definir no ambiente: `NODE_ENV=production`, `JWT_SECRET` forte (32+
  caracteres), `CORS_ORIGIN`, `TRUST_PROXY` conforme o proxy usado e
  `JWT_EXPIRES_IN` curto (sugestão: `15m`).
- Trocar a pasta local de fotos por armazenamento em nuvem privado (ver
  `technical-debt.md`).

### Decisões pendentes

- O que fazer ao excluir uma pessoa com agenda futura (recusar ou cancelar).
- Quem pode excluir ou alterar o valor de um pagamento já pago.
- Notificações: nada as cria hoje; decidir se entram no MVP ou ficam para depois.

### Adiado para depois do MVP

Detalhes em [`technical-debt.md`](technical-debt.md):

- trava no banco contra marcações simultâneas do mesmo horário;
- validação da agenda em lote para recorrências longas;
- atualização do `@nestjs/swagger` para a versão 12;
- itens de legibilidade (funções repetidas, `payment.service.ts` extenso, filtro
  global de erros do Prisma).

## Próxima fase

Frontend (Next.js), consumindo esta API. Ver as telas já atendidas pelas rotas em
`implementation-summary.md`.
