import { IsEnum, IsOptional } from "class-validator";
import { WeekDay } from "../../../../generated/prisma/enums";
import { PaginationQueryDto } from "../../../common/dto/pagination-query.dto";

export class FindBusinessHoursQueryDto extends PaginationQueryDto {
  @IsOptional()
  @IsEnum(WeekDay)
  weekDay?: WeekDay;
}
