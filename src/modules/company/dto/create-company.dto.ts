import { Transform, Type } from "class-transformer";
import {
  IsBoolean,
  IsDate,
  IsNotEmpty,
  IsOptional,
  IsString,
  Matches,
} from "class-validator";
import { IsCnpj } from "../../../common/validators/document.validator";
import { IsTimeZone } from "../../../common/validators/time-zone.validator";

export class CreateCompanyDto {
  @IsString()
  @IsNotEmpty()
  corporateReason!: string;

  @IsOptional()
  @IsString()
  @IsNotEmpty()
  fantasyName?: string;

  // O CNPJ alfanumérico usa letras maiúsculas; normalizar evita recusar "12abc..." por caixa.
  @Transform(({ value }: { value: unknown }) =>
    typeof value === "string" ? value.toUpperCase() : value,
  )
  @IsCnpj()
  cnpj!: string;

  @Type(() => Date)
  @IsDate()
  foundationDate!: Date;

  @IsOptional()
  @IsBoolean()
  isActive?: boolean;

  // Define em que relógio valem as janelas de atendimento e as recorrências.
  @IsOptional()
  @IsTimeZone()
  timezone?: string;

  @IsOptional()
  @IsString()
  @IsNotEmpty()
  logoUrl?: string;

  @Matches(/^[a-z0-9]+(-[a-z0-9]+)*$/, {
    message: "subdomain deve conter apenas letras minúsculas, números e hífens",
  })
  subdomain!: string;
}
