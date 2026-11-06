import { Body, Controller, Get, Put } from "@nestjs/common";
import { ApiBearerAuth, ApiOperation, ApiTags } from "@nestjs/swagger";
import { UserType } from "../../../generated/prisma/enums";
import { CurrentUser } from "../../common/decorators/current-user.decorator";
import { Feature } from "../../common/decorators/feature.decorator";
import { Roles } from "../../common/decorators/roles.decorator";
import type { AuthenticatedUser } from "../../common/interfaces/authenticated-user.interface";
import { AutoMessageService } from "./auto-message.service";
import { UpdateAutoMessagesDto } from "./dto/update-auto-messages.dto";

// Mensagens automáticas da própria clínica: só o ADMIN e com Mensagens no plano.
@ApiTags("Mensagens (clínica)")
@ApiBearerAuth()
@Roles(UserType.ADMIN)
@Feature("messages")
@Controller("auto-messages")
export class AutoMessageController {
  constructor(private readonly autoMessageService: AutoMessageService) {}

  @Get()
  @ApiOperation({
    summary: "As seis situações, com os padrões para quem nunca salvou",
    description:
      "Cada item: `kind` (REMINDER, APPOINTMENT_CREATED, APPOINTMENT_RESCHEDULED, APPOINTMENT_CANCELLED, BIRTHDAY, MISS_YOU), `enabled`, `body` (com as variáveis), `reminderOffsets` (minutos antes, só o lembrete) e `missYouDays` (só o sentimos sua falta).",
  })
  findAll(@CurrentUser() currentUser: AuthenticatedUser) {
    return this.autoMessageService.findAll(currentUser.companyId);
  }

  @Put()
  @ApiOperation({
    summary: "Grava as situações enviadas (as outras ficam como estão)",
    description:
      "Variável que não existe na situação: 400 com o nome dela. Lembrete ligado sem nenhum tempo: 400. Devolve as seis.",
  })
  replace(
    @Body() dto: UpdateAutoMessagesDto,
    @CurrentUser() currentUser: AuthenticatedUser,
  ) {
    return this.autoMessageService.replace(currentUser.companyId, dto);
  }
}
