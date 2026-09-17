# Prompts

Cada prompt cobre **uma etapa** do trabalho. A ideia é que nenhuma invocação
produza mais código do que você consegue revisar de uma vez.

## Fluxo

| Ordem | Prompt              | Entrega                                        | Para quando termina |
| ----- | ------------------- | ---------------------------------------------- | ------------------- |
| 1     | `define-rules.md`   | Regras escritas no `business-rules.md`         | Sim                 |
| 2     | `create-entity.md`  | Schema + migration de **uma** entidade         | Sim                 |
| 3     | `create-module.md`  | Module, Controller, Service e DTOs de **uma** entidade | Sim         |
| 4     | `add-tests.md`      | Testes de **um** módulo                        | Sim                 |

Cada etapa termina com um commit e uma parada para revisão. A etapa seguinte só
começa quando você pedir.

## Regras que valem para todos

- **Uma entidade ou uma regra por invocação.** Se o pedido tiver mais de uma,
  implemente a primeira e liste as demais como pendência.
- **No máximo 2 perguntas por rodada**, e só as que bloqueiam a etapa atual.
  Dúvidas que não bloqueiam viram pendência registrada, não implementação.
- **Não invente regra de negócio.** Se a regra não está no `business-rules.md`,
  pare e use o `define-rules.md` antes.
- **Não altere arquivos fora da etapa.** Ajustes que aparecerem pelo caminho
  viram pendência.
- Ao terminar: liste os arquivos alterados, explique as decisões e informe as
  pendências.
