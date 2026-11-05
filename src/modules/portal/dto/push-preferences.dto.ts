import { IsBoolean } from "class-validator";

/** Os dois interruptores dos avisos do app (Menu do cliente). */
export class PushPreferencesDto {
  // Lembretes de horário e avisos de agendamento marcado, alterado ou cancelado.
  @IsBoolean()
  notifyAppointments!: boolean;

  // Aniversário, "sentimos sua falta" e mensagens da clínica.
  @IsBoolean()
  notifyPromotions!: boolean;
}
