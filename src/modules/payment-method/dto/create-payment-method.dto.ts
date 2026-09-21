import { IsNotEmpty, IsString } from "class-validator";

// A empresa não é informada: o método pertence à empresa do usuário autenticado.
export class CreatePaymentMethodDto {
  @IsString()
  @IsNotEmpty()
  name!: string;
}
