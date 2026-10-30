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
import {
  ApiBearerAuth,
  ApiCreatedResponse,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
} from "@nestjs/swagger";
import { UserType } from "../../../generated/prisma/enums";
import { CurrentUser } from "../../common/decorators/current-user.decorator";
import { Roles } from "../../common/decorators/roles.decorator";
import type { AuthenticatedUser } from "../../common/interfaces/authenticated-user.interface";
import { SettlePaymentsDto } from "../payment/dto/settle-payments.dto";
import { CreateRecurringAppointmentDto } from "./dto/create-recurring-appointment.dto";
import { FindRecurringAppointmentsQueryDto } from "./dto/find-recurring-appointments-query.dto";
import {
  RecurringAppointmentPageDto,
  RecurringAppointmentResponseDto,
} from "./dto/recurring-appointment-response.dto";
import { LeaveClassGroupDto } from "./dto/leave-class-group.dto";
import {
  ReplaceInClassGroupDto,
  RescheduleAppointmentDto,
} from "./dto/reschedule-appointment.dto";
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
  @ApiOperation({
    summary: "Cria a recorrência e gera os agendamentos do período",
    description:
      "Tudo ou nada: se uma ocorrência conflitar, nada é criado e o erro " +
      "informa a data e o horário (no fuso da empresa) que causaram o " +
      'problema, ex.: "Conflito em 28/10/2026 às 09:00: O profissional já ' +
      'possui um agendamento neste horário" (409; 400 se for fora do ' +
      "horário de funcionamento).",
  })
  @ApiCreatedResponse({ type: RecurringAppointmentResponseDto })
  create(
    @Body() dto: CreateRecurringAppointmentDto,
    @CurrentUser() currentUser: AuthenticatedUser,
  ) {
    return this.recurringAppointmentService.create(dto, currentUser.companyId);
  }

  @Get()
  @ApiOkResponse({ type: RecurringAppointmentPageDto })
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
  @ApiOkResponse({ type: RecurringAppointmentResponseDto })
  findOne(
    @Param("id", ParseUUIDPipe) id: string,
    @CurrentUser() currentUser: AuthenticatedUser,
  ) {
    return this.recurringAppointmentService.findOne(id, currentUser.companyId);
  }

  @Patch(":id")
  @ApiOkResponse({ type: RecurringAppointmentResponseDto })
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

  // Saída da turma (só o ADMIN, como as turmas): cancela as aulas futuras na
  // turma; a recorrência avulsa é encerrada, a de plano continua.
  @Patch(":id/leave-class")
  @Roles(UserType.ADMIN)
  @ApiOkResponse({ type: RecurringAppointmentResponseDto })
  leaveClassGroup(
    @Param("id", ParseUUIDPipe) id: string,
    @Body() dto: LeaveClassGroupDto,
    @CurrentUser() currentUser: AuthenticatedUser,
  ) {
    return this.recurringAppointmentService.leaveClassGroup(
      id,
      dto,
      currentUser.companyId,
    );
  }

  // Remanejamento: remarca um agendamento da recorrência dentro do período dela.
  // Antes de iniciar (SCHEDULED ou CONFIRMED); em sessão de pacote, também após
  // falta (NO_SHOW) ou cancelamento pela turma, e volta a SCHEDULED.
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

  // Reposição numa sessão de turma fixa (só o ADMIN): mesmas aulas do
  // remanejamento, com vaga na turma de destino.
  @Patch(":id/appointments/:appointmentId/replace-in-class")
  @Roles(UserType.ADMIN)
  replaceInClassGroup(
    @Param("id", ParseUUIDPipe) id: string,
    @Param("appointmentId", ParseUUIDPipe) appointmentId: string,
    @Body() dto: ReplaceInClassGroupDto,
    @CurrentUser() currentUser: AuthenticatedUser,
  ) {
    return this.recurringAppointmentService.replaceInClassGroup(
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
