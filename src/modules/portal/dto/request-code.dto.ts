import { IsString, MaxLength } from "class-validator";

export class RequestCodeDto {
  /** Telefone do cliente, com DDD (máscara e +55 são aceitos). */
  @IsString()
  @MaxLength(30)
  phone!: string;
}
