# Regras de negócio: Serviços

> Parte de [`business-rules/`](README.md). O catálogo de serviços da empresa.

## Serviços

- Um serviço pertence à empresa do usuário que o cadastrou; a empresa não é informada no payload.
- O nome do serviço é único entre os serviços não excluídos da mesma empresa.
- A duração é informada em minutos e é o que define o fim dos agendamentos desse serviço.
- Serviços inativos não podem ser usados em novos agendamentos nem em recorrências.
- A cor (`color`), quando informada, deve ser uma string hexadecimal válida (`#RGB` ou `#RRGGBB`).
- O serviço pode aceitar atendimento em turma (`allowsClasses`, padrão: não aceita). Um serviço com turma ativa não pode deixar de aceitar turma (409): as turmas precisam ser inativadas antes.
- Um serviço só pode ser excluído se não tiver nenhum relacionamento: agendamentos, agendamentos recorrentes, itens de plano ou turmas. Contam todos os registros, inclusive cancelados ou encerrados, porque o histórico precisa continuar apontando para o serviço.
- Com relacionamento, a exclusão é recusada (409), nada é alterado, e o caminho é inativar o serviço (`isActive` falso). Serviço inexistente ou de outra empresa responde 404.
- Um plano não é excluído (só inativado), e os serviços de um plano editado deixam de ser seus itens: por isso um serviço que consta na composição de qualquer plano, ativo ou não, não pode ser excluído.
- **Comissão** (2026-11-10, etapa 1 da comissão): o serviço pode ter a comissão do profissional por atendimento, em `commissionType` (`PERCENT`, do valor cobrado, de 0,01 a 100; ou `FIXED`, valor por atendimento, maior que zero, até duas casas) e `commissionValue`. Os dois andam juntos: tipo sem valor ou valor sem tipo é 400; `commissionType: null` tira a comissão (o valor sai junto); na alteração, o que não for enviado vem do que está gravado. Serviço sem comissão não gera comissão. **Só o ADMIN** define (os demais recebem 403 ao enviar esses campos) e vê (as respostas de serviço não trazem os dois campos para os demais). A comissão vale do momento em que for definida em diante: atendimentos concluídos antes não geram comissão.
