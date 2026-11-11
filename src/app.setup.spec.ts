import { Controller, Get, Req } from "@nestjs/common";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { NestExpressApplication } from "@nestjs/platform-express";
import { Test } from "@nestjs/testing";
import request from "supertest";
import { afterEach, describe, expect, it } from "vitest";
import { configureApp, isSwaggerEnabled } from "./app.setup";

// Segredo dos links assinados de /uploads (o JWT_SECRET de verdade, na API).
const JWT_SECRET = "segredo-de-teste";
const PHOTO = "/uploads/people/3f2b8c1e-1d2a-4b5c-9e8f-0a1b2c3d4e5f.jpg";
const LOGO = "/uploads/companies/3f2b8c1e-1d2a-4b5c-9e8f-0a1b2c3d4e5f.png";

// Rota mínima: devolve o IP que a API enxerga, para testar o trust proxy.
@Controller()
class ProbeController {
  @Get("probe")
  probe(@Req() req: { ip: string }) {
    return { ip: req.ip };
  }

  // Uma resposta com foto, como as da API.
  @Get("photo")
  photo() {
    return { photoUrl: PHOTO, logoUrl: LOGO };
  }
}

describe("configureApp", () => {
  let app: NestExpressApplication;

  const start = async (env: Record<string, string | undefined> = {}) => {
    const moduleRef = await Test.createTestingModule({
      controllers: [ProbeController],
    }).compile();
    app = moduleRef.createNestApplication<NestExpressApplication>();
    configureApp(app, { JWT_SECRET, ...env });
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

  describe("/uploads", () => {
    let root: string;
    const previous = process.env.UPLOADS_DIR;

    // Pasta de uploads de verdade, com uma foto e uma logo.
    const startWithFiles = async () => {
      root = await mkdtemp(join(tmpdir(), "orari-gate-"));
      process.env.UPLOADS_DIR = root;
      for (const path of [PHOTO, LOGO]) {
        const file = join(root, path.replace("/uploads/", ""));
        await mkdir(join(file, ".."), { recursive: true });
        await writeFile(file, "img");
      }
      return start();
    };

    afterEach(async () => {
      process.env.UPLOADS_DIR = previous;
      await rm(root, { recursive: true, force: true });
    });

    it("assina a foto na resposta, e o link assinado abre a foto", async () => {
      const http = await startWithFiles();

      const signed = await http.get("/photo").expect(200);
      const { photoUrl, logoUrl } = signed.body as Record<string, string>;
      const response = await http.get(photoUrl).expect(200);

      expect(logoUrl).toBe(LOGO);
      expect(response.headers["cache-control"]).toMatch(
        /^private, max-age=\d+$/,
      );
    });

    it("recusa a foto sem assinatura ou com assinatura adulterada (403)", async () => {
      const http = await startWithFiles();

      await http.get(PHOTO).expect(403);
      await http.get(`${PHOTO}?exp=9999999999&sig=falsa`).expect(403);
    });

    it("não deixa um caminho com .. passar pela pasta pública", async () => {
      const http = await startWithFiles();

      await http
        .get(`/uploads/companies/..%2Fpeople%2F${PHOTO.split("/").pop()}`)
        .expect(404);
    });

    it("serve a logo sem assinatura", async () => {
      const http = await startWithFiles();

      await http.get(LOGO).expect(200);
    });
  });
});
