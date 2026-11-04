import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Put,
  Query,
} from "@nestjs/common";
import {
  ApiBearerAuth,
  ApiConflictResponse,
  ApiNoContentResponse,
  ApiNotFoundResponse,
  ApiOperation,
  ApiTags,
} from "@nestjs/swagger";
import { CurrentUser } from "../../common/decorators/current-user.decorator";
import { Feature } from "../../common/decorators/feature.decorator";
import type { AuthenticatedUser } from "../../common/interfaces/authenticated-user.interface";
import { CreateServiceDto } from "./dto/create-service.dto";
import { FindServicesQueryDto } from "./dto/find-services-query.dto";
import { SetServiceProfessionalsDto } from "./dto/set-service-professionals.dto";
import { UpdateServiceDto } from "./dto/update-service.dto";
import { ServiceService } from "./service.service";

// Acesso de qualquer tipo de usuário, sempre restrito à empresa do usuário autenticado.
@ApiTags("Serviços")
@ApiBearerAuth()
@Feature("services")
@Controller("services")
export class ServiceController {
  constructor(private readonly serviceService: ServiceService) {}

  @Post()
  create(
    @Body() dto: CreateServiceDto,
    @CurrentUser() currentUser: AuthenticatedUser,
  ) {
    return this.serviceService.create(dto, currentUser.companyId);
  }

  @Get()
  findAll(
    @Query() query: FindServicesQueryDto,
    @CurrentUser() currentUser: AuthenticatedUser,
  ) {
    return this.serviceService.findAll(query, currentUser.companyId);
  }

  @Get(":id")
  findOne(
    @Param("id", ParseUUIDPipe) id: string,
    @CurrentUser() currentUser: AuthenticatedUser,
  ) {
    return this.serviceService.findOne(id, currentUser.companyId);
  }

  @Patch(":id")
  update(
    @Param("id", ParseUUIDPipe) id: string,
    @Body() dto: UpdateServiceDto,
    @CurrentUser() currentUser: AuthenticatedUser,
  ) {
    return this.serviceService.update(id, dto, currentUser.companyId);
  }

  @Get(":id/professionals")
  @ApiOperation({
    summary: "Profissionais que atendem o serviço",
    description:
      "O portal do cliente só mostra o serviço com ao menos um profissional ativo.",
  })
  findProfessionals(
    @Param("id", ParseUUIDPipe) id: string,
    @CurrentUser() currentUser: AuthenticatedUser,
  ) {
    return this.serviceService.findProfessionals(id, currentUser.companyId);
  }

  @Put(":id/professionals")
  @ApiOperation({
    summary: "Substitui os profissionais que atendem o serviço",
    description:
      "Só profissionais ativos da empresa (400). Lista vazia tira o serviço do portal.",
  })
  setProfessionals(
    @Param("id", ParseUUIDPipe) id: string,
    @Body() dto: SetServiceProfessionalsDto,
    @CurrentUser() currentUser: AuthenticatedUser,
  ) {
    return this.serviceService.setProfessionals(
      id,
      dto.professionalIds,
      currentUser.companyId,
    );
  }

  @Delete(":id")
  @HttpCode(204)
  @ApiOperation({
    summary: "Exclui o serviço, somente se não tiver relacionamentos",
    description:
      "Exclusão lógica. Recusada quando há agendamentos, agendamentos recorrentes, " +
      "itens de plano ou turmas com este serviço (inclusive cancelados ou encerrados): " +
      "nesse caso, inative-o com PATCH e isActive false.",
  })
  @ApiNoContentResponse({ description: "Serviço excluído." })
  @ApiNotFoundResponse({
    description: "Serviço inexistente ou de outra empresa.",
  })
  @ApiConflictResponse({
    description:
      "O serviço possui agendamentos, recorrências, planos ou turmas vinculados. Inative-o em vez de excluir.",
  })
  remove(
    @Param("id", ParseUUIDPipe) id: string,
    @CurrentUser() currentUser: AuthenticatedUser,
  ) {
    return this.serviceService.remove(id, currentUser.companyId);
  }
}
