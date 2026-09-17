import {
  Body,
  Controller,
  Get,
  HttpCode,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
} from "@nestjs/common";
import { CurrentUser } from "../../common/decorators/current-user.decorator";
import type { AuthenticatedUser } from "../../common/interfaces/authenticated-user.interface";
import { CreateRecurringAppointmentDto } from "./dto/create-recurring-appointment.dto";
import { FindRecurringAppointmentsQueryDto } from "./dto/find-recurring-appointments-query.dto";
import { UpdateRecurringAppointmentDto } from "./dto/update-recurring-appointment.dto";
import { RecurringAppointmentService } from "./recurring-appointment.service";

// Sem DELETE: a recorrência é desativada por isActive (ver domain.md).
@Controller("recurring-appointments")
export class RecurringAppointmentController {
  constructor(
    private readonly recurringAppointmentService: RecurringAppointmentService,
  ) {}

  @Post()
  create(
    @Body() dto: CreateRecurringAppointmentDto,
    @CurrentUser() currentUser: AuthenticatedUser,
  ) {
    return this.recurringAppointmentService.create(dto, currentUser.companyId);
  }

  @Get()
  findAll(
    @Query() query: FindRecurringAppointmentsQueryDto,
    @CurrentUser() currentUser: AuthenticatedUser,
  ) {
    return this.recurringAppointmentService.findAll(
      query,
      currentUser.companyId,
    );
  }

  @Get(":id")
  findOne(
    @Param("id", ParseUUIDPipe) id: string,
    @CurrentUser() currentUser: AuthenticatedUser,
  ) {
    return this.recurringAppointmentService.findOne(id, currentUser.companyId);
  }

  // Amplia manualmente o horizonte de geração (ver notificações).
  @Post(":id/extend")
  @HttpCode(200)
  extend(
    @Param("id", ParseUUIDPipe) id: string,
    @CurrentUser() currentUser: AuthenticatedUser,
  ) {
    return this.recurringAppointmentService.extend(id, currentUser.companyId);
  }

  @Patch(":id")
  update(
    @Param("id", ParseUUIDPipe) id: string,
    @Body() dto: UpdateRecurringAppointmentDto,
    @CurrentUser() currentUser: AuthenticatedUser,
  ) {
    return this.recurringAppointmentService.update(
      id,
      dto,
      currentUser.companyId,
    );
  }
}
