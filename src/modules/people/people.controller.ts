import {
  BadRequestException,
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
  UploadedFile,
  UseInterceptors,
} from "@nestjs/common";
import { FileInterceptor } from "@nestjs/platform-express";
import { ApiBearerAuth, ApiBody, ApiConsumes, ApiTags } from "@nestjs/swagger";
import { CurrentUser } from "../../common/decorators/current-user.decorator";
import type { AuthenticatedUser } from "../../common/interfaces/authenticated-user.interface";
import { CreatePeopleDto } from "./dto/create-people.dto";
import { FindPeopleQueryDto } from "./dto/find-people-query.dto";
import { UpdatePeopleDto } from "./dto/update-people.dto";
import { PeopleService } from "./people.service";

// Tamanho máximo da foto: acima disso o upload é recusado com 413.
const MAX_PHOTO_BYTES = 2 * 1024 * 1024;

// Acesso de qualquer tipo de usuário, sempre restrito à empresa do usuário autenticado.
@ApiTags("Pessoas")
@ApiBearerAuth()
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
    return this.peopleService.findDetail(id, currentUser.companyId);
  }

  @Patch(":id")
  update(
    @Param("id", ParseUUIDPipe) id: string,
    @Body() dto: UpdatePeopleDto,
    @CurrentUser() currentUser: AuthenticatedUser,
  ) {
    return this.peopleService.update(id, dto, currentUser.companyId);
  }

  // Reativa uma pessoa excluída (limpa o deletedAt).
  @Patch(":id/restore")
  restore(
    @Param("id", ParseUUIDPipe) id: string,
    @CurrentUser() currentUser: AuthenticatedUser,
  ) {
    return this.peopleService.restore(id, currentUser.companyId);
  }

  @Delete(":id")
  @HttpCode(204)
  remove(
    @Param("id", ParseUUIDPipe) id: string,
    @CurrentUser() currentUser: AuthenticatedUser,
  ) {
    return this.peopleService.remove(id, currentUser.companyId);
  }

  // Foto da pessoa (JPEG ou PNG, até 2 MB), enviada como multipart no campo "photo".
  @Post(":id/photo")
  @UseInterceptors(
    FileInterceptor("photo", { limits: { fileSize: MAX_PHOTO_BYTES } }),
  )
  @ApiConsumes("multipart/form-data")
  @ApiBody({
    schema: {
      type: "object",
      required: ["photo"],
      properties: { photo: { type: "string", format: "binary" } },
    },
  })
  uploadPhoto(
    @Param("id", ParseUUIDPipe) id: string,
    @UploadedFile() file: Express.Multer.File | undefined,
    @CurrentUser() currentUser: AuthenticatedUser,
  ) {
    if (!file) {
      throw new BadRequestException("Envie a foto no campo photo");
    }

    return this.peopleService.updatePhoto(
      id,
      file.buffer,
      currentUser.companyId,
    );
  }

  @Delete(":id/photo")
  @HttpCode(204)
  removePhoto(
    @Param("id", ParseUUIDPipe) id: string,
    @CurrentUser() currentUser: AuthenticatedUser,
  ) {
    return this.peopleService.removePhoto(id, currentUser.companyId);
  }
}
