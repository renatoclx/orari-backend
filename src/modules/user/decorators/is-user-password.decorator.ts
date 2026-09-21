import { applyDecorators } from "@nestjs/common";
import { IsString, MaxLength, MinLength } from "class-validator";

// Regras de senha compartilhadas entre cadastro e redefinição.
// O limite de 72 existe porque o bcrypt considera apenas os primeiros 72 bytes.
export const IsUserPassword = () =>
  applyDecorators(IsString(), MinLength(8), MaxLength(72));
