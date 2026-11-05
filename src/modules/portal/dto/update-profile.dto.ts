import { Transform, Type } from "class-transformer";
import {
  IsDate,
  IsEmail,
  IsOptional,
  IsString,
  IsUUID,
  Matches,
  MaxLength,
  MinLength,
  ValidateNested,
} from "class-validator";
import { IsCpf } from "../../../common/validators/document.validator";

const trim = ({ value }: { value: unknown }) =>
  typeof value === "string" ? value.trim() : value;

/** Endereço principal do cliente (o mesmo formato dos endereços das pessoas). */
export class ProfileAddressDto {
  @Matches(/^\d{8}$/, { message: "cep deve conter 8 dígitos, sem máscara" })
  cep!: string;

  @Transform(trim)
  @IsString()
  @MinLength(1)
  @MaxLength(200)
  street!: string;

  @Transform(trim)
  @IsString()
  @MinLength(1)
  @MaxLength(20)
  number!: string;

  @IsOptional()
  @Transform(trim)
  @IsString()
  @MaxLength(100)
  complement?: string | null;

  @IsOptional()
  @Transform(trim)
  @IsString()
  @MaxLength(100)
  neighborhood?: string | null;

  @IsUUID()
  cityId!: string;
}

/**
 * "Meus dados" do app: o cadastro inteiro de uma vez (PUT). Campo opcional que
 * não vem fica vazio. Trocar o telefone (o login) pede a senha atual.
 */
export class UpdateProfileDto {
  @Transform(trim)
  @IsString()
  @MinLength(2)
  @MaxLength(100)
  name!: string;

  /** Telefone com DDD (máscara e +55 são aceitos). É o login da conta. */
  @IsString()
  @MaxLength(30)
  phone!: string;

  @IsOptional()
  @Transform(trim)
  @IsEmail({}, { message: "Informe um e-mail válido" })
  @MaxLength(254)
  email?: string | null;

  /** CPF sem máscara. */
  @IsOptional()
  @IsCpf()
  document?: string | null;

  @IsOptional()
  @Type(() => Date)
  @IsDate()
  birthDate?: Date | null;

  @IsOptional()
  @Transform(trim)
  @IsString()
  @MaxLength(100)
  profession?: string | null;

  @IsOptional()
  @ValidateNested()
  @Type(() => ProfileAddressDto)
  address?: ProfileAddressDto | null;

  /** Exigida só quando o telefone muda. */
  @IsOptional()
  @IsString()
  @MaxLength(72)
  currentPassword?: string;
}

/** Cidade pelo nome e pela UF, como o CEP devolve. */
export class FindCityQueryDto {
  @IsString()
  @MinLength(2)
  @MaxLength(100)
  name!: string;

  @Matches(/^[A-Za-z]{2}$/, { message: "state deve ser a UF, com 2 letras" })
  state!: string;
}
