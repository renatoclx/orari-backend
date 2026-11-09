import { Module } from "@nestjs/common";
import { CompanyModule } from "../company/company.module";
import { AgendaBlockController } from "./agenda-block.controller";
import { AgendaBlockService } from "./agenda-block.service";

// Bloqueio de horários da agenda. A regra (bloqueado = fora do funcionamento)
// fica no BusinessHourService, que lê a tabela direto.
@Module({
  imports: [CompanyModule],
  controllers: [AgendaBlockController],
  providers: [AgendaBlockService],
})
export class AgendaBlockModule {}
