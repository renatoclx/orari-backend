import { ValidationPipe } from "@nestjs/common";
import type { NestExpressApplication } from "@nestjs/platform-express";
import { DocumentBuilder, SwaggerModule } from "@nestjs/swagger";
import type { NextFunction, Request, Response } from "express";
import helmet from "helmet";
import { posix } from "node:path";
import {
  UPLOADS_PUBLIC_PREFIX,
  uploadsRoot,
} from "./common/storage/local-file-storage.service";
import {
  isValidUploadSignature,
  secondsUntil,
} from "./common/storage/signed-upload-url";
import { SignedUploadsInterceptor } from "./common/storage/signed-uploads.interceptor";
import { PrismaExceptionFilter } from "./prisma/prisma-exception.filter";

type Env = Record<string, string | undefined>;

// Pastas de /uploads abertas a quem tiver o link: só as logos das empresas, que
// aparecem no portal e no login. Todo o resto exige link assinado.
const PUBLIC_UPLOAD_FOLDERS = new Set(["companies"]);

/**
 * Porteiro do /uploads, antes dos arquivos estáticos: a foto privada só sai com
 * assinatura válida e no prazo (403). O caminho é normalizado antes de olhar a
 * pasta, para que "/uploads/companies/../people/x.jpg" não fure a regra.
 */
export function uploadsGate(secret: string) {
  return (req: Request, res: Response, next: NextFunction): void => {
    let relative: string;
    try {
      relative = decodeURIComponent(req.path);
    } catch {
      res.sendStatus(404);
      return;
    }
    if (relative.includes("..") || relative.includes("\0")) {
      res.sendStatus(404);
      return;
    }
    const normalized = posix.normalize(relative);
    const folder = normalized.split("/")[1] ?? "";
    if (PUBLIC_UPLOAD_FOLDERS.has(folder)) {
      next();
      return;
    }

    const { exp, sig } = req.query;
    if (
      !isValidUploadSignature(
        `${UPLOADS_PUBLIC_PREFIX}${normalized}`,
        exp,
        sig,
        secret,
      )
    ) {
      res.sendStatus(403);
      return;
    }
    // Só quem recebeu o link guarda a foto, e no máximo até ele vencer.
    res.setHeader(
      "Cache-Control",
      `private, max-age=${secondsUntil(exp as string)}`,
    );
    next();
  };
}

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
  // Assina os links das fotos privadas; em produção o validateEnv já garante o segredo.
  const uploadsSecret = env.JWT_SECRET;
  if (!uploadsSecret) {
    throw new Error(
      "JWT_SECRET é obrigatório para assinar os links de /uploads",
    );
  }

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

  // Arquivos enviados servidos a partir da pasta local. As fotos de pessoas, de
  // produtos e da conta do portal só saem com o link assinado que a API devolve
  // (ver SignedUploadsInterceptor); as logos são públicas.
  app.use(UPLOADS_PUBLIC_PREFIX, uploadsGate(uploadsSecret));
  app.useStaticAssets(uploadsRoot(), { prefix: UPLOADS_PUBLIC_PREFIX });
  app.useGlobalInterceptors(new SignedUploadsInterceptor(uploadsSecret));

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

  // Erros do Prisma que nenhum service tratou viram 404/409 em vez de 500.
  app.useGlobalFilters(new PrismaExceptionFilter());

  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      transform: true,
      forbidNonWhitelisted: true,
    }),
  );
}
