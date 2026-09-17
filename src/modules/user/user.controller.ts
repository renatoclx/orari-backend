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
import { UserType } from "../../../generated/prisma/enums";
import { CurrentUser } from "../../common/decorators/current-user.decorator";
import { Roles } from "../../common/decorators/roles.decorator";
import type { AuthenticatedUser } from "../../common/interfaces/authenticated-user.interface";
import { CreateUserDto } from "./dto/create-user.dto";
import { FindUsersQueryDto } from "./dto/find-users-query.dto";
import { ResetPasswordDto } from "./dto/reset-password.dto";
import { UpdateUserDto } from "./dto/update-user.dto";
import { UserService } from "./user.service";

@Controller("users")
// O alcance de cada tipo (empresa, contas visíveis) é aplicado no UserService.
@Roles(UserType.SUPER_ADMIN, UserType.ADMIN)
export class UserController {
  constructor(private readonly userService: UserService) {}

  @Post()
  create(
    @Body() dto: CreateUserDto,
    @CurrentUser() currentUser: AuthenticatedUser,
  ) {
    return this.userService.create(dto, currentUser);
  }

  @Get()
  findAll(
    @Query() query: FindUsersQueryDto,
    @CurrentUser() currentUser: AuthenticatedUser,
  ) {
    return this.userService.findAll(query, currentUser);
  }

  @Get(":id")
  findOne(
    @Param("id", ParseUUIDPipe) id: string,
    @CurrentUser() currentUser: AuthenticatedUser,
  ) {
    return this.userService.findOne(id, currentUser);
  }

  @Patch(":id")
  update(
    @Param("id", ParseUUIDPipe) id: string,
    @Body() dto: UpdateUserDto,
    @CurrentUser() currentUser: AuthenticatedUser,
  ) {
    return this.userService.update(id, dto, currentUser);
  }

  @Patch(":id/password")
  resetPassword(
    @Param("id", ParseUUIDPipe) id: string,
    @Body() dto: ResetPasswordDto,
    @CurrentUser() currentUser: AuthenticatedUser,
  ) {
    return this.userService.resetPassword(id, dto, currentUser);
  }

  @Delete(":id")
  @HttpCode(204)
  remove(
    @Param("id", ParseUUIDPipe) id: string,
    @CurrentUser() currentUser: AuthenticatedUser,
  ) {
    return this.userService.remove(id, currentUser);
  }
}
