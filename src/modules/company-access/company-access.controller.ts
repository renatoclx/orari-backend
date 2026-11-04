import {
  Body,
  Controller,
  Get,
  Ip,
  Param,
  ParseUUIDPipe,
  Put,
} from "@nestjs/common";
import { ApiBearerAuth, ApiOperation, ApiTags } from "@nestjs/swagger";
import { UserType } from "../../../generated/prisma/enums";
import { CurrentUser } from "../../common/decorators/current-user.decorator";
import { Roles } from "../../common/decorators/roles.decorator";
import type { AuthenticatedUser } from "../../common/interfaces/authenticated-user.interface";
import { CompanyAccessService } from "./company-access.service";
import { UpdateCompanyAccessDto } from "./dto/update-company-access.dto";

// Só o SUPER_ADMIN define o que cada empresa enxerga e seus limites.
@ApiTags("Acessos da empresa")
@ApiBearerAuth()
@Roles(UserType.SUPER_ADMIN)
@Controller("companies/:companyId/access")
export class CompanyAccessController {
  constructor(private readonly companyAccessService: CompanyAccessService) {}

  @Get()
  @ApiOperation({
    summary: "Acessos e limites da empresa, com o uso atual",
    description:
      "Uma entrada por funcionalidade (view, edit, create, remove), os " +
      "limites de profissionais e administradores e quanto a empresa já usa.",
  })
  findOne(@Param("companyId", ParseUUIDPipe) companyId: string) {
    return this.companyAccessService.findOne(companyId);
  }

  @Put()
  @ApiOperation({
    summary: "Substitui os acessos e os limites da empresa",
    description:
      "Edita, cria e exclui exigem visualiza; algumas funcionalidades exigem " +
      "ver outras (ex.: agendamentos exige ver clientes, profissionais e " +
      "serviços). Funcionalidade que faltar no corpo fica sem acesso. Baixar " +
      "um limite abaixo do uso é permitido.",
  })
  replace(
    @Param("companyId", ParseUUIDPipe) companyId: string,
    @Body() dto: UpdateCompanyAccessDto,
    @CurrentUser() currentUser: AuthenticatedUser,
    @Ip() ip: string,
  ) {
    return this.companyAccessService.replace(companyId, dto, currentUser, ip);
  }
}
