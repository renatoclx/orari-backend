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
import { FindOwnedQueryDto } from "../../common/dto/find-owned-query.dto";
import type { AuthenticatedUser } from "../../common/interfaces/authenticated-user.interface";
import { ContactService } from "./contact.service";
import { CreateContactDto } from "./dto/create-contact.dto";
import { UpdateContactDto } from "./dto/update-contact.dto";

// Acesso de qualquer tipo de usuário, sempre restrito à empresa do usuário autenticado.
@Controller("contacts")
export class ContactController {
  constructor(private readonly contactService: ContactService) {}

  @Post()
  create(
    @Body() dto: CreateContactDto,
    @CurrentUser() currentUser: AuthenticatedUser,
  ) {
    return this.contactService.create(dto, currentUser.companyId);
  }

  @Get()
  findAll(
    @Query() query: FindOwnedQueryDto,
    @CurrentUser() currentUser: AuthenticatedUser,
  ) {
    return this.contactService.findAll(query, currentUser.companyId);
  }

  @Get(":id")
  findOne(
    @Param("id", ParseUUIDPipe) id: string,
    @CurrentUser() currentUser: AuthenticatedUser,
  ) {
    return this.contactService.findOne(id, currentUser.companyId);
  }

  @Patch(":id")
  update(
    @Param("id", ParseUUIDPipe) id: string,
    @Body() dto: UpdateContactDto,
    @CurrentUser() currentUser: AuthenticatedUser,
  ) {
    return this.contactService.update(id, dto, currentUser.companyId);
  }

  @Delete(":id")
  @HttpCode(204)
  remove(
    @Param("id", ParseUUIDPipe) id: string,
    @CurrentUser() currentUser: AuthenticatedUser,
  ) {
    return this.contactService.remove(id, currentUser.companyId);
  }
}
