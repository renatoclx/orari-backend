# 07 – Horário de funcionamento

Janelas em que a empresa atende, e o fuso em que elas valem.

**PR:** 6 (`feat/agenda`) · **Regras:** [business-rules.md § Horário de funcionamento, Fuso horário](../business-rules.md)

## Regras em resumo

- Janelas por dia da semana, podendo haver **mais de uma no mesmo dia** (manhã e
  tarde), desde que não se sobreponham. Encostar (fim == início) é permitido.
- Dia sem janela é considerado fechado.
- **Enquanto a empresa não cadastrar nenhuma janela, o horário não é
  restringido.** A regra passa a valer a partir do primeiro cadastro.
- O atendimento precisa começar e terminar dentro da **mesma** janela.
- Tudo é comparado no fuso da empresa: uma janela "09:00–18:00" vale no relógio
  dela, não em UTC. Os instantes seguem gravados em UTC.

## Onde está

| Arquivo | Responsabilidade |
| ------- | ---------------- |
| `modules/business-hour/business-hour.service.ts` | CRUD, sobreposição e `ensureWithinBusinessHours()` |
| `common/time/time-zone.ts` | Conversões entre o relógio da empresa e o instante UTC (via `Intl`) |
| `common/time/time-of-day.ts` | `"HH:MM"` ↔ colunas `time` |

## Rotas

| Método | Rota |
| ------ | ---- |
| POST | `/business-hours` |
| GET | `/business-hours` (`?weekDay`) |
| GET/PATCH/DELETE | `/business-hours/:id` |

## Testes

`business-hour.service.spec.ts` (12), `time-zone.spec.ts` (8), `time-of-day.spec.ts` (3).

## O que olhar com atenção

- **"Sem janela = sem restrição"** é uma decisão de usabilidade: evita travar
  quem ainda não configurou a agenda, mas significa que a empresa só fica
  protegida depois do primeiro cadastro.
- **`ensureWithinBusinessHours` faz duas consultas** (contagem e janelas do dia)
  em todo agendamento, mais uma para o fuso da empresa.
- **Conversão de fuso feita à mão** com `Intl`, incluindo dupla aplicação do
  deslocamento para cobrir virada de horário de verão. Vale conferir o
  `zonedToUtc()` — é o trecho mais sutil do projeto.
- Atendimento que cruza a meia-noite não cabe em nenhuma janela, por
  consequência da comparação em minutos do dia.
