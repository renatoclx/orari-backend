import { IsEmail } from "class-validator";

// "Esqueci minha senha": só o e-mail (a resposta é sempre a mesma).
export class ForgotPasswordDto {
  @IsEmail({}, { message: "Informe um e-mail válido" })
  email!: string;
}
