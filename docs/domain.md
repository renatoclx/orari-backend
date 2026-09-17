# Domínio

## Objetivo

- Criar as entidades que irão compor a base de dados.

---

## State

- Representa um estado cadastrado na aplicação.

### Atributos

| Nome    | Descrição           |
| ------- | ------------------- |
| id      | Identificador único |
| name    | Nome do estado      |
| acronym | Sigla do estado     |

### Relacionamentos

- Um estado pode ter mais de uma cidade associada.

---

## City

- Representa uma cidade cadastrada na aplicação.

### Atributos

| Nome    | Descrição           |
| ------- | ------------------- |
| id      | Identificador único |
| name    | Nome da cidade      |
| stateId | Código do estado    |

### Relacionamentos

- Uma cidade pertence a um estado.

---

## Company

- Representa uma empresa cadastrada na aplicação.

### Atributos

| Nome            | Descrição                       |
| --------------- | ------------------------------- |
| id              | Identificador único             |
| corporateReason | Razão Social da empresa         |
| fantasyName     | Nome Fantasia                   |
| cnpj            | Documento da empresa            |
| foundationDate  | Data de fundação                |
| logoUrl         | caminho da logomarca da empresa |
| subdomain       | Subdomínio da empresa           |

---

## People

- Representa uma pessoa cadastrada na aplicação.

### Tipos de Pessoa (enum)

- USER - Usuário
- ADMIN - Administrador
- CLIENT - Cliente
- EMPLOYEE - Funcionário
- PROFESSIONAL - Prestador de Serviço

### Atributos

| Nome       | Descrição                  |
| ---------- | -------------------------- |
| id         | Identificador único        |
| name       | Nome da pessoa             |
| document   | Documento de identificação |
| birthDate  | Data de nascimento         |
| profession | Profissão                  |
| companyId  | Código da empresa          |

### Relacionamentos

- Uma pessoa pertence a uma empresa.

---
