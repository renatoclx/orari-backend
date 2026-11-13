import { Controller, Get } from "@nestjs/common";
import { ApiBearerAuth, ApiOperation, ApiTags } from "@nestjs/swagger";
import { UserType } from "../../../generated/prisma/enums";
import { CurrentUser } from "../../common/decorators/current-user.decorator";
import { Roles } from "../../common/decorators/roles.decorator";
import type { AuthenticatedUser } from "../../common/interfaces/authenticated-user.interface";
import { CompanyService } from "../company/company.service";
import { PendingSummaryService } from "./pending-summary.service";

// Pendências de hoje da clínica (o bloco do Dashboard). Só o ADMIN; cada item
// confere a funcionalidade do plano que o alimenta.
@ApiTags("Notificações")
@ApiBearerAuth()
@Roles(UserType.ADMIN)
@Controller("pending-summary")
export class PendingSummaryController {
  constructor(
    private readonly summary: PendingSummaryService,
    private readonly companyService: CompanyService,
  ) {}

  @Get()
  @ApiOperation({
    summary: "Pendências de hoje da clínica",
    description:
      "Contas a pagar de hoje e atrasadas, recebimentos atrasados, comandas do dia e aniversariantes, no calendário da clínica. Só os itens que o plano libera.",
  })
  async find(@CurrentUser() currentUser: AuthenticatedUser) {
    const timeZone = await this.companyService.getTimeZone(
      currentUser.companyId,
    );
    const { date, items } = await this.summary.compute(
      currentUser.companyId,
      new Date(),
      timeZone,
    );
    return { date, items };
  }
}
