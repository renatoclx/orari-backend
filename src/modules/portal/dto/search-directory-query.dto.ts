import { Transform } from "class-transformer";
import { IsString, MaxLength, MinLength } from "class-validator";

export class SearchDirectoryQueryDto {
  /** Parte do nome do estabelecimento (acentos e maiúsculas não importam). */
  @Transform(({ value }: { value: unknown }) =>
    typeof value === "string" ? value.trim() : value,
  )
  @IsString()
  @MinLength(2)
  @MaxLength(100)
  q!: string;
}
