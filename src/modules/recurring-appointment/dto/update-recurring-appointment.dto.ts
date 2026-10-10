import {
  Equals,
  IsBoolean,
  IsNotEmpty,
  IsOptional,
  IsString,
} from "class-validator";

/**
 * A agenda não é regenerada: depois de criada, a recorrência só aceita mudar a
 * observação ou ser cancelada. Para mudar dias, período, serviço, cliente ou
 * profissional, encerra-se esta e cria-se outra.
 */
export class UpdateRecurringAppointmentDto {
  @IsOptional()
  @IsString()
  @IsNotEmpty()
  note?: string;

  /** Só aceita false: uma recorrência cancelada não é reativada. */
  @IsOptional()
  @IsBoolean()
  @Equals(false)
  isActive?: boolean;
}
