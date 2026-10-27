import { Module } from "@nestjs/common";
import { AnamnesisAccessService } from "./anamnesis-access.service";
import { AnamnesisTemplateController } from "./anamnesis-template.controller";
import { AnamnesisTemplateService } from "./anamnesis-template.service";

@Module({
  controllers: [AnamnesisTemplateController],
  providers: [AnamnesisAccessService, AnamnesisTemplateService],
  exports: [AnamnesisAccessService],
})
export class AnamnesisModule {}
