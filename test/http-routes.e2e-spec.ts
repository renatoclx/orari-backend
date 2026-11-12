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
import { AnamnesisPdfService } from "../src/modules/anamnesis/anamnesis-pdf.service";
import { AnamnesisService } from "../src/modules/anamnesis/anamnesis.service";
import { AnamnesisTemplateService } from "../src/modules/anamnesis/anamnesis-template.service";
import { AuditService } from "../src/modules/audit/audit.service";
import { ProfessionalAppService } from "../src/modules/professional-app/professional-app.service";
import { ProfessionalCommissionService } from "../src/modules/professional-app/professional-commission.service";
import { ProfessionalHomeService } from "../src/modules/professional-app/professional-home.service";
import { ProfessionalClientsService } from "../src/modules/professional-app/professional-clients.service";
import { AuthService } from "../src/modules/auth/auth.service";
import { CompanyService } from "../src/modules/company/company.service";
import { PaymentCheckoutService } from "../src/modules/payment/payment-checkout.service";
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
      const token = http.tokenFor(USERS.admin);
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
        "POST /auth/professional/login (AuthController.professionalLogin)",
        "POST /auth/refresh (AuthController.refresh)",
      ]);
    });

    it("deve atender as rotas públicas sem token", async () => {
      await request(http.server()).get("/").expect(200).expect("Hello World!");
      // Corpo vazio: chega à validação (400), não ao 401.
      await request(http.server()).post("/auth/login").expect(400);
      await request(http.server()).post("/auth/professional/login").expect(400);
    });
  });

  describe("perfil só de app (PROFESSIONAL): nega por padrão", () => {
    const closed = routes.filter(
      (route) => !route.isPublic && !route.professionalApp,
    );

    // Uma rota nova entra aqui sozinha: sem @ProfessionalApp(), o profissional
    // recebe 403, mesmo nas rotas sem @Roles (agenda, pessoas, pagamentos...).
    it("deve haver rotas fechadas para ele", () => {
      expect(closed.length).toBeGreaterThan(80);
    });

    it.each(closed.map((route) => [route.label, route] as const))(
      "%s responde 403",
      async (_, route) => {
        const response = await send(
          http,
          route,
          http.tokenFor(USERS.professional),
        );

        expect(response.status).toBe(403);
      },
    );

    it("as rotas marcadas são só as do app: o próprio perfil e a troca de senha", () => {
      expect(
        routes
          .filter((route) => route.professionalApp)
          .map((route) => route.label)
          .sort(),
      ).toEqual([
        "GET /auth/me (AuthController.me)",
        "GET /professional-app/agenda (ProfessionalAppController.findAgenda)",
        "GET /professional-app/clients (ProfessionalAppController.findClients)",
        "GET /professional-app/clients/:id (ProfessionalAppController.findClient)",
        "GET /professional-app/commission-closings (ProfessionalCommissionController.findClosings)",
        "GET /professional-app/commission-closings/:id (ProfessionalCommissionController.findClosing)",
        "GET /professional-app/commissions (ProfessionalCommissionController.findCommissions)",
        "GET /professional-app/commissions/summary (ProfessionalCommissionController.findSummary)",
        "GET /professional-app/home (ProfessionalAppController.findHome)",
        "PATCH /auth/me/password (AuthController.changePassword)",
      ]);
    });

    it("ele lê o próprio perfil e troca a própria senha", async () => {
      const auth = http.mockOf(AuthService);
      auth.changePassword.mockClear();
      const token = http.tokenFor(USERS.professional);

      await request(http.server())
        .get("/auth/me")
        .set("Authorization", `Bearer ${token}`)
        .expect(200);
      await request(http.server())
        .patch("/auth/me/password")
        .set("Authorization", `Bearer ${token}`)
        .send({
          currentPassword: "Senha@Antiga1",
          newPassword: "Nova@Senha123",
          newPasswordConfirmation: "Nova@Senha123",
        })
        .expect(204);
      expect(auth.changePassword).toHaveBeenCalledWith(
        USERS.professional.id,
        expect.objectContaining({ currentPassword: "Senha@Antiga1" }),
      );
    });

    it("ele lê a própria agenda; o dia é validado e o profissional não vem da consulta", async () => {
      const service = http.mockOf(ProfessionalAppService);
      service.findAgenda.mockResolvedValue({ day: "2026-11-12" });
      const token = http.tokenFor(USERS.professional);

      await request(http.server())
        .get("/professional-app/agenda?day=2026-11-12")
        .set("Authorization", `Bearer ${token}`)
        .expect(200);
      expect(service.findAgenda).toHaveBeenCalledWith(
        expect.objectContaining({ id: USERS.professional.id }),
        "2026-11-12",
      );
      await request(http.server())
        .get("/professional-app/agenda?day=12/11/2026")
        .set("Authorization", `Bearer ${token}`)
        .expect(400);
      // Parâmetro de profissional é recusado (whitelist): não há como espiar outro.
      await request(http.server())
        .get("/professional-app/agenda?professionalId=outro")
        .set("Authorization", `Bearer ${token}`)
        .expect(400);
    });

    it("ele lê o próprio Início; os demais perfis recebem 403", async () => {
      const home = http.mockOf(ProfessionalHomeService);
      home.find.mockResolvedValue({ today: { total: 0 } });
      await request(http.server())
        .get("/professional-app/home")
        .set("Authorization", `Bearer ${http.tokenFor(USERS.professional)}`)
        .expect(200);
      expect(home.find).toHaveBeenCalledWith(
        expect.objectContaining({ id: USERS.professional.id }),
      );
      for (const user of [USERS.superAdmin, USERS.admin]) {
        await request(http.server())
          .get("/professional-app/home")
          .set("Authorization", `Bearer ${http.tokenFor(user)}`)
          .expect(403);
      }
    });

    it("ele lê os próprios clientes; o id é validado e os demais perfis recebem 403", async () => {
      const clients = http.mockOf(ProfessionalClientsService);
      clients.findAll.mockResolvedValue({ items: [], total: 0 });
      clients.findOne.mockResolvedValue({ id: ANY_UUID });
      const token = http.tokenFor(USERS.professional);

      await request(http.server())
        .get("/professional-app/clients?search=ana&page=2")
        .set("Authorization", `Bearer ${token}`)
        .expect(200);
      expect(clients.findAll).toHaveBeenCalledWith(
        expect.objectContaining({ id: USERS.professional.id }),
        expect.objectContaining({ search: "ana", page: 2, limit: 10 }),
      );
      await request(http.server())
        .get(`/professional-app/clients/${ANY_UUID}`)
        .set("Authorization", `Bearer ${token}`)
        .expect(200);
      await request(http.server())
        .get("/professional-app/clients/nao-e-uuid")
        .set("Authorization", `Bearer ${token}`)
        .expect(400);
      // Não há como pedir os clientes de outro profissional.
      await request(http.server())
        .get("/professional-app/clients?professionalId=outro")
        .set("Authorization", `Bearer ${token}`)
        .expect(400);
      for (const user of [USERS.superAdmin, USERS.admin]) {
        await request(http.server())
          .get("/professional-app/clients")
          .set("Authorization", `Bearer ${http.tokenFor(user)}`)
          .expect(403);
      }
    });

    it("ele lê as próprias comissões; mês e id são validados e os demais perfis recebem 403", async () => {
      const commission = http.mockOf(ProfessionalCommissionService);
      commission.summary.mockResolvedValue({ month: "2026-11" });
      commission.list.mockResolvedValue({ items: [], total: 0 });
      commission.listClosings.mockResolvedValue([]);
      commission.receipt.mockResolvedValue({ id: ANY_UUID });
      const token = http.tokenFor(USERS.professional);
      const get = (path: string, bearer = token) =>
        request(http.server())
          .get(path)
          .set("Authorization", `Bearer ${bearer}`);

      await get("/professional-app/commissions/summary?month=2026-11").expect(
        200,
      );
      expect(commission.summary).toHaveBeenCalledWith(
        expect.objectContaining({ id: USERS.professional.id }),
        expect.objectContaining({ month: "2026-11" }),
      );
      await get("/professional-app/commissions?month=2026-11&page=2").expect(
        200,
      );
      await get("/professional-app/commission-closings?page=2").expect(200);
      expect(commission.listClosings).toHaveBeenCalledWith(
        expect.objectContaining({ id: USERS.professional.id }),
        expect.objectContaining({ page: 2, limit: 10 }),
      );
      await get(`/professional-app/commission-closings/${ANY_UUID}`).expect(
        200,
      );
      await get("/professional-app/commissions/summary?month=2026-13").expect(
        400,
      );
      await get("/professional-app/commission-closings/nao-e-uuid").expect(400);
      // Não há como pedir as de outro profissional.
      await get("/professional-app/commissions?professionalId=outro").expect(
        400,
      );
      for (const user of [USERS.superAdmin, USERS.admin]) {
        await get(
          "/professional-app/commissions/summary",
          http.tokenFor(user),
        ).expect(403);
      }
    });

    it("a agenda do app é só do profissional: os demais perfis recebem 403", async () => {
      for (const user of [USERS.admin, USERS.superAdmin]) {
        await request(http.server())
          .get("/professional-app/agenda")
          .set("Authorization", `Bearer ${http.tokenFor(user)}`)
          .expect(403);
      }
    });

    it("a troca de senha recusa confirmação diferente e senha fraca (400)", async () => {
      const token = http.tokenFor(USERS.professional);
      const body = {
        currentPassword: "Senha@Antiga1",
        newPassword: "Nova@Senha123",
        newPasswordConfirmation: "Nova@Senha123",
      };

      await request(http.server())
        .patch("/auth/me/password")
        .set("Authorization", `Bearer ${token}`)
        .send({ ...body, newPasswordConfirmation: "outra" })
        .expect(400);
      await request(http.server())
        .patch("/auth/me/password")
        .set("Authorization", `Bearer ${token}`)
        .send({ ...body, newPassword: "123", newPasswordConfirmation: "123" })
        .expect(400);
    });

    it("o login por telefone é público e valida o corpo (400 sem a senha)", async () => {
      const auth = http.mockOf(AuthService);
      auth.professionalLogin.mockClear();

      await request(http.server())
        .post("/auth/professional/login")
        .send({ phone: "(11) 98888-0001", password: "senha" })
        .expect(200);
      expect(auth.professionalLogin).toHaveBeenCalledWith({
        phone: "(11) 98888-0001",
        password: "senha",
      });
      await request(http.server())
        .post("/auth/professional/login")
        .send({ phone: "(11) 98888-0001" })
        .expect(400);
    });

    it("os demais perfis não são afetados pela marca (ADMIN abre a agenda)", async () => {
      await request(http.server())
        .get("/appointments")
        .set("Authorization", auth(http, "admin"))
        .expect(200);
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
      // Modelos de anamnese: escrita só do ADMIN. A leitura não usa @Roles: o
      // service confere o acesso (ADMIN ou profissional vinculado).
      ["POST /anamnesis-templates", ["ADMIN"]],
      ["PATCH /anamnesis-templates/:id", ["ADMIN"]],
      // Turmas: só o ADMIN (ver docs/turmas.md).
      // Produtos e categorias: só o ADMIN.
      ["POST /product-categories", ["ADMIN"]],
      ["GET /product-categories", ["ADMIN"]],
      ["GET /product-categories/:id", ["ADMIN"]],
      ["PATCH /product-categories/:id", ["ADMIN"]],
      ["POST /products", ["ADMIN"]],
      ["GET /products", ["ADMIN"]],
      ["GET /products/:id", ["ADMIN"]],
      ["PATCH /products/:id", ["ADMIN"]],
      ["DELETE /products/:id", ["ADMIN"]],
      ["POST /products/:id/photo", ["ADMIN"]],
      ["DELETE /products/:id/photo", ["ADMIN"]],
      ["POST /products/:id/stock-movements", ["ADMIN"]],
      ["GET /products/:id/stock-movements", ["ADMIN"]],
      // Venda de produtos: só o ADMIN vende (a comanda mostra a todos).
      ["GET /product-sales/products", ["ADMIN"]],
      ["POST /product-sales", ["ADMIN"]],
      ["PATCH /product-sales/:id/cancel", ["ADMIN"]],
      ["POST /class-groups", ["ADMIN"]],
      ["GET /class-groups", ["ADMIN"]],
      ["GET /class-groups/:id", ["ADMIN"]],
      ["GET /class-groups/:id/members", ["ADMIN"]],
      ["PATCH /class-groups/:id", ["ADMIN"]],
      ["POST /class-groups/:id/participants", ["ADMIN"]],
      ["POST /class-sessions", ["ADMIN"]],
      ["GET /class-sessions", ["ADMIN"]],
      ["GET /class-sessions/:id", ["ADMIN"]],
      ["PATCH /class-sessions/:id", ["ADMIN"]],
      ["POST /class-sessions/:id/participants", ["ADMIN"]],
      ["PATCH /class-sessions/:id/cancel", ["ADMIN"]],
      ["PATCH /recurring-appointments/:id/leave-class", ["ADMIN"]],
      [
        "PATCH /recurring-appointments/:id/appointments/:id/replace-in-class",
        ["ADMIN"],
      ],
    ])("%s é restrita a %j", (label, expected) => {
      const route = routes.find((r) => r.label.startsWith(`${label} (`));

      expect(route, `rota ${label} não encontrada`).toBeDefined();
      expect([...(route?.roles ?? [])].sort()).toEqual([...expected].sort());
    });

    // O PROFESSIONAL só está em @Roles nas rotas do app; nas demais o
    // ProfessionalAppGuard o nega por padrão, mesmo sem o @Roles.
    it.each(
      restricted.filter((route) => !route.roles?.includes("PROFESSIONAL")),
    )("$label recusa PROFESSIONAL (403)", async (route) => {
      const response = await send(
        http,
        route,
        http.tokenFor(USERS.professional),
      );

      expect(response.status).toBe(403);
    });

    // O SUPER_ADMIN só passa onde o @Roles o lista.
    it.each(
      restricted.filter((route) => !route.roles?.includes("SUPER_ADMIN")),
    )("$label recusa SUPER_ADMIN (403)", async (route) => {
      const response = await send(http, route, http.tokenFor(USERS.superAdmin));

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
      ["GET", "/payments/checkouts", PaymentCheckoutService, "findCheckouts"],
      ["GET", "/payments/summary", PaymentService, "summary"],
    ] as const)(
      "%s %s chega ao service, e não a :id",
      async (_method, path, service, name) => {
        const target = http.mockOf(service);

        await request(http.server())
          .get(path)
          .set("Authorization", auth(http, "admin"))
          .expect(200);

        expect(target[name]).toHaveBeenCalledTimes(1);
        expect(http.mockOf(PaymentService).findOne).not.toHaveBeenCalled();
      },
    );

    it("PATCH /payments/settle chega ao service com a empresa do token", async () => {
      const payment = http.mockOf(PaymentService);
      const checkout = http.mockOf(PaymentCheckoutService);
      const body = { paymentIds: [ANY_UUID], paymentMethodId: ANY_UUID };

      await request(http.server())
        .patch("/payments/settle")
        .set("Authorization", auth(http, "admin"))
        .send(body)
        .expect(200);

      expect(checkout.settle).toHaveBeenCalledWith(body, COMPANY_A);
      expect(payment.update).not.toHaveBeenCalled();
    });

    it("GET /payments/:id continua chegando ao findOne", async () => {
      const payment = http.mockOf(PaymentService);

      await request(http.server())
        .get(`/payments/${ANY_UUID}`)
        .set("Authorization", auth(http, "admin"))
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

    it("produto: a alteração recusa o estoque atual (muda só pelas movimentações)", async () => {
      await request(server())
        .patch(`/products/${ANY_UUID}`)
        .set("Authorization", auth(http, "admin"))
        .send({ currentStock: 5 })
        .expect(400);
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

    it("modelo de anamnese: ADMIN cria, SUPER_ADMIN recebe 403 na escrita e a leitura chega ao service", async () => {
      const templates = http.mockOf(AnamnesisTemplateService);
      templates.create.mockClear();
      const body = {
        name: "Pilates",
        questions: [{ label: "Dor", type: "SCALE" }],
      };

      await request(server())
        .post("/anamnesis-templates")
        .set("Authorization", auth(http, "superAdmin"))
        .send(body)
        .expect(403);
      expect(templates.create).not.toHaveBeenCalled();

      await request(server())
        .post("/anamnesis-templates")
        .set("Authorization", auth(http, "admin"))
        .send(body)
        .expect(201);
      expect(templates.create).toHaveBeenCalledTimes(1);

      // A leitura passa o usuário ao service, que decide o acesso (aqui simulado).
      await request(server())
        .get(`/anamnesis-templates/${ANY_UUID}`)
        .set("Authorization", auth(http, "superAdmin"))
        .expect(200);
      expect(templates.findOne).toHaveBeenCalledWith(
        ANY_UUID,
        expect.objectContaining({
          id: USERS.superAdmin.id,
          type: "SUPER_ADMIN",
        }),
      );
    });

    it("ficha de anamnese: o acesso é conferido no service e o IP chega a ele", async () => {
      const anamnesis = http.mockOf(AnamnesisService);
      anamnesis.create.mockClear();
      const body = {
        clientId: ANY_UUID,
        templateId: ANY_UUID,
        answers: [{ questionId: ANY_UUID, value: { answer: true } }],
      };

      await request(server())
        .post("/anamnesis")
        .set("Authorization", auth(http, "admin"))
        .send(body)
        .expect(201);
      expect(anamnesis.create).toHaveBeenCalledWith(
        expect.objectContaining({ clientId: ANY_UUID }),
        expect.objectContaining({ id: USERS.admin.id }),
        expect.any(String),
      );

      await request(server())
        .get(`/anamnesis?clientId=${ANY_UUID}`)
        .set("Authorization", auth(http, "admin"))
        .expect(200);
      await request(server())
        .get(`/anamnesis/${ANY_UUID}`)
        .set("Authorization", auth(http, "admin"))
        .expect(200);
    });

    it("ficha de anamnese: o PDF sai com tipo, nome genérico e sem cache", async () => {
      const pdf = http.mockOf(AnamnesisPdfService);
      pdf.generate.mockClear();
      pdf.generate.mockResolvedValue(Buffer.from("%PDF-1.4 teste"));

      const response = await request(server())
        .get(`/anamnesis/${ANY_UUID}/pdf`)
        .set("Authorization", auth(http, "admin"))
        .expect(200);

      expect(response.headers["content-type"]).toContain("application/pdf");
      expect(response.headers["cache-control"]).toBe("no-store");
      expect(response.headers["content-disposition"]).toMatch(
        /^inline; filename="ficha-anamnese-\d{4}-\d{2}-\d{2}\.pdf"$/,
      );
      // O histórico é impresso por padrão; includeHistory=false o omite.
      expect(pdf.generate).toHaveBeenLastCalledWith(
        ANY_UUID,
        expect.objectContaining({ includeHistory: true }),
        expect.objectContaining({ id: USERS.admin.id }),
        expect.any(String),
      );

      await request(server())
        .get(`/anamnesis/${ANY_UUID}/pdf?includeHistory=false`)
        .set("Authorization", auth(http, "admin"))
        .expect(200);
      expect(pdf.generate).toHaveBeenLastCalledWith(
        ANY_UUID,
        expect.objectContaining({ includeHistory: false }),
        expect.anything(),
        expect.anything(),
      );

      await request(server())
        .get(`/anamnesis/${ANY_UUID}/pdf?includeHistory=talvez`)
        .set("Authorization", auth(http, "admin"))
        .expect(400);
      await request(server())
        .get("/anamnesis/nao-e-uuid/pdf")
        .set("Authorization", auth(http, "admin"))
        .expect(400);
    });

    it("ficha de anamnese: não tem edição nem exclusão e valida a entrada (400)", async () => {
      for (const method of ["patch", "put", "delete"] as const) {
        await request(server())
          [method](`/anamnesis/${ANY_UUID}`)
          .set("Authorization", auth(http, "admin"))
          .expect(404);
      }

      const ok = { clientId: ANY_UUID, templateId: ANY_UUID, answers: [] };
      for (const body of [
        { ...ok, clientId: "x" },
        { ...ok, answers: undefined },
        { ...ok, consultationDate: "27/10/2026" },
        { ...ok, companyId: COMPANY_B },
        { ...ok, answers: [{ questionId: "x", value: 1 }] },
        { ...ok, answers: [{ questionId: ANY_UUID }] },
      ]) {
        await request(server())
          .post("/anamnesis")
          .set("Authorization", auth(http, "admin"))
          .send(body)
          .expect(400);
      }

      // Acompanhamento: evolução obrigatória e limitada; data no formato certo.
      for (const body of [
        {},
        { evolution: "   " },
        { evolution: "a".repeat(10001) },
        { evolution: "ok", consultationDate: "ontem" },
        { evolution: "ok", appointmentId: "x" },
        { evolution: "ok", kind: "INITIAL" },
      ]) {
        await request(server())
          .post(`/anamnesis/${ANY_UUID}/entries`)
          .set("Authorization", auth(http, "admin"))
          .send(body)
          .expect(400);
      }
      await request(server())
        .post(`/anamnesis/${ANY_UUID}/entries`)
        .set("Authorization", auth(http, "admin"))
        .send({ evolution: "Melhorou" })
        .expect(201);

      // A listagem exige o cliente; não há listagem geral.
      await request(server())
        .get("/anamnesis")
        .set("Authorization", auth(http, "admin"))
        .expect(400);
    });

    it("modelo de anamnese: recusa perguntas fora do formato (400)", async () => {
      for (const questions of [
        [],
        [{ label: "Dor", type: "OUTRO" }],
        [{ label: "a".repeat(401), type: "SCALE" }],
        [{ label: "Dor", type: "SCALE", position: 2 }],
      ]) {
        await request(server())
          .post("/anamnesis-templates")
          .set("Authorization", auth(http, "admin"))
          .send({ name: "Pilates", questions })
          .expect(400);
      }
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

    // "Lista vazia" saiu daqui: desde o receber antes da conclusão, as duas
    // listas são opcionais e "ao menos um item" é conferido no serviço
    // (payment.service.spec: "recusa a baixa sem nenhum item").
    it.each([
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
        .set("Authorization", auth(http, "admin"))
        .expect(200);
      expect(people.findAll).toHaveBeenCalledWith(
        expect.objectContaining({ page: 2, limit: 5 }),
        COMPANY_A,
      );

      await request(server())
        .get("/people?limit=1000")
        .set("Authorization", auth(http, "admin"))
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
        .set("Authorization", auth(http, "admin"))
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
