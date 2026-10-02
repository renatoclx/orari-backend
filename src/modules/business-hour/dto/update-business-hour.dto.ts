import { PartialType } from "@nestjs/swagger";
import { CreateBusinessHourDto } from "./create-business-hour.dto";

export class UpdateBusinessHourDto extends PartialType(CreateBusinessHourDto) {}
