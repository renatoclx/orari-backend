import { Controller, Get, Query } from "@nestjs/common";
import { ApiBearerAuth, ApiOperation, ApiTags } from "@nestjs/swagger";
import { UserType } from "../../../generated/prisma/enums";
import { CurrentUser } from "../../common/decorators/current-user.decorator";
import { Feature } from "../../common/decorators/feature.decorator";
import { Roles } from "../../common/decorators/roles.decorator";
import type { AuthenticatedUser } from "../../common/interfaces/authenticated-user.interface";
import { AppointmentReportService } from "./appointment-report.service";
import { AppointmentReportQueryDto } from "./dto/appointment-report-query.dto";

// Relatório "Agendamentos": só leitura, restrito à empresa do usuário.
// Só o ADMIN, como os demais relatórios.
@ApiTags("Relatório de agendamentos")
@ApiBearerAuth()
@Roles(UserType.ADMIN)
@Feature("appointments-report")
@Controller("appointment-report")
export class AppointmentReportController {
  constructor(
    private readonly appointmentReportService: AppointmentReportService,
  ) {}

  @Get()
  @ApiOperation({
    summary: "Agendamentos do período (empresa ou um profissional)",
    description:
      "Período em dias da empresa (`from`, `to`, AAAA-MM-DD, pontas incluídas; padrão: mês atual) e `professionalId` opcional (404 se não for profissional da empresa). Pelo início do agendamento. `total`: não cancelados (`open` = agendado, confirmado ou em andamento; `fromPortal` = marcados pelo app); `completed`, `noShow`, `cancelled`; `noShowRate` = faltas ÷ (concluídos + faltas) e `cancelRate` = cancelados ÷ todos, de 0 a 1 (null sem base). `series`: por dia (até 62 dias) ou semana. `peak`: não cancelados por dia da semana (0 = domingo) e hora de início. `byProfessional` e `byService` (com `minutes`, a duração somada dos não cancelados), do maior total para o menor.",
  })
  report(
    @CurrentUser() currentUser: AuthenticatedUser,
    @Query() query: AppointmentReportQueryDto,
  ) {
    return this.appointmentReportService.report(query, currentUser.companyId);
  }
}
