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
import {
  ApiBearerAuth,
  ApiBody,
  ApiConsumes,
  ApiOperation,
  ApiTags,
} from "@nestjs/swagger";
import { UserType } from "../../../generated/prisma/enums";
import { CurrentUser } from "../../common/decorators/current-user.decorator";
import { Roles } from "../../common/decorators/roles.decorator";
import type { AuthenticatedUser } from "../../common/interfaces/authenticated-user.interface";
import { CompanyService } from "./company.service";
import { CreateCompanyDto } from "./dto/create-company.dto";
import { FindCompaniesQueryDto } from "./dto/find-companies-query.dto";
import { UpdateCompanyDto } from "./dto/update-company.dto";
import { UpdateOwnCompanyDto } from "./dto/update-own-company.dto";

// Tamanho máximo da logo: acima disso o upload é recusado com 413.
const MAX_LOGO_BYTES = 2 * 1024 * 1024;

// Sem DELETE: empresas são inativadas via PATCH (isActive: false).
@ApiTags("Empresas")
@ApiBearerAuth()
@Controller("companies")
export class CompanyController {
  constructor(private readonly companyService: CompanyService) {}

  @Post()
  @Roles(UserType.SUPER_ADMIN)
  create(@Body() dto: CreateCompanyDto) {
    return this.companyService.create(dto);
  }

  /*
   * As rotas "me" (a empresa do token) vêm antes das rotas ":id": como o id é
   * validado como UUID, "me" cairia nelas e responderia 400.
   */
  @Patch("me")
  @Roles(UserType.ADMIN, UserType.SUPER_ADMIN)
  @ApiOperation({
    summary: "O administrador altera o nome fantasia da própria empresa",
    description:
      "Só o nome fantasia; os demais dados cadastrais são do SUPER_ADMIN " +
      "(PATCH /companies/:id). Texto vazio ou nulo remove o nome fantasia.",
  })
  updateOwn(
    @Body() dto: UpdateOwnCompanyDto,
    @CurrentUser() currentUser: AuthenticatedUser,
  ) {
    return this.companyService.updateOwn(currentUser.companyId, dto);
  }

  // Logo da própria empresa (JPEG ou PNG, até 2 MB), enviada como multipart no campo "logo".
  @Post("me/logo")
  @Roles(UserType.ADMIN, UserType.SUPER_ADMIN)
  @UseInterceptors(
    FileInterceptor("logo", { limits: { fileSize: MAX_LOGO_BYTES } }),
  )
  @ApiConsumes("multipart/form-data")
  @ApiBody({
    schema: {
      type: "object",
      required: ["logo"],
      properties: { logo: { type: "string", format: "binary" } },
    },
  })
  uploadLogo(
    @UploadedFile() file: Express.Multer.File | undefined,
    @CurrentUser() currentUser: AuthenticatedUser,
  ) {
    if (!file) {
      throw new BadRequestException("Envie a logo no campo logo");
    }

    return this.companyService.updateLogo(currentUser.companyId, file.buffer);
  }

  @Delete("me/logo")
  @Roles(UserType.ADMIN, UserType.SUPER_ADMIN)
  @HttpCode(204)
  removeLogo(@CurrentUser() currentUser: AuthenticatedUser) {
    return this.companyService.removeLogo(currentUser.companyId);
  }

  @Get()
  findAll(
    @Query() query: FindCompaniesQueryDto,
    @CurrentUser() currentUser: AuthenticatedUser,
  ) {
    return this.companyService.findAll(query, currentUser);
  }

  @Get(":id")
  findOne(
    @Param("id", ParseUUIDPipe) id: string,
    @CurrentUser() currentUser: AuthenticatedUser,
  ) {
    return this.companyService.findOne(id, currentUser);
  }

  @Patch(":id")
  @Roles(UserType.SUPER_ADMIN)
  update(
    @Param("id", ParseUUIDPipe) id: string,
    @Body() dto: UpdateCompanyDto,
    @CurrentUser() currentUser: AuthenticatedUser,
  ) {
    return this.companyService.update(id, dto, currentUser);
  }
}
