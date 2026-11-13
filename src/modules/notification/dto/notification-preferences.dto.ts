import { Type } from "class-transformer";
import {
  ArrayMaxSize,
  IsArray,
  IsBoolean,
  IsIn,
  ValidateNested,
} from "class-validator";
import { NOTIFICATION_CATEGORIES } from "../notification.catalog";

export class NotificationPreferenceDto {
  @IsIn(NOTIFICATION_CATEGORIES, { message: "Categoria inválida" })
  category!: (typeof NOTIFICATION_CATEGORIES)[number];

  /** Se esta categoria também vira push neste usuário. */
  @IsBoolean()
  push!: boolean;
}

// As categorias enviadas; as que faltarem ficam como estão.
export class UpdateNotificationPreferencesDto {
  @IsArray()
  @ArrayMaxSize(50)
  @ValidateNested({ each: true })
  @Type(() => NotificationPreferenceDto)
  preferences!: NotificationPreferenceDto[];
}
