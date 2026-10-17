# Limpar Recorrências Canceladas

## Objetivo

Apagar do **banco local** as recorrências canceladas de **uma empresa**, com todos
os agendamentos delas e os pagamentos desses agendamentos, para liberar a agenda
e repetir testes. É limpeza de dados de teste: não altera código, schema, migrations
nem documentação.

## Entrada

- **Empresa:** a informada no pedido. Se o pedido não disser, use "Empresa Teste"
  (a base de testes manuais). Nunca assuma "Orari" (a empresa da plataforma).
- **Variação opcional:** "e as contratações". Sem ela, as contratações de plano
  ficam (ver "Variação" abaixo).

## Instruções

1. **Trava de segurança.** Confirme que o `DATABASE_URL` do `.env` aponta para
   `localhost` ou `127.0.0.1`. Se apontar para outro host, **pare** e avise. Não
   imprima a senha.
2. **Inventário (só leitura).** Para a empresa, liste e mostre:
   - recorrências com `isActive = false` (e quantas são de pacote, `clientPlanId`
     preenchido);
   - os agendamentos dessas recorrências, por status;
   - os pagamentos desses agendamentos, por status (destaque quantos são `PAID`);
   - as recorrências **ativas** (não serão tocadas).

   Se houver recorrências canceladas em mais de uma empresa e o pedido não indicou
   qual, **pare e pergunte**. Se não houver nada a apagar, diga isso e encerre.
3. **Cópia de segurança.** Antes de apagar, salve em CSV, na pasta temporária da
   sessão (scratchpad), as linhas que serão removidas das tabelas
   `recurring_appointments`, `recurring_days`, `appointments` e `payments`
   (`\copy (select ...) to ... csv header`). Confira que as contagens batem com o
   inventário.
4. **Exclusão, em uma única transação** (`BEGIN ... COMMIT`, `ON_ERROR_STOP`), nesta
   ordem, **sempre com `"companyId" = '<id da empresa>'`** em cada comando:

   ```sql
   -- 1) pagamentos dos agendamentos (a chave estrangeira impede apagar o agendamento antes)
   DELETE FROM payments
   WHERE "companyId" = :X AND "appointmentId" IN (
     SELECT a.id FROM appointments a
     JOIN recurring_appointments r ON r.id = a."recurringAppointmentId"
     WHERE a."companyId" = :X AND r."companyId" = :X AND r."isActive" = false);

   -- 2) agendamentos das recorrências canceladas
   DELETE FROM appointments
   WHERE "companyId" = :X AND "recurringAppointmentId" IN (
     SELECT id FROM recurring_appointments WHERE "companyId" = :X AND "isActive" = false);

   -- 3) as recorrências canceladas (os dias saem em cascata)
   DELETE FROM recurring_appointments WHERE "companyId" = :X AND "isActive" = false;
   ```

5. **Conferência.** Compare as contagens de antes e depois (recorrências,
   agendamentos, pagamentos, contratações) e mostre que: não restou recorrência
   cancelada nem `recurring_days` órfão; as recorrências ativas continuam; e as
   outras empresas não mudaram.

## Variação: "e as contratações"

Só quando o pedido incluir as contratações de plano **canceladas**
(`client_plans.cancelledAt` preenchido) das recorrências de pacote que foram
removidas. Acrescente, depois do passo 3 e ainda na mesma transação, nesta ordem:

```sql
-- pagamentos da contratação (parcelas ou pagamento integral)
DELETE FROM payments
WHERE "companyId" = :X AND "clientPlanId" IN (
  SELECT id FROM client_plans WHERE "companyId" = :X AND "cancelledAt" IS NOT NULL);

-- as contratações canceladas (só depois de apagar as recorrências e os pagamentos delas)
DELETE FROM client_plans WHERE "companyId" = :X AND "cancelledAt" IS NOT NULL;
```

No inventário e na cópia de segurança, inclua `client_plans` e os pagamentos por
`clientPlanId`. Uma contratação **ativa** nunca entra.

## Limites

- **Uma empresa por execução.** Todo `DELETE` filtra pela empresa; nada de comando
  sem `companyId`.
- Apague **somente** o que o inventário mostrou. Recorrências ativas, pessoas,
  serviços, planos, métodos de pagamento e agendamentos avulsos ficam.
- Os pagamentos dos agendamentos removidos são apagados junto, **inclusive os
  `PAID`**: isso está autorizado neste prompt. Informe quantos eram `PAID`.
- Só no banco local (passo 1). Não rode em outro ambiente.
- Não faça commit nem altere arquivos do projeto.

## Ao finalizar

- O que foi removido, por tabela, e quantos eram `PAID`.
- Contagens antes e depois, e a confirmação de que as outras empresas não mudaram.
- O que **ficou** e pode surpreender (por exemplo, contratações canceladas e os
  pagamentos delas, quando a variação não foi pedida).
- Caminho da cópia de segurança em CSV.
- **Pare e aguarde instruções.**
