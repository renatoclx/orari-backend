import { Transform, Type } from "class-transformer";
import {
  ArrayMaxSize,
  ArrayMinSize,
  ArrayUnique,
  IsArray,
  IsBoolean,
  IsIn,
  IsOptional,
  IsString,
  MaxLength,
  MinLength,
  ValidateNested,
} from "class-validator";
import type { AutoMessageKind } from "../../../../generated/prisma/enums";
import {
  AUTO_MESSAGE_KINDS,
  MISS_YOU_DAYS,
  REMINDER_OFFSETS,
} from "../auto-message.catalog";

const trim = ({ value }: { value: unknown }) =>
  typeof value === "string" ? value.trim() : value;

/** Uma situação: ligada, o texto e as opções dela. */
export class AutoMessageItemDto {
  @IsIn(AUTO_MESSAGE_KINDS)
  kind!: AutoMessageKind;

  @IsBoolean()
  enabled!: boolean;

  @Transform(trim)
  @IsString()
  @MinLength(1)
  @MaxLength(500)
  body!: string;

  // Só o lembrete usa (minutos antes: 30, 60, 120, 1440 ou 2880).
  @IsOptional()
  @IsArray()
  @ArrayUnique()
  @ArrayMaxSize(REMINDER_OFFSETS.length)
  @IsIn(REMINDER_OFFSETS, { each: true })
  reminderOffsets?: number[];

  // Só o "sentimos sua falta" usa (15, 30, 45, 60 ou 90).
  @IsOptional()
  @IsIn(MISS_YOU_DAYS)
  missYouDays?: number;
}

/** As situações que mudam (as que não vêm ficam como estão). */
export class UpdateAutoMessagesDto {
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(AUTO_MESSAGE_KINDS.length)
  @ValidateNested({ each: true })
  @Type(() => AutoMessageItemDto)
  items!: AutoMessageItemDto[];
}
