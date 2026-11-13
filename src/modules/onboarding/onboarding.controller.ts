import { Controller, Get, HttpCode, Patch } from "@nestjs/common";
import { ApiBearerAuth, ApiOperation, ApiTags } from "@nestjs/swagger";
import { UserType } from "../../../generated/prisma/enums";
import { CurrentUser } from "../../common/decorators/current-user.decorator";
import { ProfessionalApp } from "../../common/decorators/professional-app.decorator";
import { Roles } from "../../common/decorators/roles.decorator";
import type { AuthenticatedUser } from "../../common/interfaces/authenticated-user.interface";
import { OnboardingService } from "./onboarding.service";

// Primeiros passos e boas-vindas. A lista é do ADMIN; o cartão do app, do
// PROFESSIONAL; os dois dispensam o que é deles. Cada um só mexe na própria marca.
@ApiTags("Primeiros passos")
@ApiBearerAuth()
@Controller("onboarding")
export class OnboardingController {
  constructor(private readonly onboarding: OnboardingService) {}

  @Get()
  @Roles(UserType.ADMIN)
  @ApiOperation({
    summary: "Primeiros passos da clínica (a lista do Dashboard)",
    description:
      "Cada passo sai dos dados da clínica e só entra se o plano libera a funcionalidade. O progresso conta só os obrigatórios; `dismissed` diz se o usuário dispensou a lista.",
  })
  find(@CurrentUser() currentUser: AuthenticatedUser) {
    return this.onboarding.find(currentUser);
  }

  @Get("welcome")
  @ProfessionalApp()
  @Roles(UserType.PROFESSIONAL)
  @ApiOperation({
    summary: "O cartão de boas-vindas do app já foi dispensado?",
  })
  async welcome(@CurrentUser() currentUser: AuthenticatedUser) {
    return { dismissed: await this.onboarding.dismissed(currentUser.id) };
  }

  @Patch("dismiss")
  @HttpCode(204)
  @ProfessionalApp()
  @Roles(UserType.ADMIN, UserType.PROFESSIONAL)
  @ApiOperation({
    summary:
      "Dispensa a lista de primeiros passos (ADMIN) ou o cartão (PROFESSIONAL)",
  })
  dismiss(@CurrentUser() currentUser: AuthenticatedUser) {
    return this.onboarding.dismiss(currentUser);
  }
}
