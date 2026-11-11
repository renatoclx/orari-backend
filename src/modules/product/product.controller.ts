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
import { UserType } from "../../../generated/prisma/enums";
import { CurrentUser } from "../../common/decorators/current-user.decorator";
import {
  Feature,
  FeatureAction,
} from "../../common/decorators/feature.decorator";
import { Roles } from "../../common/decorators/roles.decorator";
import type { AuthenticatedUser } from "../../common/interfaces/authenticated-user.interface";
import { CreateProductDto } from "./dto/create-product.dto";
import { FindProductsQueryDto } from "./dto/find-products-query.dto";
import { UpdateProductDto } from "./dto/update-product.dto";
import { ProductService } from "./product.service";

const MAX_PHOTO_BYTES = 2 * 1024 * 1024;

// Só o ADMIN, restrito à empresa do usuário.
@ApiTags("Produtos")
@ApiBearerAuth()
@Roles(UserType.ADMIN)
@Feature("products")
@Controller("products")
export class ProductController {
  constructor(private readonly productService: ProductService) {}

  @Post()
  create(
    @Body() dto: CreateProductDto,
    @CurrentUser() currentUser: AuthenticatedUser,
  ) {
    return this.productService.create(
      dto,
      currentUser.companyId,
      currentUser.id,
    );
  }

  @Get()
  findAll(
    @Query() query: FindProductsQueryDto,
    @CurrentUser() currentUser: AuthenticatedUser,
  ) {
    return this.productService.findAll(query, currentUser.companyId);
  }

  @Get(":id")
  findOne(
    @Param("id", ParseUUIDPipe) id: string,
    @CurrentUser() currentUser: AuthenticatedUser,
  ) {
    return this.productService.findOne(id, currentUser.companyId);
  }

  // Altera os dados, inativa ou reativa; a margem é recalculada.
  @Patch(":id")
  update(
    @Param("id", ParseUUIDPipe) id: string,
    @Body() dto: UpdateProductDto,
    @CurrentUser() currentUser: AuthenticatedUser,
  ) {
    return this.productService.update(id, dto, currentUser.companyId);
  }

  @Delete(":id")
  @HttpCode(204)
  remove(
    @Param("id", ParseUUIDPipe) id: string,
    @CurrentUser() currentUser: AuthenticatedUser,
  ) {
    return this.productService.remove(id, currentUser.companyId);
  }

  // Foto do produto (JPEG ou PNG, até 2 MB), enviada como multipart no campo "photo".
  @FeatureAction("edit")
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

    return this.productService.updatePhoto(
      id,
      file.buffer,
      currentUser.companyId,
    );
  }

  @FeatureAction("edit")
  @Delete(":id/photo")
  @HttpCode(204)
  removePhoto(
    @Param("id", ParseUUIDPipe) id: string,
    @CurrentUser() currentUser: AuthenticatedUser,
  ) {
    return this.productService.removePhoto(id, currentUser.companyId);
  }
}
