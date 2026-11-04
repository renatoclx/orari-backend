import { IsString, Matches, MaxLength } from "class-validator";

export class VerifyCodeDto {
  @IsString()
  @MaxLength(30)
  phone!: string;

  /** Os 6 dígitos recebidos no WhatsApp. */
  @Matches(/^\d{6}$/, { message: "O código tem 6 dígitos" })
  code!: string;
}
