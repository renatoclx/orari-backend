import { Controller, Get, Param, ParseUUIDPipe, Query } from "@nestjs/common";
import { PaginationQueryDto } from "../../common/dto/pagination-query.dto";
import { StateService } from "./state.service";

@Controller("states")
export class StateController {
  constructor(private readonly stateService: StateService) {}

  @Get()
  findAll(@Query() query: PaginationQueryDto) {
    return this.stateService.findAll(query);
  }

  @Get(":id")
  findOne(@Param("id", ParseUUIDPipe) id: string) {
    return this.stateService.findOne(id);
  }
}
