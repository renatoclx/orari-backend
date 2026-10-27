import { Module } from "@nestjs/common";
import { AppointmentModule } from "../appointment/appointment.module";
import { StorageModule } from "../../common/storage/storage.module";
import { CompanyModule } from "../company/company.module";
import { PeopleModule } from "../people/people.module";
import { AnamnesisAccessService } from "./anamnesis-access.service";
import { AnamnesisCryptoService } from "./anamnesis-crypto.service";
import { AnamnesisTemplateController } from "./anamnesis-template.controller";
import { AnamnesisTemplateService } from "./anamnesis-template.service";
import { AnamnesisController } from "./anamnesis.controller";
import { AnamnesisPdfService } from "./anamnesis-pdf.service";
import { AnamnesisService } from "./anamnesis.service";

@Module({
  imports: [AppointmentModule, CompanyModule, PeopleModule, StorageModule],
  controllers: [AnamnesisTemplateController, AnamnesisController],
  providers: [
    AnamnesisAccessService,
    AnamnesisCryptoService,
    AnamnesisPdfService,
    AnamnesisService,
    AnamnesisTemplateService,
  ],
  exports: [AnamnesisAccessService],
})
export class AnamnesisModule {}
