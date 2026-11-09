import { Module } from "@nestjs/common";
import { CompanyModule } from "../company/company.module";
import { ReceivablesController } from "./receivables.controller";
import { ReceivablesService } from "./receivables.service";

// Relatórios → Contas a receber.
@Module({
  imports: [CompanyModule],
  controllers: [ReceivablesController],
  providers: [ReceivablesService],
})
export class ReceivablesModule {}
