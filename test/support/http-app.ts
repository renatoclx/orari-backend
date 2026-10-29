import "reflect-metadata";
import { RequestMethod, Type, ValidationPipe } from "@nestjs/common";
import type { INestApplication } from "@nestjs/common";
import { PATH_METADATA, METHOD_METADATA } from "@nestjs/common/constants";
import { ConfigService } from "@nestjs/config";
import { APP_GUARD } from "@nestjs/core";
import { JwtModule, JwtService } from "@nestjs/jwt";
import { PassportModule } from "@nestjs/passport";
import { Test } from "@nestjs/testing";
import { ThrottlerModule } from "@nestjs/throttler";
import type request from "supertest";
import { vi, type Mock } from "vitest";
import { UserType } from "../../generated/prisma/enums";
import { AppController } from "../../src/app.controller";
import { AppService } from "../../src/app.service";
import { IS_PUBLIC_KEY } from "../../src/common/decorators/public.decorator";
import { ROLES_KEY } from "../../src/common/decorators/roles.decorator";
import { AddressController } from "../../src/modules/address/address.controller";
import { AnamnesisController } from "../../src/modules/anamnesis/anamnesis.controller";
import { AnamnesisTemplateController } from "../../src/modules/anamnesis/anamnesis-template.controller";
import { AppointmentController } from "../../src/modules/appointment/appointment.controller";
import {
  AUTH_THROTTLER,
  LOGIN_LIMIT,
} from "../../src/modules/auth/auth-throttle";
import { AuthController } from "../../src/modules/auth/auth.controller";
import { JwtAuthGuard } from "../../src/modules/auth/guards/jwt-auth.guard";
import { RolesGuard } from "../../src/modules/auth/guards/roles.guard";
import { JwtStrategy } from "../../src/modules/auth/strategies/jwt.strategy";
import { AuditController } from "../../src/modules/audit/audit.controller";
import { BusinessHourController } from "../../src/modules/business-hour/business-hour.controller";
import { CityController } from "../../src/modules/city/city.controller";
import { ClassGroupController } from "../../src/modules/class-group/class-group.controller";
import { ClientPlanController } from "../../src/modules/client-plan/client-plan.controller";
import { CompanyController } from "../../src/modules/company/company.controller";
import { CompanyService } from "../../src/modules/company/company.service";
import { ContactController } from "../../src/modules/contact/contact.controller";
import { NotificationController } from "../../src/modules/notification/notification.controller";
import { PaymentMethodController } from "../../src/modules/payment-method/payment-method.controller";
import { PaymentController } from "../../src/modules/payment/payment.controller";
import { PeopleController } from "../../src/modules/people/people.controller";
import { PlanController } from "../../src/modules/plan/plan.controller";
import { RecurringAppointmentController } from "../../src/modules/recurring-appointment/recurring-appointment.controller";
import { ServiceController } from "../../src/modules/service/service.controller";
import { StateController } from "../../src/modules/state/state.controller";
import { UserController } from "../../src/modules/user/user.controller";
import { UserService } from "../../src/modules/user/user.service";

/**
 * Aplicação HTTP para os testes de rota: controllers, guards, JwtStrategy,
 * ValidationPipe e limite de tentativas são os reais; os services são
 * simulados. Não há banco: o que se verifica é a camada HTTP (rota, permissão,
 * validação, status e o que chega ao service).
 */
export const CONTROLLERS: Type<unknown>[] = [
  AppController,
  AddressController,
  AnamnesisController,
  AnamnesisTemplateController,
  AppointmentController,
  AuditController,
  AuthController,
  BusinessHourController,
  CityController,
  ClassGroupController,
  ClientPlanController,
  CompanyController,
  ContactController,
  NotificationController,
  PaymentMethodController,
  PaymentController,
  PeopleController,
  PlanController,
  RecurringAppointmentController,
  ServiceController,
  StateController,
  UserController,
];

export const JWT_SECRET = "segredo-de-teste";

export const COMPANY_A = "11111111-1111-4111-8111-111111111111";
export const COMPANY_B = "22222222-2222-4222-8222-222222222222";
export const ANY_UUID = "33333333-3333-4333-8333-333333333333";

export interface TestUser {
  id: string;
  email: string;
  type: UserType;
  companyId: string;
}

export const USERS: Record<string, TestUser> = {
  superAdmin: {
    id: "aaaaaaaa-0000-4000-8000-000000000001",
    email: "super@orari.test",
    type: "SUPER_ADMIN",
    companyId: COMPANY_A,
  },
  admin: {
    id: "aaaaaaaa-0000-4000-8000-000000000002",
    email: "admin@orari.test",
    type: "ADMIN",
    companyId: COMPANY_A,
  },
  user: {
    id: "aaaaaaaa-0000-4000-8000-000000000003",
    email: "user@orari.test",
    type: "USER",
    companyId: COMPANY_A,
  },
  otherCompanyAdmin: {
    id: "aaaaaaaa-0000-4000-8000-000000000004",
    email: "admin-b@orari.test",
    type: "ADMIN",
    companyId: COMPANY_B,
  },
};

export type ServiceMock = Record<string, Mock>;

// Service simulado: qualquer método existe e resolve com {} até o teste dizer outra coisa.
function createServiceMock(): ServiceMock {
  const methods: ServiceMock = {};

  return new Proxy(methods, {
    get(target, property: string | symbol) {
      // "then" faria o Nest tratar o service como uma Promise (e esperar para sempre).
      if (typeof property === "symbol" || property === "then") {
        return undefined;
      }
      target[property] ??= vi.fn().mockResolvedValue({});
      return target[property];
    },
  });
}

export interface HttpApp {
  app: INestApplication;
  /** Servidor HTTP tipado para o supertest. */
  server: () => Parameters<typeof request>[0];
  /** Service simulado de um controller (ou de qualquer classe provida). */
  mockOf: (token: Type<unknown>) => ServiceMock;
  /** Access token válido para o usuário. */
  tokenFor: (user: TestUser) => string;
  /** Marca a empresa do usuário como inativa para o JwtStrategy. */
  deactivateCompany: (companyId: string) => void;
  close: () => Promise<void>;
}

export async function createHttpApp(): Promise<HttpApp> {
  const mocks = new Map<unknown, ServiceMock>();
  const mockOf = (token: Type<unknown>) => {
    if (!mocks.has(token)) {
      mocks.set(token, createServiceMock());
    }
    return mocks.get(token)!;
  };

  // Cada controller recebe um service simulado (o token vem do construtor).
  for (const controller of CONTROLLERS) {
    const dependencies =
      (Reflect.getMetadata("design:paramtypes", controller) as
        Type<unknown>[] | undefined) ?? [];
    // O AppService é trivial e entra real.
    dependencies
      .filter((dependency) => dependency !== AppService)
      .forEach((dependency) => mockOf(dependency));
  }

  // O JwtStrategy recarrega o usuário e confere a empresa a cada requisição.
  const inactiveCompanies = new Set<string>();
  const users = Object.values(USERS);
  mockOf(UserService).findActiveById.mockImplementation((id: string) =>
    Promise.resolve(users.find((user) => user.id === id) ?? null),
  );
  mockOf(CompanyService).isActive.mockImplementation((companyId: string) =>
    Promise.resolve(!inactiveCompanies.has(companyId)),
  );

  const providers = [...mocks.entries()].map(([token, useValue]) => ({
    provide: token as Type<unknown>,
    useValue,
  }));

  const moduleRef = await Test.createTestingModule({
    imports: [
      PassportModule,
      JwtModule.register({
        secret: JWT_SECRET,
        signOptions: { expiresIn: "1h" },
      }),
      ThrottlerModule.forRoot([{ name: AUTH_THROTTLER, ...LOGIN_LIMIT }]),
    ],
    controllers: CONTROLLERS,
    providers: [
      ...providers,
      { provide: ConfigService, useValue: { get: () => JWT_SECRET } },
      JwtStrategy,
      // A ordem importa: o RolesGuard depende do request.user do JwtAuthGuard.
      { provide: APP_GUARD, useClass: JwtAuthGuard },
      { provide: APP_GUARD, useClass: RolesGuard },
      AppService,
    ],
  }).compile();

  // Sem log do Nest: os erros esperados dos testes só fariam ruído.
  const app = moduleRef.createNestApplication({ logger: false });
  // Mesmos pipes do main.ts.
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      transform: true,
      forbidNonWhitelisted: true,
    }),
  );
  await app.init();

  const jwt = moduleRef.get(JwtService);

  return {
    app,
    server: () => app.getHttpServer() as Parameters<typeof request>[0],
    mockOf,
    tokenFor: (user) => jwt.sign({ sub: user.id, email: user.email }),
    deactivateCompany: (companyId) => inactiveCompanies.add(companyId),
    close: () => app.close(),
  };
}

export interface RouteInfo {
  method: "get" | "post" | "patch" | "put" | "delete";
  /** Caminho com os parâmetros trocados por um UUID. */
  path: string;
  isPublic: boolean;
  roles: UserType[] | undefined;
  label: string;
}

const METHODS: Record<number, RouteInfo["method"]> = {
  [RequestMethod.GET]: "get",
  [RequestMethod.POST]: "post",
  [RequestMethod.PATCH]: "patch",
  [RequestMethod.PUT]: "put",
  [RequestMethod.DELETE]: "delete",
};

// Lê as rotas direto dos decoradores, para que uma rota nova entre sozinha nos testes.
export function discoverRoutes(): RouteInfo[] {
  const routes: RouteInfo[] = [];

  for (const controller of CONTROLLERS) {
    const prefix = Reflect.getMetadata(PATH_METADATA, controller) as string;
    const prototype = controller.prototype as Record<string, unknown>;

    for (const name of Object.getOwnPropertyNames(prototype)) {
      const handler = prototype[name];
      if (typeof handler !== "function" || name === "constructor") continue;

      const requestMethod = Reflect.getMetadata(METHOD_METADATA, handler) as
        number | undefined;
      if (requestMethod === undefined) continue;

      const path = Reflect.getMetadata(PATH_METADATA, handler) as string;
      const targets = [handler, controller];
      const isPublic = targets.some(
        (target) => Reflect.getMetadata(IS_PUBLIC_KEY, target) === true,
      );
      const roles = targets
        .map(
          (target) =>
            Reflect.getMetadata(ROLES_KEY, target as object) as
              UserType[] | undefined,
        )
        .find((value) => value !== undefined);

      const full = `/${[prefix, path === "/" ? "" : path]
        .filter(Boolean)
        .join("/")}`
        .replace(/\/+/g, "/")
        .replace(/:[A-Za-z]+/g, ANY_UUID);

      routes.push({
        method: METHODS[requestMethod],
        path: full,
        isPublic,
        roles,
        label: `${METHODS[requestMethod].toUpperCase()} ${full.replaceAll(ANY_UUID, ":id")} (${controller.name}.${name})`,
      });
    }
  }

  return routes;
}
