import { Module } from "@nestjs/common";
import { CompanyModule } from "../company/company.module";
import { ClientPortfolioController } from "./client-portfolio.controller";
import { ClientPortfolioService } from "./client-portfolio.service";

// Relatórios → Carteira de clientes (por profissional).
@Module({
  imports: [CompanyModule],
  controllers: [ClientPortfolioController],
  providers: [ClientPortfolioService],
})
export class ClientPortfolioModule {}
