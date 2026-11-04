import { ArrayMaxSize, ArrayUnique, IsArray, IsUUID } from "class-validator";

export class SetServiceProfessionalsDto {
  /** Profissionais (pessoas PROFESSIONAL ativas) que atendem o serviço. Lista vazia: nenhum. */
  @IsArray()
  @ArrayUnique()
  @ArrayMaxSize(100)
  @IsUUID("all", { each: true })
  professionalIds!: string[];
}
