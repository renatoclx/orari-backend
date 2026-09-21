import { PartialType } from "@nestjs/mapped-types";
import { CreateBusinessHourDto } from "./create-business-hour.dto";

export class UpdateBusinessHourDto extends PartialType(CreateBusinessHourDto) {}
