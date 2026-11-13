import { Module } from "@nestjs/common";
import { CompanyAccessModule } from "../company-access/company-access.module";
import { OnboardingController } from "./onboarding.controller";
import { OnboardingService } from "./onboarding.service";

// Primeiros passos da clínica nova e a dispensa das boas-vindas.
@Module({
  imports: [CompanyAccessModule],
  controllers: [OnboardingController],
  providers: [OnboardingService],
})
export class OnboardingModule {}
