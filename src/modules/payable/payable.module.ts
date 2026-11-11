import { Module } from "@nestjs/common";
import { CommissionModule } from "../commission/commission.module";
import { CompanyModule } from "../company/company.module";
import { PayableController } from "./payable.controller";
import { PayableService } from "./payable.service";

// Financeiro → Contas a pagar (só o ADMIN).
@Module({
  // Comissão: o saldo em aberto aparece como linha calculada.
  imports: [CompanyModule, CommissionModule],
  controllers: [PayableController],
  providers: [PayableService],
  exports: [PayableService],
})
export class PayableModule {}
