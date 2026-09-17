import { Module } from "@nestjs/common";
import { PeopleModule } from "../people/people.module";
import { ContactController } from "./contact.controller";
import { ContactService } from "./contact.service";

@Module({
  imports: [PeopleModule],
  controllers: [ContactController],
  providers: [ContactService],
})
export class ContactModule {}
