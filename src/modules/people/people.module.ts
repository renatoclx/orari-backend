import { Module } from "@nestjs/common";
import { StorageModule } from "../../common/storage/storage.module";
import { CityModule } from "../city/city.module";
import { PeopleController } from "./people.controller";
import { PeopleService } from "./people.service";

@Module({
  imports: [CityModule, StorageModule],
  controllers: [PeopleController],
  providers: [PeopleService],
  exports: [PeopleService],
})
export class PeopleModule {}
