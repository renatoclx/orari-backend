import { Controller, Get, Param, ParseUUIDPipe, Query } from "@nestjs/common";
import { CityService } from "./city.service";
import { FindCitiesQueryDto } from "./dto/find-cities-query.dto";

@Controller("cities")
export class CityController {
  constructor(private readonly cityService: CityService) {}

  @Get()
  findAll(@Query() query: FindCitiesQueryDto) {
    return this.cityService.findAll(query);
  }

  @Get(":id")
  findOne(@Param("id", ParseUUIDPipe) id: string) {
    return this.cityService.findOne(id);
  }
}
