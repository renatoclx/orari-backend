# Domínio: Anamnese

> Parte de [`domain/`](README.md). Modelos, versões, perguntas, fichas, registros e respostas.

## Anamnese

> **Em desenho:** as entidades desta seção ainda não foram implementadas. As regras de
> funcionamento estão em `business-rules/anamnese.md` ("Anamnese").

A anamnese é a ficha de saúde de um cliente. A empresa monta os **modelos** (perguntas
e tipos de resposta), o profissional preenche uma **ficha** por cliente e por modelo, e
a evolução do cliente é acompanhada, visita a visita, na mesma ficha.

## AnamnesisTemplate

- Representa um modelo de ficha da empresa (ex.: "Fisioterapia", "Pilates").

### Atributos

| Nome           | Descrição                                    |
| -------------- | -------------------------------------------- |
| id             | Identificador único                          |
| companyId      | Código da empresa                            |
| name           | Nome do modelo                               |
| normalizedName | Nome sem acentos e em minúsculas, para busca |
| description    | Descrição do modelo (opcional)               |
| isActive       | Modelo ativo ou inativo                      |
| createdAt      | Data de criação                              |
| updatedAt      | Data da última alteração                     |

### Relacionamentos

- Um modelo pertence a uma empresa.
- Um modelo possui uma ou mais versões (AnamnesisTemplateVersion).
- Um modelo pode ser usado por várias fichas (Anamnesis).

---

## AnamnesisTemplateVersion

- Representa uma versão imutável do modelo: o conjunto de perguntas em um momento.

### Atributos

| Nome        | Descrição                            |
| ----------- | ------------------------------------ |
| id          | Identificador único                  |
| templateId  | Código do modelo                     |
| version     | Número da versão, a partir de 1      |
| createdById | Código do usuário que criou a versão |
| createdAt   | Data de criação                      |

### Relacionamentos

- Uma versão pertence a um modelo.
- Uma versão possui uma ou mais perguntas (AnamnesisQuestion).
- Uma versão pode ser usada por várias fichas (Anamnesis).

---

## AnamnesisQuestion

- Representa uma pergunta de uma versão do modelo.

### Tipos de pergunta (AnamnesisQuestionType)

- SHORT_TEXT - Texto curto
- LONG_TEXT - Texto longo
- YES_NO - Sim ou não, com detalhe opcional
- SINGLE_CHOICE - Escolha única entre opções
- MULTIPLE_CHOICE - Escolha de várias opções
- NUMBER - Número
- DATE - Data
- SCALE - Escala de 0 a 10

### Atributos

| Nome        | Descrição                                                     |
| ----------- | ------------------------------------------------------------- |
| id          | Identificador único                                           |
| versionId   | Código da versão do modelo                                    |
| position    | Posição da pergunta no modelo                                 |
| label       | Texto da pergunta                                             |
| helpText    | Texto de ajuda (opcional)                                     |
| type        | Tipo da pergunta                                              |
| isRequired  | Resposta obrigatória ou não                                   |
| options     | Opções de resposta (para escolha única e múltipla)            |
| detailLabel | Texto do detalhe, ex.: "Qual?" (opcional, só para sim ou não) |

### Relacionamentos

- Uma pergunta pertence a uma versão do modelo.
- Uma pergunta pode ter várias respostas (AnamnesisAnswer).

---

## Anamnesis

- Representa a ficha de um cliente em um modelo. É o dossiê ao qual os registros se ligam.
- Fica presa à versão do modelo em que foi criada.

### Atributos

| Nome       | Descrição                        |
| ---------- | -------------------------------- |
| id         | Identificador único              |
| companyId  | Código da empresa                |
| clientId   | Código do cliente (People)       |
| templateId | Código do modelo                 |
| versionId  | Código da versão do modelo usada |
| createdAt  | Data de criação da ficha         |

### Relacionamentos

- Uma ficha pertence a uma empresa e a um cliente.
- Uma ficha usa um modelo e uma versão dele.
- Uma ficha possui um ou mais registros (AnamnesisEntry).
- Existe uma ficha por cliente e por modelo.

---

## AnamnesisEntry

- Representa um registro do histórico da ficha: o registro inicial ou um acompanhamento
  feito pelo profissional em uma consulta. É imutável.

### Tipos de registro (AnamnesisEntryKind)

- INITIAL - Registro inicial, com as respostas do modelo
- FOLLOW_UP - Acompanhamento de uma consulta

### Atributos

| Nome                 | Descrição                                                        |
| -------------------- | ---------------------------------------------------------------- |
| id                   | Identificador único                                              |
| anamnesisId          | Código da ficha                                                  |
| kind                 | Tipo do registro                                                 |
| consultationDate     | Data da consulta a que o registro se refere                      |
| appointmentId        | Código do agendamento da visita (opcional)                       |
| evolution            | Texto da evolução (criptografado; obrigatório no acompanhamento) |
| authorUserId         | Código do usuário que registrou                                  |
| authorProfessionalId | Código do profissional vinculado ao usuário (opcional)           |
| createdAt            | Data e hora em que o registro foi gravado                        |

### Relacionamentos

- Um registro pertence a uma ficha.
- Um registro pode apontar para um agendamento.
- Um registro possui respostas (AnamnesisAnswer).

---

## AnamnesisAnswer

- Representa a resposta a uma pergunta em um registro.
- No acompanhamento, só as perguntas que mudaram têm resposta nova; a situação atual da
  ficha é a resposta mais recente de cada pergunta.

### Atributos

| Nome       | Descrição                |
| ---------- | ------------------------ |
| id         | Identificador único      |
| entryId    | Código do registro       |
| questionId | Código da pergunta       |
| value      | Resposta (criptografada) |

### Relacionamentos

- Uma resposta pertence a um registro e a uma pergunta.

---
