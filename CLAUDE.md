# Claude Instructions

## Papel

Você e eu somos os desenvolvedores responsáveis pelo projeto.
O objetivo é manter consistência, simplicidade e baixo acoplamento.

---

## Antes de alterar qualquer código

Consulte a documentação em /docs:

architecture.md
coding-standards.md
database.md
auth.md

Documentos adicionais (domain.md, business-rules.md, decisions.md, progress.md,
journal.md, technical-debt.md) poderão ser criados conforme o projeto evoluir.
Quando existirem, também deverão ser consultados antes de qualquer alteração.

---

## Fluxo obrigatório

Antes de implementar:

1. Analise o problema.
2. Explique o plano.
3. Aguarde aprovação.
4. Somente então altere os arquivos.

- Comandos bash e o uso do Python não necessitam de aprovação (regra aplicada via `.claude/settings.json`, não por este arquivo).

---

## Interpretação da documentação

Ao implementar funcionalidades, considere:

- O `domain.md` descreve as entidades do sistema, seus atributos, responsabilidades e relacionamentos.
- O `business-rules.md` descreve as regras de negócio do domínio.
- As regras descritas no `business-rules.md` devem ser refletidas na implementação (Services, Prisma, DTOs, etc.), quando aplicável.
- Quando uma regra de negócio implicar validação de entrada, implemente também as validações necessárias nos DTOs.
- Não assuma regras que não estejam documentadas. Em caso de dúvida, pergunte antes de implementar.

---

## Durante a implementação

- Não altere arquivos fora do escopo.
- Não faça refatorações não solicitadas.
- Respeite a arquitetura existente.
- Siga os padrões definidos na documentação.
- Quando houver dúvida, pergunte.
- Antes de criar qualquer módulo, classe ou funcionalidade, verifique se ela já existe no projeto.
- Prefira reutilizar implementações existentes ao invés de criar novas versões.
- Toda implementação deve respeitar estritamente o escopo solicitado.
- Não implemente funcionalidades futuras "aproveitando a oportunidade".
- Caso uma funcionalidade dependa de outra ainda não solicitada, informe essa dependência e aguarde aprovação.

---

## Planejamento

Caso identifique uma abordagem melhor de que foi solicitada, apresente-a antes da implementação e aguarde aprovação.
Nunca faça alterações em arquivos não relacionados apenas por oportunidade de melhoria.

## Ao finalizar

Informe:

- arquivos modificados
- resumo da alteração
- possíveis impactos
- próximos passos

## NÃO atualize progress.md nem journal.md sem confirmação do usuário.

---

## domain.md

O domain.md descreve apenas:

- o que existe no sistema;
- responsabilidades das entidades;
- atributos;
- relacionamentos.

Regras de funcionamento pertencem exclusivamente ao business-rules.md.
