# Padrões para codificação

## Nomenclatura

# Exemplos

- ProductController
- CreateProductDto
- UpdateProductDto
- ProductService
- ProductModule

## Tipagem

- O projeto deve utilizar o TypeScript em Strict Mode.
- Evitar o uso de any;
- Preferir unknown;

## Organização

- Cada classe deve possuir apenas uma responsabilidade principal.
- Preferir métodos pequenos e com uma única responsabilidade.
- Quando um método começar a executar múltiplas responsabilidades, considere extrair partes dele.
- Aplicar os princípios do SOLID quando contribuírem para a simplicidade, manutenção e extensibilidade do código.
- Evitar abstrações desnecessárias.
- Prezar por um código limpo e legível;
- Prezar por nomes de variáveis, métodos/funções, etc. em inglês;
- Evitar duplicação de código.
- Antes de criar uma nova implementação, verificar se já existe algo reutilizável.
- Evitar funções que misturem:
  - validação
  - acesso ao banco
  - regra de negócio
  - transformação de dados

- Padronizar as respostas para chamadas HTTP:
  - GET - 200
  - POST - 201
  - PATCH/PUT - 200
  - DELETE - 204

- Utilizar PATCH para atualizações pontuais dentro das entidades.

## Imports

- Utilizar imports absolutos quando o projeto estiver configurado para isso.
- Evitar caminhos relativos excessivamente longos.

## Comentários

- Comentar um código somente quando houver necessidade;
- Evitar comentários em códigos óbvios;
- Utilizar comentários curtos e coesos, levando em conta sempre o "para que" aquela função/trecho é necessária;
- Comentários devem explicar o motivo da implementação, e não apenas descrever o que o código faz;

## Tratamento de erros

- Utilizar Exceptions do NestJS.
  Preferir:
  - BadRequestException
  - NotFoundException
  - ConflictException
  - UnauthorizedException
  - ForbiddenException

- Evitar throw new Error().

## Paginação

- Sempre utilizar:
  - page
  - limit
  - total
  - items

## Testes

- Todo código novo deve ser escrito de forma testável.
- Evitar acoplamento que dificulte testes unitários.
