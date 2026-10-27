import { Module } from "@nestjs/common";
import { AnamnesisAccessService } from "./anamnesis-access.service";

// Por ora só a regra de acesso; modelos e fichas entram nas próximas etapas.
@Module({
  providers: [AnamnesisAccessService],
  exports: [AnamnesisAccessService],
})
export class AnamnesisModule {}
