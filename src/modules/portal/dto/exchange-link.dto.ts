import { IsString, MaxLength, MinLength } from "class-validator";

export class ExchangeLinkDto {
  /** O token do link de acesso gerado pela clínica. */
  @IsString()
  @MinLength(20)
  @MaxLength(100)
  token!: string;
}
