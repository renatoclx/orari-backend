import { Module } from "@nestjs/common";
import { CityModule } from "../city/city.module";
import { PeopleModule } from "../people/people.module";
import { AddressController } from "./address.controller";
import { AddressService } from "./address.service";

@Module({
  imports: [CityModule, PeopleModule],
  controllers: [AddressController],
  providers: [AddressService],
})
export class AddressModule {}
