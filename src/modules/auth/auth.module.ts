import { Module } from "@nestjs/common";
import { ConfigModule, ConfigService } from "@nestjs/config";
import { JwtModule } from "@nestjs/jwt";
import { PassportModule } from "@nestjs/passport";
import { ThrottlerModule } from "@nestjs/throttler";
import { APP_GUARD } from "@nestjs/core";
import type { StringValue } from "ms";
import { CompanyModule } from "../company/company.module";
import { UserModule } from "../user/user.module";
import { AuthService } from "./auth.service";
import { AuthController } from "./auth.controller";
import { JwtStrategy } from "./strategies/jwt.strategy";
import { JwtAuthGuard } from "./guards/jwt-auth.guard";
import { RolesGuard } from "./guards/roles.guard";
import { AUTH_THROTTLER, LOGIN_LIMIT } from "./auth-throttle";

@Module({
  imports: [
    UserModule,
    CompanyModule,
    PassportModule,
    // Limite de tentativas das rotas públicas de credencial (ver AuthController).
    // Fica em memória, por instância da API: com mais de uma instância, o limite
    // vale para cada uma, e a contagem compartilhada exigiria um armazenamento
    // comum (ex.: Redis).
    ThrottlerModule.forRoot([{ name: AUTH_THROTTLER, ...LOGIN_LIMIT }]),
    JwtModule.registerAsync({
      imports: [ConfigModule],
      inject: [ConfigService],
      useFactory: (configService: ConfigService) => ({
        secret: configService.get<string>("JWT_SECRET"),
        signOptions: {
          expiresIn: configService.get<string>("JWT_EXPIRES_IN") as StringValue,
        },
      }),
    }),
  ],
  controllers: [AuthController],
  providers: [
    AuthService,
    JwtStrategy,
    // A ordem importa: o RolesGuard depende do request.user preenchido pelo JwtAuthGuard.
    {
      provide: APP_GUARD,
      useClass: JwtAuthGuard,
    },
    {
      provide: APP_GUARD,
      useClass: RolesGuard,
    },
  ],
})
export class AuthModule {}
