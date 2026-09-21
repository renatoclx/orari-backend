# 02 – Empresas

Cadastro das empresas (tenants) da plataforma.

**PR:** 4 (`feat/company-e-usuarios`) · **Regras:** [business-rules.md § Empresas, Fuso horário](../business-rules.md)

## Regras em resumo

- Só **SUPER_ADMIN** cadastra e edita. ADMIN e USER consultam apenas a própria.
- **Empresas não são excluídas: são inativadas** (`isActive`). A tabela não tem
  `deletedAt`.
- Enquanto inativa, os dados ligados a ela ficam inacessíveis: os usuários não
  logam e perdem o acesso na hora; o SUPER_ADMIN não gerencia usuários dela, mas
  continua vendo a empresa para poder reativá-la.
- Um SUPER_ADMIN não pode inativar a própria empresa.
- CNPJ válido (numérico ou alfanumérico), sem máscara; CNPJ e subdomínio únicos.
- `timezone` (padrão `America/Sao_Paulo`) define o relógio em que valem janelas
  de atendimento e horários de recorrência.

## Onde está

| Arquivo | Responsabilidade |
| ------- | ---------------- |
| `modules/company/company.service.ts` | Regras, escopo e `getTimeZone()` / `isActive()` usados por outros módulos |
| `modules/company/company.controller.ts` | `@Roles(SUPER_ADMIN)` na escrita |
| `modules/company/dto/create-company.dto.ts` | CNPJ normalizado para maiúsculas, subdomínio, fuso |
| `modules/company/dto/find-companies-query.dto.ts` | Filtro `isActive` (só SUPER_ADMIN) |

## Rotas

| Método | Rota | Acesso |
| ------ | ---- | ------ |
| POST | `/companies` | SUPER_ADMIN |
| GET | `/companies` (`?isActive`) | Todos; não-SUPER_ADMIN vê só a própria |
| GET | `/companies/:id` | Idem |
| PATCH | `/companies/:id` | SUPER_ADMIN |

Não há `DELETE`.

## Testes

`company.service.spec.ts` (17), `company-dtos.spec.ts` (4).

## O que olhar com atenção

- **`findOne` usa 404 para empresa alheia** e nem consulta o banco — confira se
  é o comportamento desejado para o front.
- **Empresa nova nasce sem usuários:** só o SUPER_ADMIN cria o primeiro. Um
  ADMIN não consegue criar usuários de outra empresa (por desenho).
- **Sem `deletedAt`,** os uniques de CNPJ e subdomínio são totais: um CNPJ
  cadastrado nunca é liberado, já que a empresa não é excluída.
