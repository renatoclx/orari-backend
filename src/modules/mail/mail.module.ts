import { Global, Module } from "@nestjs/common";
import { MailService } from "./mail.service";

// Global: qualquer módulo que precise enviar e-mail usa o MailService.
@Global()
@Module({
  providers: [MailService],
  exports: [MailService],
})
export class MailModule {}
