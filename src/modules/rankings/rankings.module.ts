import { Module } from "@nestjs/common";
import { CompanyModule } from "../company/company.module";
import { RankingsController } from "./rankings.controller";
import { RankingsService } from "./rankings.service";

// Relatórios → Rankings.
@Module({
  imports: [CompanyModule],
  controllers: [RankingsController],
  providers: [RankingsService],
})
export class RankingsModule {}
