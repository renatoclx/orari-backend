import { IsEnum, Matches } from "class-validator";
import { WeekDay } from "../../../../generated/prisma/enums";
import { TIME_OF_DAY_PATTERN } from "../../../common/time/time-of-day";

// A empresa vem do usuário autenticado. Horários trafegam como "HH:MM".
export class CreateBusinessHourDto {
  @IsEnum(WeekDay)
  weekDay!: WeekDay;

  @Matches(TIME_OF_DAY_PATTERN, {
    message: "openAt deve estar no formato HH:MM",
  })
  openAt!: string;

  @Matches(TIME_OF_DAY_PATTERN, {
    message: "closeAt deve estar no formato HH:MM",
  })
  closeAt!: string;
}
