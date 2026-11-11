# Domínio: Pessoas

> Parte de [`domain/`](README.md). Clientes e profissionais, contatos, endereços, estados e cidades.

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
- Uma cidade pode estar associada a vários endereços.

---

## People

- Representa uma pessoa cadastrada na aplicação.

### Tipos de Pessoa (PeopleType)

- CLIENT - Cliente
- EMPLOYEE - Funcionário
- PROFESSIONAL - Prestador de Serviço

### Atributos

| Nome       | Descrição                     |
| ---------- | ----------------------------- |
| id         | Identificador único           |
| name       | Nome da pessoa                |
| document   | CPF da pessoa (opcional)      |
| birthDate  | Data de nascimento (opcional) |
| profession | Profissão (opcional)          |
| type       | Tipo de pessoa                |
| note       | Observações (opcional)        |
| photoUrl   | Caminho da foto (opcional)    |
| companyId  | Código da empresa             |
| clientAccountId | Conta do cliente no app ligada a este cadastro (opcional; no máximo um cadastro ativo por conta em cada empresa) |
| portalConfirmed | `false` quando o cliente entrou sozinho pelo app e a clínica ainda não confirmou (padrão: `true`) |

- Telefone e e-mail da pessoa ficam nos contatos (`Contact`).

### Relacionamentos

- Uma pessoa pertence a uma empresa.
- Uma pessoa pode ter mais de um endereço.
- Uma pessoa pode ter mais de um contato.
- Uma pessoa participa de agendamentos como cliente ou como profissional.

---

## Contact

- Representa os contatos de uma empresa ou de uma Pessoa

### Tipos de Contato (ContactType)

O tipo indica a finalidade do contato; qual deles é exibido é definido por `isPrincipal`.

- MAIN - Pessoal
- MESSAGE - Recados
- BRANCH - Filial

### Atributos

| Nome        | Descrição                                 |
| ----------- | ----------------------------------------- |
| id          | Identificador único                       |
| type        | Tipo de contato                           |
| phone       | Telefone (opcional)                       |
| email       | E-mail (opcional)                         |
| isPrincipal | Contato exibido para o dono (padrão: não) |
| companyId   | Código da empresa (opcional)              |
| peopleId    | Código da Pessoa (opcional)               |

### Relacionamentos

- Um contato pode pertencer a uma empresa ou a uma pessoa (campos opcionais)

---

## Address

- Representa os endereços de uma empresa ou de uma Pessoa

### Tipos de Endereço (AddressType)

O tipo indica a finalidade do endereço; qual deles é exibido é definido por `isPrincipal`.

- MAIN - Pessoal
- MESSAGE - Recados
- BRANCH - Filial

### Atributos

| Nome         | Descrição                                  |
| ------------ | ------------------------------------------ |
| id           | Identificador único                        |
| type         | Tipo de endereço                           |
| cep          | Código postal                              |
| street       | Logradouro                                 |
| neighborhood | Bairro (opcional)                          |
| number       | Número                                     |
| complement   | Complemento (opcional)                     |
| isPrincipal  | Endereço exibido para o dono (padrão: não) |
| peopleId     | Código da Pessoa (opcional)                |
| companyId    | Código da empresa (opcional)               |
| cityId       | Código da cidade                           |

### Relacionamentos

- Um endereço pode pertencer a uma empresa ou a uma pessoa (campos opcionais).
- Um endereço pertence a uma cidade.

---
