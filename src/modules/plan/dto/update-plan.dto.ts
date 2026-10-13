import { PartialType } from "@nestjs/swagger";
import { CreatePlanDto } from "./create-plan.dto";

// Quando `serviceIds` ou `periods` são informados, a lista substitui a anterior.
export class UpdatePlanDto extends PartialType(CreatePlanDto) {}
