# E-mail

O Orari tem **dois** assuntos de e-mail, independentes:

| Assunto                        | Quem faz            | Para quê                                              | Endereço                         |
| ------------------------------ | ------------------- | ----------------------------------------------------- | -------------------------------- |
| **E-mails do sistema**         | **Resend**          | O sistema envia sozinho (hoje: "Esqueci minha senha") | `nao-responda@orariapp.com.br`   |
| **Caixa de e-mail do domínio** | **uni5** (cortesia) | Pessoas enviam e recebem (webmail)                    | contas criadas no painel do uni5 |

Conceitos (SPF, DKIM, DMARC) em [conceitos.md](conceitos.md#autenticação-de-e-mail-spf-dkim-e-dmarc).

---

## Parte 1: Resend (e-mails do sistema)

### O que é e por que

Enviar e-mail "na mão" (um servidor SMTP próprio) é difícil: os provedores (Gmail,
Outlook) desconfiam de servidores desconhecidos e mandam tudo para o spam. Um
**serviço de envio** (Resend, SendGrid, Amazon SES, Postmark) já tem boa
reputação e cuida da entrega.

**Por que o Resend:** API simples (um `POST` com JSON), plano grátis suficiente
(3.000 e-mails por mês, 100 por dia), região em **São Paulo** e painel com o
histórico de cada envio.

### Como o código usa

- **`src/modules/mail/mail.service.ts`:** o único lugar que fala com o Resend. Um
  `POST https://api.resend.com/emails` com o remetente, destinatário, assunto,
  texto e HTML.
  - **Com `RESEND_API_KEY`:** envia de verdade.
  - **Sem a chave, no desenvolvimento:** não envia; escreve o e-mail no **log da
    API** (é assim que se testa local: o link aparece no terminal).
  - **Sem a chave, em produção:** recusa o envio (erro 503). Nunca escreve o link
    no log em produção, porque o log não é lugar de segredo.
- **`MAIL_FROM`:** o remetente. Precisa ser de um domínio **verificado** no Resend.
  Padrão: `Orari <nao-responda@orariapp.com.br>`.

### O "Esqueci minha senha" (o fluxo completo)

1. A pessoa informa o e-mail em `/esqueci-senha`.
2. A API procura a conta. **A resposta é sempre a mesma**, exista a conta ou não
   (assim ninguém descobre quem tem conta).
3. Se existe: gera um token aleatório, guarda no banco **só o hash** dele (tabela
   `password_reset_tokens`) com validade de **1 hora**, e manda o link
   `https://app.orariapp.com.br/redefinir-senha?token=…` pelo Resend.
4. A pessoa abre o link e escolhe a senha nova. A API confere o hash, a validade e
   se o link já foi usado; troca a senha, invalida os outros links da pessoa e
   **encerra todas as sessões** (os aparelhos conectados precisam entrar de novo).

**Proteções:** no máximo 5 pedidos a cada 15 minutos por IP, 1 e-mail por minuto
para a mesma conta, link de uso único, e a falha no envio não aparece para quem
pediu (fica só no log).

### Configurar do zero

1. **Conta:** [resend.com](https://resend.com), com a conta Google do Orari.
2. **Domínio:** Domains → **Add Domain** → `orariapp.com.br`, região **São Paulo
   (sa-east-1)**.
3. **DNS:** o Resend mostra os registros. Crie no Cloudflare, **à mão** (não use o
   "Auto configure", que pode mexer no que já existe), todos em **DNS only**:
   - TXT `resend._domainkey` (DKIM),
   - CNAME `send` e CNAME `rsend` (envio e SPF),
   - TXT `_dmarc` = `v=DMARC1; p=none;`.

   Valores em [dns-cloudflare.md](dns-cloudflare.md#envio-de-e-mail-do-sistema-resend).
   **Deixe "Enable receiving" desligado:** ele pede um MX no `@`, que desviaria os
   e-mails da caixa do uni5.

4. **Verificar:** Domains → `orariapp.com.br` → **Verify**. Todos os registros
   ficam "Verified" (de minutos a 1 hora).
5. **Chave:** API Keys → **Create API key**:
   - Name: `orari-producao`;
   - Permission: **Sending access** (só envia; não lê nem apaga nada);
   - Domain: `orariapp.com.br`.

   A chave (`re_…`) aparece **uma vez**: guarde no gerenciador de senhas.

6. **Na VPS**, sem a chave aparecer na tela:

   ```bash
   cd ~/orari-backend
   read -rs -p "Cole a chave do Resend e tecle Enter: " KEY; echo
   echo "RESEND_API_KEY=$KEY" >> .env.production
   unset KEY
   echo 'MAIL_FROM="Orari <nao-responda@orariapp.com.br>"' >> .env.production
   grep -c '^RESEND_API_KEY=re_' .env.production   # 1
   grep -c '^MAIL_FROM=' .env.production           # 1
   ```

   O `KEY` é o **nome** da variável temporária: não troque pela chave. O terminal
   para e pede, e só então você cola.

7. **Aplicar:** `dcp up -d api` (recria a API lendo a variável nova; `restart` não
   basta).

### Conferir

- **Teste real:** "Esqueci minha senha" em `https://app.orariapp.com.br/login`
  com um e-mail seu, real e com conta. Chega em segundos (confira o spam).
- **No Resend → Logs / Emails:** cada envio, com o status (**Delivered**,
  Bounced…).
- **Na VPS:** `dcp logs --tail 100 api | grep -i mail` (a chave nunca aparece no
  log).

### Trocar a chave

1. Resend → API Keys → crie uma nova (mesmas opções).
2. Na VPS: apague a linha antiga e grave a nova:
   ```bash
   cd ~/orari-backend
   sed -i '/^RESEND_API_KEY=/d' .env.production
   ```
   e repita o passo 6 (só as linhas do `RESEND_API_KEY`).
3. `dcp up -d api`, teste, e só então **delete a chave antiga** no Resend.

### Problemas comuns

| Sintoma                          | Causa e solução                                                                              |
| -------------------------------- | -------------------------------------------------------------------------------------------- |
| Domínio não verifica um registro | Nuvem **laranja** no Cloudflare (o `dig` mostra IPs do Cloudflare): mude para DNS only       |
| E-mail não chega e o log diz 503 | Falta `RESEND_API_KEY` na API: grave e use `dcp up -d api`                                   |
| Erro 403 / "domain not verified" | `MAIL_FROM` com um domínio que não está verificado no Resend                                 |
| Cai no spam                      | Confira DKIM e `send` "Verified" no Resend; evite textos de propaganda no e-mail             |
| Usuário não recebe nunca         | O e-mail da conta não existe (ex.: domínios fictícios de teste). No Resend aparece "Bounced" |
| Bateu o limite                   | Plano grátis: 100/dia. Para mais, plano pago                                                 |

**E-mails fictícios prejudicam:** mandar para endereços que não existem gera
"devoluções" (bounces), e o Resend pode limitar a conta. Usuários de teste com
domínios inventados devem ser trocados por e-mails reais.

---

## Parte 2: a caixa de e-mail do domínio (uni5)

Um amigo cedeu uma conta no provedor **uni5**, que dá caixas de e-mail
`@orariapp.com.br` com webmail.

- **Webmail:** `https://webmail.orariapp.com.br` (ou o endereço do painel do uni5).
- **Contas e senhas:** criadas no painel do uni5 (guarde no gerenciador de senhas).
- **Em programas de e-mail** (Thunderbird, celular): servidor de entrada
  `pop.orariapp.com.br` (POP/IMAP) e de saída `smtp.orariapp.com.br` (SMTP).

**Registros que fazem a caixa funcionar:** MX (`@` → `mx-vip-01/02.uni5.net`) para
receber, SPF (`@` → `v=spf1 include:_spf.uni5.net -all`) para os e-mails enviados
não caírem no spam, e os CNAMEs `pop`, `smtp`, `webmail`. Detalhes em
[dns-cloudflare.md](dns-cloudflare.md#caixa-de-e-mail-do-domínio-uni5-cedida-por-um-amigo).

**Testes feitos na configuração:** e-mail enviado de um Gmail chegou no webmail
(recebimento OK), e e-mail enviado pelo webmail não caiu no spam (SPF OK).

**Por que não usamos a caixa do uni5 para os e-mails do sistema:** um serviço de
envio (Resend) tem melhor entrega, histórico de envios, API e não depende de uma
cortesia. Os dois convivem porque usam nomes diferentes no DNS (o Resend usa
`send`, `rsend` e `resend._domainkey`; a caixa usa o `@`, `pop`, `smtp` e
`webmail`).

## Para outros projetos

- **Sempre separe** "e-mail do sistema" (serviço de envio) de "caixa de e-mail"
  (Google Workspace, Zoho, uni5…).
- **Um módulo só** no código fala com o serviço de envio, com o modo "só escreve no
  log" para desenvolvimento e "recusa" em produção sem chave.
- **Chave com a menor permissão** possível (só envio, só um domínio).
- **Endereço `nao-responda@`** para e-mails automáticos, com um texto dizendo onde
  pedir ajuda.
