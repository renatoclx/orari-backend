import { ValidationPipe } from "@nestjs/common";
import type { NestExpressApplication } from "@nestjs/platform-express";
import { DocumentBuilder, SwaggerModule } from "@nestjs/swagger";
import helmet from "helmet";
import {
  UPLOADS_PUBLIC_PREFIX,
  uploadsRoot,
} from "./common/storage/local-file-storage.service";

type Env = Record<string, string | undefined>;

// O Swagger fica ligado em desenvolvimento e desligado em produção, a menos que
// SWAGGER_ENABLED diga o contrário.
export function isSwaggerEnabled(env: Env): boolean {
  return env.SWAGGER_ENABLED !== undefined
    ? env.SWAGGER_ENABLED === "true"
    : env.NODE_ENV !== "production";
}

/**
 * Configuração da aplicação HTTP (segurança, CORS, validação e documentação),
 * separada do main.ts para poder ser testada.
 */
export function configureApp(app: NestExpressApplication, env: Env): void {
  const swaggerEnabled = isSwaggerEnabled(env);

  // Atrás de proxy, o IP do cliente (usado no limite de tentativas) vem do
  // cabeçalho X-Forwarded-For. TRUST_PROXY é o número de proxies à frente da API;
  // sem ele, nenhum cabeçalho é confiado (qualquer cliente poderia forjá-lo).
  const proxies = Number(env.TRUST_PROXY ?? 0);
  if (proxies > 0) {
    app.set("trust proxy", proxies);
  }

  app.use(
    helmet({
      // As fotos e logos de /uploads são exibidas pelo frontend, que está em outra origem.
      crossOriginResourcePolicy: { policy: "cross-origin" },
      // A interface do Swagger usa scripts embutidos; a API em si só devolve JSON.
      contentSecurityPolicy: swaggerEnabled ? false : undefined,
    }),
  );

  // Arquivos enviados (ex.: fotos de pessoas) servidos a partir da pasta local.
  // São públicos para quem tem o link; ver docs/technical-debt.md antes de produção.
  app.useStaticAssets(uploadsRoot(), { prefix: UPLOADS_PUBLIC_PREFIX });

  if (swaggerEnabled) {
    // Documentação gerada a partir dos DTOs e controllers (ver @ApiTags/@ApiBearerAuth).
    const swaggerConfig = new DocumentBuilder()
      .setTitle("Orari API")
      .setDescription(
        "API multiempresa de agendamentos: pessoas, serviços, horário de funcionamento, agenda e pagamentos.",
      )
      .setVersion(env.npm_package_version ?? "0.0.1")
      .addBearerAuth()
      .build();
    SwaggerModule.setup(
      "docs",
      app,
      SwaggerModule.createDocument(app, swaggerConfig),
    );
  }

  // CORS_ORIGIN aceita uma lista separada por vírgulas (ex.: "http://a.com,http://b.com").
  // Em produção ela é obrigatória (ver validateEnv); fora dela, sem a variável,
  // qualquer origem é aceita para facilitar o desenvolvimento.
  app.enableCors({
    origin: env.CORS_ORIGIN
      ? env.CORS_ORIGIN.split(",").map((origin) => origin.trim())
      : true,
  });

  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      transform: true,
      forbidNonWhitelisted: true,
    }),
  );
}
