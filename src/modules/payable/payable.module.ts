import { Module } from "@nestjs/common";
import { CompanyModule } from "../company/company.module";
import { PayableController } from "./payable.controller";
import { PayableService } from "./payable.service";

// Financeiro → Contas a pagar (só o ADMIN).
@Module({
  imports: [CompanyModule],
  controllers: [PayableController],
  providers: [PayableService],
  exports: [PayableService],
})
export class PayableModule {}
