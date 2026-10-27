import { PartialType } from "@nestjs/swagger";
import { IsBoolean, IsOptional } from "class-validator";
import { CreateAnamnesisTemplateDto } from "./create-anamnesis-template.dto";

// Quando `questions` é informado, a lista vira uma nova versão do modelo; sem
// ele, nenhuma versão é criada (renomear e inativar não mexem nas perguntas).
export class UpdateAnamnesisTemplateDto extends PartialType(
  CreateAnamnesisTemplateDto,
) {
  /** Inativar impede novas fichas; as existentes continuam acessíveis. */
  @IsOptional()
  @IsBoolean()
  isActive?: boolean;
}
