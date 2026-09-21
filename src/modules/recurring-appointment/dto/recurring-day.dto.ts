import { IsEnum, Matches } from "class-validator";
import { WeekDay } from "../../../../generated/prisma/enums";
import { TIME_OF_DAY_PATTERN } from "../../../common/time/time-of-day";

// Um dia reservado pela recorrência. Horários trafegam como "HH:MM".
export class RecurringDayDto {
  @IsEnum(WeekDay)
  weekDay!: WeekDay;

  @Matches(TIME_OF_DAY_PATTERN, {
    message: "startTime deve estar no formato HH:MM",
  })
  startTime!: string;

  @Matches(TIME_OF_DAY_PATTERN, {
    message: "endTime deve estar no formato HH:MM",
  })
  endTime!: string;
}
