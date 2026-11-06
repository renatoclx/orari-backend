import { Transform } from "class-transformer";
import { IsString, MaxLength, MinLength } from "class-validator";

const trim = ({ value }: { value: unknown }) =>
  typeof value === "string" ? value.trim() : value;

/** Mensagem escrita pela clínica (título da notificação e o texto). */
export class CreateMessageCampaignDto {
  @Transform(trim)
  @IsString()
  @MinLength(1)
  @MaxLength(100)
  title!: string;

  @Transform(trim)
  @IsString()
  @MinLength(1)
  @MaxLength(500)
  body!: string;
}
