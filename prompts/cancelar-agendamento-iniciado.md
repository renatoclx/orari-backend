O frontend (Next.js) só oferece "Cancelar agendamento" enquanto o agendamento ainda não iniciou, mas a API não impõe essa regra. Preciso de 1 mudança na API. Siga o CLAUDE.md (plano, aprovação, código, testes) e não faça nada fora do escopo.

**Cancelar só antes de iniciar.** Hoje `PATCH /appointments/:id` com `status: CANCELLED` (AppointmentService.update) aceita cancelar um agendamento avulso em qualquer status e horário, inclusive em andamento, concluído, não compareceu ou no passado. Só o agendamento de recorrência é protegido (cancelado pela recorrência), e isso não muda.

Regra nova:

- Só pode ser cancelado um agendamento em `SCHEDULED` ou `CONFIRMED` cujo `startAt` ainda seja futuro (`startAt > agora`).
- Compare o horário, e não só o status: o job de status roda a cada 5 minutos, então um agendamento que já começou pode ainda estar `SCHEDULED` ou `CONFIRMED`.
- Fora disso: 400 (`BadRequestException`) com mensagem em pt-BR, por exemplo "Agendamento que já iniciou não pode ser cancelado". Nada é alterado. Se o status atual for outro que não permite cancelar (concluído, não compareceu), a mesma 400, com mensagem coerente.
- Cancelar um agendamento que já está `CANCELLED`: me diga como tratou (sugestão: aceitar sem efeito, ou 400; escolha a mais simples e coerente com o restante do código).
- O que continua permitido, sem mudança: alterar a observação de qualquer agendamento; remarcar, trocar serviço, cliente ou profissional (as regras atuais de data futura, janela, encaixe e conflito); mudar para os demais status. A restrição vale só para a transição para `CANCELLED`.
- A transição para `CANCELLED` combinada com outros campos no mesmo PATCH também passa pela regra.

**Pagamento pendente.** Um agendamento avulso concluído gera um pagamento `PENDING`. Com a regra nova, um concluído não pode mais ser cancelado, então esse caso desaparece. Confirme se existe algum outro caminho em que um agendamento avulso cancelado fique com pagamento `PENDING` sem ser cancelado (cancelar só a recorrência cancela o pagamento junto) e me diga o que encontrou, sem mudar nada além do pedido sem a minha aprovação.

Testes (vitest) cobrindo: cancelar agendado e confirmado futuros (ok); cancelar em andamento, concluído e não compareceu (400); cancelar agendado ou confirmado cujo `startAt` já passou ou é agora (400, mesmo com o status ainda `SCHEDULED`); cancelar já cancelado (como você decidiu); cancelar junto com outros campos; a recorrência continua como está; alterar observação de um agendamento já iniciado continua permitido.

Atualize `docs/business-rules.md` (seção Agendamentos: só se cancela antes de iniciar) e o Swagger (400 no PATCH). Em `docs/technical-debt.md`, remova ou marque como resolvida a dívida "Cancelamento de agendamento que já iniciou", se ela estiver lá. Sem push.

**Ao final, devolva:** a regra implementada, a mensagem e o status de erro, o que decidiu sobre o já cancelado, o que encontrou sobre pagamento pendente, e os arquivos alterados.
