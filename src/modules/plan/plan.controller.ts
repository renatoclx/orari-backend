import {
  Body,
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
} from "@nestjs/common";
import { ApiBearerAuth, ApiTags } from "@nestjs/swagger";
import { CurrentUser } from "../../common/decorators/current-user.decorator";
import type { AuthenticatedUser } from "../../common/interfaces/authenticated-user.interface";
import { CreatePlanDto } from "./dto/create-plan.dto";
import { FindPlansQueryDto } from "./dto/find-plans-query.dto";
import { UpdatePlanDto } from "./dto/update-plan.dto";
import { PlanService } from "./plan.service";

// Sem DELETE: o plano é desativado por isActive (ver business-rules.md).
@ApiTags("Planos")
@ApiBearerAuth()
@Controller("plans")
export class PlanController {
  constructor(private readonly planService: PlanService) {}

  @Post()
  create(
    @Body() dto: CreatePlanDto,
    @CurrentUser() currentUser: AuthenticatedUser,
  ) {
    return this.planService.create(dto, currentUser.companyId);
  }

  @Get()
  findAll(
    @Query() query: FindPlansQueryDto,
    @CurrentUser() currentUser: AuthenticatedUser,
  ) {
    return this.planService.findAll(query, currentUser.companyId);
  }

  @Get(":id")
  findOne(
    @Param("id", ParseUUIDPipe) id: string,
    @CurrentUser() currentUser: AuthenticatedUser,
  ) {
    return this.planService.findOne(id, currentUser.companyId);
  }

  @Patch(":id")
  update(
    @Param("id", ParseUUIDPipe) id: string,
    @Body() dto: UpdatePlanDto,
    @CurrentUser() currentUser: AuthenticatedUser,
  ) {
    return this.planService.update(id, dto, currentUser.companyId);
  }
}
