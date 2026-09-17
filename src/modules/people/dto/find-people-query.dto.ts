import { IsEnum, IsNotEmpty, IsOptional, IsString } from "class-validator";
import { PeopleType } from "../../../../generated/prisma/enums";
import { PaginationQueryDto } from "../../../common/dto/pagination-query.dto";

export class FindPeopleQueryDto extends PaginationQueryDto {
  // Busca parcial, sem diferenciar acentos nem maiúsculas.
  @IsOptional()
  @IsString()
  @IsNotEmpty()
  name?: string;

  // Busca exata pelo CPF (sem máscara).
  @IsOptional()
  @IsString()
  @IsNotEmpty()
  document?: string;

  @IsOptional()
  @IsEnum(PeopleType)
  type?: PeopleType;
}
