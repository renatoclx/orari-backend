import { Module } from "@nestjs/common";
import { CompanyModule } from "../company/company.module";
import { ProductSaleController } from "./product-sale.controller";
import { ProductSaleService } from "./product-sale.service";

// Venda de produtos na comanda (o pagamento é recebido pela baixa da comanda).
@Module({
  imports: [CompanyModule],
  controllers: [ProductSaleController],
  providers: [ProductSaleService],
})
export class ProductSaleModule {}
