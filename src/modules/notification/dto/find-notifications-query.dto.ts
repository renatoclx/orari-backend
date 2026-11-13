import { Transform } from "class-transformer";
import { IsBoolean, IsOptional } from "class-validator";
import { PaginationQueryDto } from "../../../common/dto/pagination-query.dto";

// A caixa do usuário: 10 por página (cabe no sino e na tela do celular).
export class FindNotificationsQueryDto extends PaginationQueryDto {
  override limit: number = 10;

  /** Só as não lidas. */
  @IsOptional()
  @Transform(({ value }) => value === true || value === "true")
  @IsBoolean()
  onlyUnread?: boolean;
}
