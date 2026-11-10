import { Type } from "class-transformer";
import {
  IsBoolean,
  IsEnum,
  IsInt,
  IsNotEmpty,
  IsNumber,
  IsOptional,
  IsString,
  Matches,
  Min,
} from "class-validator";
import { CommissionType } from "../../../../generated/prisma/enums";

// A empresa não é informada: o serviço pertence à empresa do usuário autenticado.
export class CreateServiceDto {
  @IsString()
  @IsNotEmpty()
  name!: string;

  @IsOptional()
  @IsString()
  @IsNotEmpty()
  description?: string;

  @IsOptional()
  @Type(() => Number)
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  price?: number;

  /** Em minutos: define o fim dos agendamentos deste serviço. */
  @Type(() => Number)
  @IsInt()
  @Min(1)
  duration!: number;

  @IsOptional()
  @IsBoolean()
  isActive?: boolean;

  /** Aceita atendimento em turma (padrão: não aceita). */
  @IsOptional()
  @IsBoolean()
  allowsClasses?: boolean;

  /**
   * Comissão do profissional (só o ADMIN define): PERCENT (do valor cobrado) ou
   * FIXED (valor por atendimento). `null` tira a comissão.
   */
  @IsOptional()
  @IsEnum(CommissionType, { message: "Tipo de comissão inválido" })
  commissionType?: CommissionType | null;

  /** Percentual (0,01 a 100) ou valor fixo (maior que zero); `null` tira. */
  @IsOptional()
  @Type(() => Number)
  @IsNumber(
    { maxDecimalPlaces: 2 },
    { message: "Informe a comissão com até duas casas decimais" },
  )
  @Min(0.01, { message: "A comissão precisa ser maior que zero" })
  commissionValue?: number | null;

  @IsOptional()
  @Matches(/^#([0-9A-Fa-f]{3}|[0-9A-Fa-f]{6})$/, {
    message: "color deve ser uma cor hexadecimal válida (ex.: #3BB2F6 ou #FFF)",
  })
  color?: string;
}
