import { IsNotEmpty, IsString } from "class-validator";

// A empresa não é informada: a categoria pertence à empresa do usuário autenticado.
export class CreateExpenseCategoryDto {
  @IsString()
  @IsNotEmpty()
  name!: string;
}
