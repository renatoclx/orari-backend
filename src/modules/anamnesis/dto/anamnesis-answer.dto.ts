import { IsDefined, IsUUID } from "class-validator";

// Resposta a uma pergunta. O formato do valor depende do tipo da pergunta e é
// conferido no service (ver validateAnswerValue).
export class AnamnesisAnswerDto {
  @IsUUID("all")
  questionId!: string;

  /**
   * Texto (respostas de texto, escolha única e data AAAA-MM-DD), número
   * (número e escala), lista de textos (escolha múltipla) ou
   * `{ answer: boolean, detail?: string }` (sim ou não).
   */
  @IsDefined()
  value!: unknown;
}
