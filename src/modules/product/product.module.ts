import { Module } from "@nestjs/common";
import { StorageModule } from "../../common/storage/storage.module";
import { PeopleModule } from "../people/people.module";
import { ProductCategoryModule } from "../product-category/product-category.module";
import { ProductController } from "./product.controller";
import { ProductService } from "./product.service";

@Module({
  imports: [ProductCategoryModule, PeopleModule, StorageModule],
  controllers: [ProductController],
  providers: [ProductService],
})
export class ProductModule {}
