import {
  IsBoolean,
  IsEnum,
  IsInt,
  IsOptional,
  Max,
  Min,
} from "class-validator";
import { BusinessSegment } from "../../../../generated/prisma/enums";

export class UpdatePortalSettingsDto {
  /** Portal disponível para os clientes. */
  @IsBoolean()
  enabled!: boolean;

  /** Antecedência mínima para agendar, em minutos (0 a 7 dias). */
  @IsInt()
  @Min(0)
  @Max(7 * 24 * 60)
  minAdvanceMinutes!: number;

  /** Até quantos dias à frente o cliente agenda (1 a 365). */
  @IsInt()
  @Min(1)
  @Max(365)
  maxDaysAhead!: number;

  /** Até quantas horas antes o cliente cancela (0 a 30 dias). */
  @IsInt()
  @Min(0)
  @Max(30 * 24)
  cancelUntilHours!: number;

  /**
   * Aparecer na busca de estabelecimentos do app. Sem o campo, fica como está
   * (as telas antigas não o enviam).
   */
  @IsOptional()
  @IsBoolean()
  listed?: boolean;

  /** Ramo do estabelecimento; obrigatório para aparecer na busca. Sem o campo, fica como está. */
  @IsOptional()
  @IsEnum(BusinessSegment)
  segment?: BusinessSegment;
}
