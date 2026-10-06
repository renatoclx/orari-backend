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
import { SettlePaymentsDto } from "../payment/dto/settle-payments.dto";
import { CreateRecurringAppointmentDto } from "./dto/create-recurring-appointment.dto";
import { FindRecurringAppointmentsQueryDto } from "./dto/find-recurring-appointments-query.dto";
import { RescheduleAppointmentDto } from "./dto/reschedule-appointment.dto";
import { UpdateRecurringAppointmentDto } from "./dto/update-recurring-appointment.dto";
import { RecurringAppointmentService } from "./recurring-appointment.service";

// Sem DELETE: a recorrência é desativada por isActive (ver domain.md).
@ApiTags("Agendamentos recorrentes")
@ApiBearerAuth()
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

  // Pagamento integral: baixa todos os pagamentos pendentes de uma vez.
  @Post(":id/payments/settle")
  settlePayments(
    @Param("id", ParseUUIDPipe) id: string,
    @Body() dto: SettlePaymentsDto,
    @CurrentUser() currentUser: AuthenticatedUser,
  ) {
    return this.recurringAppointmentService.settlePayments(
      id,
      dto,
      currentUser.companyId,
    );
  }

  // Remanejamento: remarca um agendamento da recorrência dentro do período dela.
  @Patch(":id/appointments/:appointmentId/reschedule")
  rescheduleAppointment(
    @Param("id", ParseUUIDPipe) id: string,
    @Param("appointmentId", ParseUUIDPipe) appointmentId: string,
    @Body() dto: RescheduleAppointmentDto,
    @CurrentUser() currentUser: AuthenticatedUser,
  ) {
    return this.recurringAppointmentService.rescheduleAppointment(
      id,
      appointmentId,
      dto,
      currentUser.companyId,
    );
  }

  // Cancela um único agendamento da recorrência e o pagamento pendente dele.
  @Patch(":id/appointments/:appointmentId/cancel")
  cancelAppointment(
    @Param("id", ParseUUIDPipe) id: string,
    @Param("appointmentId", ParseUUIDPipe) appointmentId: string,
    @CurrentUser() currentUser: AuthenticatedUser,
  ) {
    return this.recurringAppointmentService.cancelAppointment(
      id,
      appointmentId,
      currentUser.companyId,
    );
  }
}
