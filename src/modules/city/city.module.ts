import { Module } from "@nestjs/common";
import { CityController } from "./city.controller";
import { CityService } from "./city.service";

@Module({
  controllers: [CityController],
  providers: [CityService],
  exports: [CityService],
})
export class CityModule {}
