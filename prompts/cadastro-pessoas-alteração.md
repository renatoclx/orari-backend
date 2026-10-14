O frontend (Next.js) está montando as telas de Pessoas, começando por Clientes.
Preciso de 3 mudanças na API. Siga o CLAUDE.md (plano, aprovação, código) e não
faça nada fora do escopo.

1. Observação. Aceitar `note?: string` (opcional, texto livre) em
   CreatePeopleDto. A coluna People.note já existe; hoje o valor é descartado.
   Sugira um limite de tamanho e confirme comigo.

2. Cadastro completo. POST /people passa a aceitar, opcionalmente, `contacts` e
   `addresses` (listas), criados na MESMA transação da pessoa: se algo falhar,
   nada é criado.
   - Contato: type, phone e/ou email (ao menos um), isPrincipal?.
     Endereço: type, cep, street, number, neighborhood?, complement?, cityId,
     isPrincipal?. Mesmas validações dos DTOs atuais, sem OwnerDto.
   - No máximo 1 principal de cada tipo por requisição. cityId inexistente:
     404, sem criar a pessoa. CPF duplicado continua 409.
   - Sem as listas, continua funcionando como hoje. Responder com a pessoa
     criada (com `id`).
   - ContactService e AddressService dependem de PeopleService (circular): use
     escrita aninhada do Prisma.

3. Inativos. GET /people deixa de filtrar deletedAt: null: devolve ativas e
   inativas (o frontend deriva o status de deletedAt). Excluir inativa a pessoa
   e ela continua na lista. Sem filtro de status por enquanto.
   - Nova rota de reativar (sugestão PATCH /people/:id/restore): limpa
     deletedAt. 404 se não existir; 409 se já estiver ativa; 409 se o CPF já
     estiver em uso por outra pessoa ativa.
   - GET, PATCH e DELETE por id continuam 404 para inativas.
   - Veja se algum consumidor interno de GET /people esperava só ativas e me
     avise.

Foto. photoUrl continua opcional e preenchida só por POST /people/:id/photo.
Nada muda aí.

Testes (vitest), docs/business-rules.md e Swagger atualizados. Sem push.

Ao final, devolva: rotas, JSON de exemplo, códigos de status e mensagens de erro,
e as decisões que tomou onde deixei aberto.
