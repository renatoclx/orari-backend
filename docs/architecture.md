# Arquitetura

## Objetivo

Construir uma API REST modular utilizando NestJS.

A arquitetura deve priorizar:

- simplicidade
- baixo acoplamento
- alta coesão
- facilidade de manutenção

## Estrutura inicial

src/

- modules
  - auth
- common
- config
- prisma
- docs

Cada módulo deverá possuir:

- Controller
- Service
- DTO's (quando necessários)
- Entidades (quando necessários)
- Module (Representando o Module da entidade em questão)

# Nem todos os módulos precisam obrigatoriamente possuir todas as camadas.

## Responsabilidades

# Controller

    - Recebe as requisições;
    - Recebe dados já validados pelos Pipes/DTOs do NestJS.
    - Faz as chamadas para o Service;
    - NÃO deverão existir regras de negócio nesta camada;

# Service

    - Responsável pelas regras de negócio do módulo em questão;
    - Não deve conhecer detalhes da camada HTTP;

# Module

    - Agrupar dependências necessárias ao módulo em questão;
    - Importar/exportar blocos;

# Prisma

    - O acesso ao banco é centralizado através do PrismaService.
    - Nenhum módulo deve criar conexões diretamente.

## Regras

    - As regras de negócio pertencem estritamente aos Services;
    - Os módulos não acessam diretamente outros módulos pelo prisma;
    - Services não devem acessar diretamente o banco de outros módulos;
    - Controllers nunca acessam o Prisma;
