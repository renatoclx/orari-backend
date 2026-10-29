import { IsEnum, Matches } from "class-validator";
import { WeekDay } from "../../../../generated/prisma/enums";
import { TIME_OF_DAY_PATTERN } from "../../../common/time/time-of-day";

// Um dia e horário da turma. Só o início: o fim é o início mais a duração do serviço.
export class ClassGroupDayDto {
  @IsEnum(WeekDay)
  weekDay!: WeekDay;

  @Matches(TIME_OF_DAY_PATTERN, {
    message: "startTime deve estar no formato HH:MM",
  })
  startTime!: string;
}
