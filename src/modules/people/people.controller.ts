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
  Query,
} from "@nestjs/common";
import { CurrentUser } from "../../common/decorators/current-user.decorator";
import type { AuthenticatedUser } from "../../common/interfaces/authenticated-user.interface";
import { CreatePeopleDto } from "./dto/create-people.dto";
import { FindPeopleQueryDto } from "./dto/find-people-query.dto";
import { UpdatePeopleDto } from "./dto/update-people.dto";
import { PeopleService } from "./people.service";

// Acesso de qualquer tipo de usuário, sempre restrito à empresa do usuário autenticado.
@Controller("people")
export class PeopleController {
  constructor(private readonly peopleService: PeopleService) {}

  @Post()
  create(
    @Body() dto: CreatePeopleDto,
    @CurrentUser() currentUser: AuthenticatedUser,
  ) {
    return this.peopleService.create(dto, currentUser.companyId);
  }

  @Get()
  findAll(
    @Query() query: FindPeopleQueryDto,
    @CurrentUser() currentUser: AuthenticatedUser,
  ) {
    return this.peopleService.findAll(query, currentUser.companyId);
  }

  @Get(":id")
  findOne(
    @Param("id", ParseUUIDPipe) id: string,
    @CurrentUser() currentUser: AuthenticatedUser,
  ) {
    return this.peopleService.findOne(id, currentUser.companyId);
  }

  @Patch(":id")
  update(
    @Param("id", ParseUUIDPipe) id: string,
    @Body() dto: UpdatePeopleDto,
    @CurrentUser() currentUser: AuthenticatedUser,
  ) {
    return this.peopleService.update(id, dto, currentUser.companyId);
  }

  @Delete(":id")
  @HttpCode(204)
  remove(
    @Param("id", ParseUUIDPipe) id: string,
    @CurrentUser() currentUser: AuthenticatedUser,
  ) {
    return this.peopleService.remove(id, currentUser.companyId);
  }
}
