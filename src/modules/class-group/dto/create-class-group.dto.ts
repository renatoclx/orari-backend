import { Type } from "class-transformer";
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsInt,
  IsNotEmpty,
  IsOptional,
  IsString,
  IsUUID,
  Max,
  MaxLength,
  Min,
  ValidateNested,
} from "class-validator";
import { ClassGroupDayDto } from "./class-group-day.dto";

// Limites da turma (ver docs/turmas.md).
export const CLASS_GROUP_NAME_MAX = 100;
export const CLASS_GROUP_CAPACITY_MIN = 2;
export const CLASS_GROUP_CAPACITY_MAX = 100;
export const CLASS_GROUP_DAYS_MAX = 21;

// A empresa não é informada: a turma pertence à empresa do usuário autenticado.
export class CreateClassGroupDto {
  /** Opcional e não único: serve só para identificar a turma. */
  @IsOptional()
  @IsString()
  @IsNotEmpty()
  @MaxLength(CLASS_GROUP_NAME_MAX)
  name?: string;

  /** Serviço ativo da empresa que aceita turma (`allowsClasses`). */
  @IsUUID("all")
  serviceId!: string;

  /** Pessoa do tipo PROFESSIONAL da empresa. */
  @IsUUID("all")
  professionalId!: string;

  /** Quantidade máxima de alunos por sessão. */
  @Type(() => Number)
  @IsInt()
  @Min(CLASS_GROUP_CAPACITY_MIN)
  @Max(CLASS_GROUP_CAPACITY_MAX)
  capacity!: number;

  /** Dias e horários da turma; dois horários do mesmo dia não podem se sobrepor. */
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(CLASS_GROUP_DAYS_MAX)
  @ValidateNested({ each: true })
  @Type(() => ClassGroupDayDto)
  days!: ClassGroupDayDto[];
}
