import { Module } from "@nestjs/common";
import { CompanyAccessModule } from "../company-access/company-access.module";
import { PayableModule } from "../payable/payable.module";
import { StockMovementController } from "./stock-movement.controller";
import { StockMovementService } from "./stock-movement.service";

// Movimentações de estoque dos produtos (entrada por compra com a conta a pagar opcional).
@Module({
  imports: [PayableModule, CompanyAccessModule],
  controllers: [StockMovementController],
  providers: [StockMovementService],
})
export class StockModule {}
