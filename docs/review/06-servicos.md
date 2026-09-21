# 06 – Serviços

O que a empresa oferece, com preço e duração.

**PR:** 6 (`feat/agenda`) · **Regras:** [business-rules.md § Serviços](../business-rules.md)

## Regras em resumo

- O serviço pertence à empresa do usuário; a empresa não vai no payload.
- Nome único por empresa entre os serviços não excluídos.
- `duration` é em minutos e **define o fim de todo agendamento** desse serviço.
- `price` é opcional e vira o valor padrão do pagamento.
- Serviço inativo (`isActive: false`) não pode ser usado em novos agendamentos
  nem em recorrências (responde 409).
- Busca por nome sem acento; exclusão lógica.

## Onde está

| Arquivo | Responsabilidade |
| ------- | ---------------- |
| `modules/service/service.service.ts` | CRUD, escopo e `findActive()` usado pela agenda |
| `modules/service/dto/create-service.dto.ts` | Preço com 2 casas, duração ≥ 1 |
| `modules/service/dto/find-services-query.dto.ts` | Filtros `name` e `isActive` |

## Rotas

| Método | Rota |
| ------ | ---- |
| POST | `/services` |
| GET | `/services` (`?name`, `?isActive`) |
| GET/PATCH/DELETE | `/services/:id` |

## Testes

`service.service.spec.ts` (8).

## O que olhar com atenção

- **Alterar a duração não mexe nos agendamentos existentes.** Só vale para os
  próximos, e para a regeração de recorrências.
- **`findActive()` responde 409 para serviço inativo** e 404 para inexistente ou
  de outra empresa — dois códigos diferentes no mesmo caminho.
- Inativar é diferente de excluir: o serviço inativo continua aparecendo nas
  listagens (com `?isActive=false`) e nos agendamentos antigos.
