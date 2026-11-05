import { Type } from "class-transformer";
import {
  IsNumber,
  IsOptional,
  IsString,
  IsUrl,
  MaxLength,
  ValidateNested,
} from "class-validator";

/** Chaves do aparelho, em base64url, como o navegador as entrega. */
export class PushKeysDto {
  @IsString()
  @MaxLength(200)
  p256dh!: string;

  @IsString()
  @MaxLength(100)
  auth!: string;
}

/**
 * Inscrição do aparelho: o mesmo formato do `PushSubscription.toJSON()` do
 * navegador, para o app enviar sem montar nada.
 */
export class PushSubscriptionDto {
  @IsUrl({ protocols: ["https"], require_protocol: true })
  @MaxLength(1000)
  endpoint!: string;

  // O navegador manda (quase sempre nulo); não é usado.
  @IsOptional()
  @IsNumber()
  expirationTime?: number | null;

  @ValidateNested()
  @Type(() => PushKeysDto)
  keys!: PushKeysDto;
}

/** Desativar os avisos neste aparelho. */
export class PushUnsubscribeDto {
  @IsUrl({ protocols: ["https"], require_protocol: true })
  @MaxLength(1000)
  endpoint!: string;
}
