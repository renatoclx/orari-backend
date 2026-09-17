import { Module } from "@nestjs/common";
import { ConfigModule } from "@nestjs/config";
import { AppController } from "./app.controller";
import { AppService } from "./app.service";
import { AddressModule } from "./modules/address/address.module";
import { AppointmentModule } from "./modules/appointment/appointment.module";
import { AuthModule } from "./modules/auth/auth.module";
import { BusinessHourModule } from "./modules/business-hour/business-hour.module";
import { CityModule } from "./modules/city/city.module";
import { CompanyModule } from "./modules/company/company.module";
import { ContactModule } from "./modules/contact/contact.module";
import { PeopleModule } from "./modules/people/people.module";
import { RecurringAppointmentModule } from "./modules/recurring-appointment/recurring-appointment.module";
import { ServiceModule } from "./modules/service/service.module";
import { StateModule } from "./modules/state/state.module";
import { PrismaModule } from "./prisma/prisma.module";

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
    }),
    PrismaModule,
    AuthModule,
    StateModule,
    CityModule,
    CompanyModule,
    PeopleModule,
    ContactModule,
    AddressModule,
    ServiceModule,
    BusinessHourModule,
    AppointmentModule,
    RecurringAppointmentModule,
  ],
  controllers: [AppController],
  providers: [AppService],
})
export class AppModule {}
