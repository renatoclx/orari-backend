/**
 * Anúncios do que a clínica fez num agendamento. O módulo de agendamentos só
 * anuncia, depois de gravar; quem quiser reagir (as mensagens automáticas)
 * escuta, sem que os módulos dependam um do outro. O que o cliente faz pelo app
 * tem anúncios à parte (`createdByClient`, `cancelledByClient`): as mensagens
 * automáticas não os escutam, e as notificações da equipe, sim.
 */
export const APPOINTMENT_EVENTS = {
  // A clínica marcou um avulso (as sessões criadas em lote não contam).
  created: "appointment.created",
  // A clínica mudou a data ou o horário (alterar, remanejar ou repor).
  rescheduled: "appointment.rescheduled",
  // A clínica cancelou um agendamento (avulso ou uma sessão de recorrência).
  cancelled: "appointment.cancelled",
  // A clínica cancelou uma sessão de turma: todos os alunos dela.
  classSessionCancelled: "class-session.cancelled",
  // O cliente marcou ou cancelou um avulso pelo app: não vira mensagem para ele
  // (foi ele quem fez), mas a clínica e o profissional são avisados.
  createdByClient: "appointment.created-by-client",
  cancelledByClient: "appointment.cancelled-by-client",
} as const;

export interface AppointmentEvent {
  appointmentId: string;
  companyId: string;
}

export interface ClassSessionCancelledEvent {
  classSessionId: string;
  companyId: string;
}
