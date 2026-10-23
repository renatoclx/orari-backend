import { Controller, Get, Req } from "@nestjs/common";
import type { NestExpressApplication } from "@nestjs/platform-express";
import { Test } from "@nestjs/testing";
import request from "supertest";
import { afterEach, describe, expect, it } from "vitest";
import { configureApp, isSwaggerEnabled } from "./app.setup";

// Rota mínima: devolve o IP que a API enxerga, para testar o trust proxy.
@Controller()
class ProbeController {
  @Get("probe")
  probe(@Req() req: { ip: string }) {
    return { ip: req.ip };
  }
}

describe("configureApp", () => {
  let app: NestExpressApplication;

  const start = async (env: Record<string, string | undefined> = {}) => {
    const moduleRef = await Test.createTestingModule({
      controllers: [ProbeController],
    }).compile();
    app = moduleRef.createNestApplication<NestExpressApplication>();
    configureApp(app, env);
    await app.init();

    return request(app.getHttpServer());
  };

  afterEach(() => app?.close());

  describe("isSwaggerEnabled", () => {
    it.each([
      [{}, true],
      [{ NODE_ENV: "development" }, true],
      [{ NODE_ENV: "production" }, false],
      [{ NODE_ENV: "production", SWAGGER_ENABLED: "true" }, true],
      [{ NODE_ENV: "development", SWAGGER_ENABLED: "false" }, false],
    ])("%j → %s", (env, expected) => {
      expect(isSwaggerEnabled(env)).toBe(expected);
    });
  });

  describe("Swagger", () => {
    it("deve servir a documentação fora de produção", async () => {
      const http = await start({ NODE_ENV: "development" });

      await http.get("/docs").expect(200);
    });

    it("não deve servir a documentação em produção", async () => {
      const http = await start({ NODE_ENV: "production" });

      await http.get("/docs").expect(404);
      await http.get("/docs-json").expect(404);
    });

    it("deve servir em produção quando SWAGGER_ENABLED=true", async () => {
      const http = await start({
        NODE_ENV: "production",
        SWAGGER_ENABLED: "true",
      });

      await http.get("/docs").expect(200);
    });
  });

  describe("headers de segurança", () => {
    it("deve enviar os headers do helmet", async () => {
      const http = await start({ NODE_ENV: "production" });

      const response = await http.get("/probe").expect(200);

      expect(response.headers["x-content-type-options"]).toBe("nosniff");
      expect(response.headers["x-frame-options"]).toBeDefined();
      expect(response.headers["strict-transport-security"]).toBeDefined();
      expect(response.headers["content-security-policy"]).toBeDefined();
      // Não revela o framework.
      expect(response.headers["x-powered-by"]).toBeUndefined();
    });

    it("deve permitir que outra origem exiba os arquivos de /uploads", async () => {
      const http = await start({ NODE_ENV: "production" });

      const response = await http.get("/probe");

      expect(response.headers["cross-origin-resource-policy"]).toBe(
        "cross-origin",
      );
    });
  });

  describe("CORS", () => {
    const origin = "https://app.orari.com.br";

    it("deve aceitar só as origens da lista", async () => {
      const http = await start({
        CORS_ORIGIN: `${origin}, https://admin.orari.com.br`,
      });

      const allowed = await http.get("/probe").set("Origin", origin);
      const other = await http
        .get("/probe")
        .set("Origin", "https://site-malicioso.com");

      expect(allowed.headers["access-control-allow-origin"]).toBe(origin);
      expect(other.headers["access-control-allow-origin"]).toBeUndefined();
    });

    it("deve aceitar qualquer origem fora de produção, sem a variável", async () => {
      const http = await start({ NODE_ENV: "development" });

      const response = await http.get("/probe").set("Origin", "http://x.test");

      expect(response.headers["access-control-allow-origin"]).toBeDefined();
    });
  });

  describe("trust proxy", () => {
    const forwarded = "203.0.113.7";

    it("não deve confiar no X-Forwarded-For sem TRUST_PROXY (cliente poderia forjá-lo)", async () => {
      const http = await start({});

      const response = await http
        .get("/probe")
        .set("X-Forwarded-For", forwarded);

      expect((response.body as { ip: string }).ip).not.toContain(forwarded);
    });

    it("deve usar o IP do cliente quando há um proxy à frente", async () => {
      const http = await start({ TRUST_PROXY: "1" });

      const response = await http
        .get("/probe")
        .set("X-Forwarded-For", forwarded);

      expect((response.body as { ip: string }).ip).toBe(forwarded);
    });
  });
});
