import { Transform } from "class-transformer";
import { ArrayMaxSize, ArrayMinSize, IsArray, IsUUID } from "class-validator";

/** Máximo de agendamentos por consulta (cabe folgado na URL). */
export const MAX_ENTRY_APPOINTMENTS = 100;

export class FindEntryAppointmentsQueryDto {
  /** Agendamentos a conferir, separados por vírgula (ex.: os do dia na agenda). */
  // Query string chega como texto: "a,b,c" vira lista; um valor repetido (?x=a&x=b) já é lista.
  @Transform(({ value }: { value: unknown }) =>
    typeof value === "string" ? value.split(",").filter(Boolean) : value,
  )
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(MAX_ENTRY_APPOINTMENTS)
  @IsUUID("all", { each: true })
  appointmentIds!: string[];
}
