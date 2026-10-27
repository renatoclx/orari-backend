import { Controller, Get, Query } from "@nestjs/common";
import { ApiBearerAuth, ApiTags } from "@nestjs/swagger";
import { UserType } from "../../../generated/prisma/enums";
import { CurrentUser } from "../../common/decorators/current-user.decorator";
import { Roles } from "../../common/decorators/roles.decorator";
import type { AuthenticatedUser } from "../../common/interfaces/authenticated-user.interface";
import { AuditService } from "./audit.service";
import { FindAuditLogsQueryDto } from "./dto/find-audit-logs-query.dto";

// Só leitura e só ADMIN: o SUPER_ADMIN não consulta dados de saúde de outras empresas.
@ApiTags("Auditoria")
@ApiBearerAuth()
@Roles(UserType.ADMIN)
@Controller("audit-logs")
export class AuditController {
  constructor(private readonly auditService: AuditService) {}

  @Get()
  findAll(
    @Query() query: FindAuditLogsQueryDto,
    @CurrentUser() currentUser: AuthenticatedUser,
  ) {
    return this.auditService.findAll(query, currentUser.companyId);
  }
}
