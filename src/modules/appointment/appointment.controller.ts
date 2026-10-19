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
  ApiBadRequestResponse,
  ApiBearerAuth,
  ApiCreatedResponse,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
} from "@nestjs/swagger";
import { CurrentUser } from "../../common/decorators/current-user.decorator";
import type { AuthenticatedUser } from "../../common/interfaces/authenticated-user.interface";
import { AppointmentService } from "./appointment.service";
import {
  AppointmentPageDto,
  AppointmentResponseDto,
} from "./dto/appointment-response.dto";
import { CreateAppointmentDto } from "./dto/create-appointment.dto";
import { FindAppointmentsQueryDto } from "./dto/find-appointments-query.dto";
import { UpdateAppointmentDto } from "./dto/update-appointment.dto";

// Sem DELETE: agendamentos são cancelados pelo status (ver domain.md).
@ApiTags("Agendamentos")
@ApiBearerAuth()
@Controller("appointments")
export class AppointmentController {
  constructor(private readonly appointmentService: AppointmentService) {}

  @Post()
  @ApiCreatedResponse({ type: AppointmentResponseDto })
  create(
    @Body() dto: CreateAppointmentDto,
    @CurrentUser() currentUser: AuthenticatedUser,
  ) {
    return this.appointmentService.create(dto, currentUser.companyId);
  }

  @Get()
  @ApiOperation({
    summary: "Lista agendamentos, em ordem crescente de início",
    description:
      "Cada agendamento traz client, professional e service (só id, nome e, " +
      "conforme o caso, foto, cor e duração), mesmo que a pessoa ou o serviço " +
      "tenham sido excluídos depois. Para a agenda de um dia, use from e to " +
      "(instantes UTC do início do dia e do dia seguinte, no fuso da empresa). " +
      "O limite por página é 100; use page para os demais.",
  })
  @ApiOkResponse({ type: AppointmentPageDto })
  findAll(
    @Query() query: FindAppointmentsQueryDto,
    @CurrentUser() currentUser: AuthenticatedUser,
  ) {
    return this.appointmentService.findAll(query, currentUser.companyId);
  }

  @Get(":id")
  @ApiOkResponse({ type: AppointmentResponseDto })
  findOne(
    @Param("id", ParseUUIDPipe) id: string,
    @CurrentUser() currentUser: AuthenticatedUser,
  ) {
    return this.appointmentService.findDetail(id, currentUser.companyId);
  }

  @Patch(":id")
  @ApiOkResponse({ type: AppointmentResponseDto })
  @ApiBadRequestResponse({
    description:
      "Um agendamento concluído com pagamento (pendente ou pago) não aceita " +
      'nenhuma alteração: "Agendamento concluído com pagamento não pode ser ' +
      'alterado". Cancelar (status CANCELLED) só é permitido para agendamento ' +
      "SCHEDULED ou CONFIRMED que ainda não " +
      'iniciou. Fora disso: "Agendamento que já iniciou não pode ser ' +
      'cancelado", "Agendamento concluído não pode ser cancelado", ' +
      '"Agendamento em que o cliente não compareceu não pode ser cancelado" ' +
      'ou "O agendamento já está cancelado". Ao cancelar, o pagamento ' +
      "PENDING do agendamento também é cancelado.",
  })
  update(
    @Param("id", ParseUUIDPipe) id: string,
    @Body() dto: UpdateAppointmentDto,
    @CurrentUser() currentUser: AuthenticatedUser,
  ) {
    return this.appointmentService.update(id, dto, currentUser.companyId);
  }
}
