import "dotenv/config";
import { NestFactory } from "@nestjs/core";
import type { NestExpressApplication } from "@nestjs/platform-express";
import { ValidationPipe } from "@nestjs/common";
import { DocumentBuilder, SwaggerModule } from "@nestjs/swagger";
import { AppModule } from "./app.module";
import {
  UPLOADS_PUBLIC_PREFIX,
  uploadsRoot,
} from "./common/storage/local-file-storage.service";

async function bootstrap() {
  const app = await NestFactory.create<NestExpressApplication>(AppModule);

  // Arquivos enviados (ex.: fotos de pessoas) servidos a partir da pasta local.
  // São públicos para quem tem o link; ver docs/technical-debt.md antes de produção.
  app.useStaticAssets(uploadsRoot(), { prefix: UPLOADS_PUBLIC_PREFIX });

  // Documentação gerada a partir dos DTOs e controllers (ver @ApiTags/@ApiBearerAuth).
  // Exposta em /docs; reavaliar acesso público ao publicar em produção.
  const swaggerConfig = new DocumentBuilder()
    .setTitle("Orari API")
    .setDescription(
      "API multiempresa de agendamentos: pessoas, serviços, horário de funcionamento, agenda e pagamentos.",
    )
    .setVersion(process.env.npm_package_version ?? "0.0.1")
    .addBearerAuth()
    .build();
  const swaggerDocument = SwaggerModule.createDocument(app, swaggerConfig);
  SwaggerModule.setup("docs", app, swaggerDocument);

  // CORS_ORIGIN aceita uma lista separada por vírgulas (ex.: "http://a.com,http://b.com").
  // Sem a variável definida, libera qualquer origem — ajuste para produção.
  const corsOrigin = process.env.CORS_ORIGIN;
  app.enableCors({
    origin: corsOrigin
      ? corsOrigin.split(",").map((origin) => origin.trim())
      : true,
  });
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      transform: true,
      forbidNonWhitelisted: true,
    }),
  );
  await app.listen(process.env.PORT ?? 3333);
}
void bootstrap();
