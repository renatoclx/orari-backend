import { UnauthorizedException } from "@nestjs/common";
import request from "supertest";
import {
  afterAll,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";
import { AuditService } from "../src/modules/audit/audit.service";
import { AuthService } from "../src/modules/auth/auth.service";
import { CompanyService } from "../src/modules/company/company.service";
import { PaymentService } from "../src/modules/payment/payment.service";
import { PeopleService } from "../src/modules/people/people.service";
import { UserService } from "../src/modules/user/user.service";
import {
  ANY_UUID,
  COMPANY_A,
  COMPANY_B,
  USERS,
  createHttpApp,
  discoverRoutes,
  type HttpApp,
  type RouteInfo,
} from "./support/http-app";

/*
 * Camada HTTP sem banco: controllers, guards, JwtStrategy, @Roles, ValidationPipe
 * e limite de tentativas reais; services simulados. Complementa os testes
 * unitários dos services, que cobrem as regras de negócio.
 */

const routes = discoverRoutes();
const send = (http: HttpApp, route: RouteInfo, token?: string) => {
  const call = request(http.server())[route.method](route.path);
  return token ? call.set("Authorization", `Bearer ${token}`) : call;
};
const auth = (http: HttpApp, user: keyof typeof USERS) =>
  `Bearer ${http.tokenFor(USERS[user])}`;

describe("Rotas HTTP", () => {
  let http: HttpApp;

  beforeAll(async () => {
    http = await createHttpApp();
  });
  afterAll(() => http.close());

  describe("autenticação em todas as rotas", () => {
    it("deve descobrir as rotas dos controllers", () => {
      expect(routes.length).toBeGreaterThan(80);
    });

    // Uma rota nova sem @Public passa a ser testada sozinha.
    it.each(routes.filter((route) => !route.isPublic))(
      "$label recusa requisição sem token (401)",
      async (route) => {
        const response = await send(http, route);

        expect(response.status).toBe(401);
      },
    );

    it.each(routes.filter((route) => !route.isPublic).slice(0, 5))(
      "$label recusa token inválido (401)",
      async (route) => {
        const response = await send(http, route, "token-invalido");

        expect(response.status).toBe(401);
      },
    );

    it("deve recusar token adulterado (assinatura diferente)", async () => {
      const [header, payload] = http.tokenFor(USERS.admin).split(".");

      await request(http.server())
        .get("/auth/me")
        .set("Authorization", `Bearer ${header}.${payload}.assinatura-falsa`)
        .expect(401);
    });

    it("deve recusar usuário que não existe mais ou foi excluído", async () => {
      const token = http.tokenFor(USERS.user);
      http.mockOf(UserService).findActiveById.mockResolvedValueOnce(null);

      await request(http.server())
        .get("/auth/me")
        .set("Authorization", `Bearer ${token}`)
        .expect(401);
    });

    it("deve recusar usuário de empresa inativa na hora", async () => {
      http.mockOf(CompanyService).isActive.mockResolvedValueOnce(false);

      await request(http.server())
        .get("/auth/me")
        .set("Authorization", auth(http, "admin"))
        .expect(401);
    });

    it("deve manter públicas só a raiz e as rotas de credencial", () => {
      const open = routes.filter((route) => route.isPublic).map((r) => r.label);

      expect(open.sort()).toEqual([
        "GET / (AppController.getHello)",
        "POST /auth/login (AuthController.login)",
        "POST /auth/logout (AuthController.logout)",
        "POST /auth/refresh (AuthController.refresh)",
      ]);
    });

    it("deve atender as rotas públicas sem token", async () => {
      await request(http.server()).get("/").expect(200).expect("Hello World!");
      // Corpo vazio: chega à validação (400), não ao 401.
      await request(http.server()).post("/auth/login").expect(400);
    });
  });

  describe("perfis (@Roles)", () => {
    const restricted = routes.filter((route) => route.roles?.length);

    // Lista fixa: se uma rota perder o @Roles, o teste gerado abaixo deixaria de
    // existir para ela; aqui a falta do decorador é que falha.
    it.each([
      ["POST /companies", ["SUPER_ADMIN"]],
      ["PATCH /companies/:id", ["SUPER_ADMIN"]],
      ["PATCH /companies/me", ["ADMIN", "SUPER_ADMIN"]],
      ["POST /companies/me/logo", ["ADMIN", "SUPER_ADMIN"]],
      ["DELETE /companies/me/logo", ["ADMIN", "SUPER_ADMIN"]],
      ["POST /users", ["SUPER_ADMIN", "ADMIN"]],
      ["GET /users", ["SUPER_ADMIN", "ADMIN"]],
      ["GET /users/:id", ["SUPER_ADMIN", "ADMIN"]],
      ["PATCH /users/:id", ["SUPER_ADMIN", "ADMIN"]],
      ["PATCH /users/:id/restore", ["SUPER_ADMIN", "ADMIN"]],
      ["DELETE /users/:id", ["SUPER_ADMIN", "ADMIN"]],
      // Auditoria: só o ADMIN; o SUPER_ADMIN não lê dados de saúde de outras empresas.
      ["GET /audit-logs", ["ADMIN"]],
    ])("%s é restrita a %j", (label, expected) => {
      const route = routes.find((r) => r.label.startsWith(`${label} (`));

      expect(route, `rota ${label} não encontrada`).toBeDefined();
      expect([...(route?.roles ?? [])].sort()).toEqual([...expected].sort());
    });

    // O tipo USER nunca está em @Roles: é recusado em toda rota restrita.
    it.each(restricted)("$label recusa USER (403)", async (route) => {
      const response = await send(http, route, http.tokenFor(USERS.user));

      expect(response.status).toBe(403);
    });

    it.each(restricted)(
      "$label deixa passar os perfis permitidos (não é 401 nem 403)",
      async (route) => {
        for (const role of route.roles ?? []) {
          const user = Object.values(USERS).find((u) => u.type === role)!;
          const response = await send(http, route, http.tokenFor(user));

          expect([401, 403]).not.toContain(response.status);
        }
      },
    );

    it("só o SUPER_ADMIN cria empresa e edita outra pelo id; o ADMIN edita a própria", async () => {
      const company = http.mockOf(CompanyService);
      const server = http.server();

      await request(server)
        .patch(`/companies/${ANY_UUID}`)
        .set("Authorization", auth(http, "admin"))
        .send({})
        .expect(403);
      await request(server)
        .post("/companies")
        .set("Authorization", auth(http, "admin"))
        .send({})
        .expect(403);

      company.updateOwn.mockClear();
      await request(server)
        .patch("/companies/me")
        .set("Authorization", auth(http, "admin"))
        .send({ fantasyName: "Nova" })
        .expect(200);
      // A empresa vem do token, nunca da URL ou do corpo.
      expect(company.updateOwn).toHaveBeenCalledWith(COMPANY_A, {
        fantasyName: "Nova",
      });
    });
  });

  describe("ordem das rotas (estáticas antes de :id)", () => {
    beforeEach(() => vi.clearAllMocks());

    it.each([
      ["GET", "/payments/checkouts", "findCheckouts"],
      ["GET", "/payments/summary", "summary"],
    ])("%s %s chega ao service, e não a :id", async (_method, path, name) => {
      const payment = http.mockOf(PaymentService);

      await request(http.server())
        .get(path)
        .set("Authorization", auth(http, "user"))
        .expect(200);

      expect(payment[name]).toHaveBeenCalledTimes(1);
      expect(payment.findOne).not.toHaveBeenCalled();
    });

    it("PATCH /payments/settle chega ao service com a empresa do token", async () => {
      const payment = http.mockOf(PaymentService);
      const body = { paymentIds: [ANY_UUID], paymentMethodId: ANY_UUID };

      await request(http.server())
        .patch("/payments/settle")
        .set("Authorization", auth(http, "admin"))
        .send(body)
        .expect(200);

      expect(payment.settle).toHaveBeenCalledWith(body, COMPANY_A);
      expect(payment.update).not.toHaveBeenCalled();
    });

    it("GET /payments/:id continua chegando ao findOne", async () => {
      const payment = http.mockOf(PaymentService);

      await request(http.server())
        .get(`/payments/${ANY_UUID}`)
        .set("Authorization", auth(http, "user"))
        .expect(200);

      expect(payment.findOne).toHaveBeenCalledWith(ANY_UUID, COMPANY_A);
    });
  });

  describe("validação de entrada", () => {
    const server = () => http.server();

    it("deve recusar id que não é UUID (400)", async () => {
      await request(server())
        .get("/payments/nao-e-uuid")
        .set("Authorization", auth(http, "admin"))
        .expect(400);
    });

    it("auditoria: o ADMIN consulta só a própria empresa e o SUPER_ADMIN é recusado", async () => {
      const audit = http.mockOf(AuditService);
      audit.findAll.mockClear();

      await request(server())
        .get("/audit-logs?action=USER_LINK_CHANGED&page=1&limit=5")
        .set("Authorization", auth(http, "superAdmin"))
        .expect(403);
      expect(audit.findAll).not.toHaveBeenCalled();

      await request(server())
        .get("/audit-logs?action=USER_LINK_CHANGED&page=1&limit=5")
        .set("Authorization", auth(http, "admin"))
        .expect(200);
      expect(audit.findAll).toHaveBeenCalledWith(
        expect.objectContaining({ action: "USER_LINK_CHANGED", limit: 5 }),
        COMPANY_A,
      );
    });

    it("auditoria: recusa filtro inválido e empresa vinda da query (400)", async () => {
      for (const query of [
        "action=QUALQUER",
        "clientId=nao-e-uuid",
        "from=ontem",
        `companyId=${COMPANY_B}`,
      ]) {
        await request(server())
          .get(`/audit-logs?${query}`)
          .set("Authorization", auth(http, "admin"))
          .expect(400);
      }
    });

    it("usuário: aceita peopleId UUID ou null e recusa outro valor (400)", async () => {
      const user = http.mockOf(UserService);
      user.update.mockClear();

      await request(server())
        .patch(`/users/${ANY_UUID}`)
        .set("Authorization", auth(http, "admin"))
        .send({ peopleId: ANY_UUID })
        .expect(200);
      await request(server())
        .patch(`/users/${ANY_UUID}`)
        .set("Authorization", auth(http, "admin"))
        .send({ peopleId: null })
        .expect(200);
      expect(user.update).toHaveBeenCalledTimes(2);

      await request(server())
        .patch(`/users/${ANY_UUID}`)
        .set("Authorization", auth(http, "admin"))
        .send({ peopleId: "abc" })
        .expect(400);
    });

    it("deve recusar campos desconhecidos (400)", async () => {
      await request(server())
        .patch(`/payments/${ANY_UUID}`)
        .set("Authorization", auth(http, "admin"))
        .send({ campoInexistente: 1 })
        .expect(400);
    });

    it("não deve aceitar a empresa vinda do corpo", async () => {
      const people = http.mockOf(PeopleService);
      people.create.mockClear();

      await request(server())
        .post("/people")
        .set("Authorization", auth(http, "admin"))
        .send({ name: "Ana", type: "CLIENT", companyId: COMPANY_B })
        .expect(400);

      expect(people.create).not.toHaveBeenCalled();
    });

    it.each([
      ["lista vazia", { paymentIds: [], paymentMethodId: ANY_UUID }],
      [
        "ids repetidos",
        { paymentIds: [ANY_UUID, ANY_UUID], paymentMethodId: ANY_UUID },
      ],
      ["sem método", { paymentIds: [ANY_UUID] }],
      ["id inválido", { paymentIds: ["x"], paymentMethodId: ANY_UUID }],
    ])("settle recusa %s (400)", async (_caso, body) => {
      await request(server())
        .patch("/payments/settle")
        .set("Authorization", auth(http, "admin"))
        .send(body)
        .expect(400);
    });

    it("summary recusa filtros que não são dele (400)", async () => {
      await request(server())
        .get("/payments/summary?status=PAID")
        .set("Authorization", auth(http, "admin"))
        .expect(400);
    });

    it("deve converter e limitar a paginação", async () => {
      const people = http.mockOf(PeopleService);
      people.findAll.mockClear();

      await request(server())
        .get("/people?page=2&limit=5")
        .set("Authorization", auth(http, "user"))
        .expect(200);
      expect(people.findAll).toHaveBeenCalledWith(
        expect.objectContaining({ page: 2, limit: 5 }),
        COMPANY_A,
      );

      await request(server())
        .get("/people?limit=1000")
        .set("Authorization", auth(http, "user"))
        .expect(400);
    });
  });

  describe("escopo por empresa", () => {
    it("cada usuário chega ao service com a empresa do próprio token", async () => {
      const people = http.mockOf(PeopleService);
      people.findAll.mockClear();

      await request(http.server())
        .get("/people")
        .set("Authorization", auth(http, "admin"))
        .expect(200);
      await request(http.server())
        .get("/people")
        .set("Authorization", auth(http, "otherCompanyAdmin"))
        .expect(200);

      expect(
        people.findAll.mock.calls.map((call: unknown[]) => call[1]),
      ).toEqual([COMPANY_A, COMPANY_B]);
    });
  });

  describe("resposta de erro", () => {
    it("não deve vazar detalhes internos ao falhar", async () => {
      http
        .mockOf(PeopleService)
        .findDetail.mockRejectedValueOnce(
          new Error("falha com detalhe interno do banco"),
        );

      const response = await request(http.server())
        .get(`/people/${ANY_UUID}`)
        .set("Authorization", auth(http, "admin"));

      expect(response.status).toBe(500);
      expect(JSON.stringify(response.body)).not.toContain("detalhe interno");
    });
  });
});

describe("Limite de tentativas (429)", () => {
  let http: HttpApp;

  // App próprio: a contagem de tentativas é por instância e não pode sujar os outros testes.
  beforeAll(async () => {
    http = await createHttpApp();
  });
  afterAll(() => http.close());

  it("login aceita 5 tentativas por minuto e recusa a sexta", async () => {
    http
      .mockOf(AuthService)
      .login.mockRejectedValue(new UnauthorizedException());
    const statuses: number[] = [];

    for (let i = 0; i < 6; i++) {
      const response = await request(http.server())
        .post("/auth/login")
        .send({ email: "a@b.com", password: "123" });
      statuses.push(response.status);
    }

    expect(statuses.slice(0, 5)).not.toContain(429);
    expect(statuses[5]).toBe(429);
  });

  it("logout e /auth/me não entram no limite", async () => {
    for (let i = 0; i < 10; i++) {
      await request(http.server())
        .post("/auth/logout")
        .send({ refreshToken: "x" })
        .expect(204);
    }
    for (let i = 0; i < 10; i++) {
      await request(http.server())
        .get("/auth/me")
        .set("Authorization", auth(http, "user"))
        .expect(200);
    }
  });

  it("refresh aceita 20 tentativas por minuto e recusa a 21ª", async () => {
    const statuses: number[] = [];

    for (let i = 0; i < 21; i++) {
      const response = await request(http.server())
        .post("/auth/refresh")
        .send({ refreshToken: "x" });
      statuses.push(response.status);
    }

    expect(statuses.slice(0, 20)).not.toContain(429);
    expect(statuses[20]).toBe(429);
  });
});
