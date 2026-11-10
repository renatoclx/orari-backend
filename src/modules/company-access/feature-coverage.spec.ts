import "reflect-metadata";
import { describe, expect, it } from "vitest";
import {
  FEATURE_BY_PERSON_TYPE_KEY,
  FEATURE_KEY,
} from "../../common/decorators/feature.decorator";
import { AddressController } from "../address/address.controller";
import { AnamnesisController } from "../anamnesis/anamnesis.controller";
import { AnamnesisTemplateController } from "../anamnesis/anamnesis-template.controller";
import { AppointmentController } from "../appointment/appointment.controller";
import { AuditController } from "../audit/audit.controller";
import { AutoMessageController } from "../auto-message/auto-message.controller";
import { MessageCampaignController } from "../message-campaign/message-campaign.controller";
import { ClientPortfolioController } from "../client-portfolio/client-portfolio.controller";
import { ReceivablesController } from "../receivables/receivables.controller";
import { AppointmentReportController } from "../appointment-report/appointment-report.controller";
import { RankingsController } from "../rankings/rankings.controller";
import { FinancialReportController } from "../financial-report/financial-report.controller";
import { PackagesReportController } from "../packages-report/packages-report.controller";
import { ClientsReportController } from "../clients-report/clients-report.controller";
import { CommissionController } from "../commission/commission.controller";
import { CommissionAdvanceController } from "../commission/commission-advance.controller";
import { CommissionClosingController } from "../commission/commission-closing.controller";
import { ExpenseCategoryController } from "../expense-category/expense-category.controller";
import { PayableController } from "../payable/payable.controller";
import { AgendaBlockController } from "../agenda-block/agenda-block.controller";
import { AuthController } from "../auth/auth.controller";
import { BusinessHourController } from "../business-hour/business-hour.controller";
import { CityController } from "../city/city.controller";
import { ClassGroupController } from "../class-group/class-group.controller";
import { ClassSessionController } from "../class-group/class-session.controller";
import { ClientPlanController } from "../client-plan/client-plan.controller";
import { CompanyAccessController } from "./company-access.controller";
import { CompanyController } from "../company/company.controller";
import { ContactController } from "../contact/contact.controller";
import { NotificationController } from "../notification/notification.controller";
import { PaymentController } from "../payment/payment.controller";
import { PaymentMethodController } from "../payment-method/payment-method.controller";
import { PeopleController } from "../people/people.controller";
import { PlanController } from "../plan/plan.controller";
import {
  PortalAccessLinkController,
  PortalAccessUseController,
  PortalClientConfirmController,
} from "../portal/portal-access.controller";
import { PortalAccountController } from "../portal/portal-account.controller";
import { PortalAppointmentController } from "../portal/portal-appointment.controller";
import { PortalCatalogController } from "../portal/portal-catalog.controller";
import { PortalDirectoryController } from "../portal/portal-directory.controller";
import { PortalPushController } from "../portal/portal-push.controller";
import { PortalSettingsController } from "../portal/portal-settings.controller";
import { RecurringAppointmentController } from "../recurring-appointment/recurring-appointment.controller";
import { ServiceController } from "../service/service.controller";
import { StateController } from "../state/state.controller";
import { UserController } from "../user/user.controller";

type Controller = new (...args: never[]) => unknown;

// Toda rota precisa de @Feature (ou do tipo da pessoa) OU estar nesta lista de
// isenções: assim, uma rota nova sem barreira falha aqui em vez de passar
// despercebida. Cada isenção tem o motivo.
const EXEMPT: Record<string, string> = {
  AuthController: "login, refresh e /me: valem para qualquer usuário",
  CompanyAccessController: "só o SUPER_ADMIN (@Roles)",
  PortalAccountController:
    "conta do cliente no app: fora do login da clínica, com autenticação própria (PortalAuthGuard)",
  PortalAccessUseController:
    "uso do link de acesso pelo cliente (fora do login da clínica)",
  PortalAppointmentController:
    "agendamentos do cliente no portal (PortalAuthGuard, token do portal)",
  PortalCatalogController:
    "vitrine pública do portal (só abre com o portal ligado e no plano)",
  PortalDirectoryController:
    "busca pública de estabelecimentos (só os de portal ligado, no plano e que escolheram aparecer)",
  PortalPushController:
    "avisos do app e caixa de Avisos do cliente (PortalAuthGuard, token do portal)",
  CityController: "dado de referência (cidades)",
  StateController: "dado de referência (estados)",
  NotificationController: "ainda sem uso (ver technical-debt.md)",
  AddressController:
    "endereços de pessoas e da empresa: escopo da empresa (ver technical-debt.md)",
  ContactController:
    "contatos de pessoas e da empresa: escopo da empresa (ver technical-debt.md)",
  // Rotas isentas dentro de um controller parcialmente barrado: "Controller.metodo".
  "BusinessHourController.findAll": "a agenda lê o horário de funcionamento",
  "BusinessHourController.findOne": "a agenda lê o horário de funcionamento",
  "CompanyController.create": "só o SUPER_ADMIN (@Roles)",
  "CompanyController.findAll": "o layout lê a própria empresa",
  "CompanyController.findOne": "o layout lê a própria empresa",
  "CompanyController.update": "só o SUPER_ADMIN (@Roles)",
};

const CONTROLLERS: Controller[] = [
  AddressController,
  AnamnesisController,
  AnamnesisTemplateController,
  AppointmentController,
  AuditController,
  AutoMessageController,
  MessageCampaignController,
  ClientPortfolioController,
  ReceivablesController,
  AppointmentReportController,
  RankingsController,
  FinancialReportController,
  PackagesReportController,
  ClientsReportController,
  CommissionController,
  CommissionAdvanceController,
  CommissionClosingController,
  ExpenseCategoryController,
  PayableController,
  AgendaBlockController,
  AuthController,
  BusinessHourController,
  CityController,
  ClassGroupController,
  ClassSessionController,
  ClientPlanController,
  CompanyAccessController,
  CompanyController,
  ContactController,
  NotificationController,
  PaymentController,
  PaymentMethodController,
  PeopleController,
  PortalAccountController,
  PortalAppointmentController,
  PortalAccessLinkController,
  PortalAccessUseController,
  PortalClientConfirmController,
  PortalCatalogController,
  PortalDirectoryController,
  PortalPushController,
  PortalSettingsController,
  PlanController,
  RecurringAppointmentController,
  ServiceController,
  StateController,
  UserController,
];

// Métodos do controller que são rotas HTTP (têm o metadado "method" do Nest).
function routesOf(controller: Controller): string[] {
  return Object.getOwnPropertyNames(controller.prototype).filter(
    (name) =>
      name !== "constructor" &&
      Reflect.getMetadata(
        "method",
        (controller.prototype as Record<string, object>)[name],
      ) !== undefined,
  );
}

function isGuarded(controller: Controller, route: string): boolean {
  const handler = (controller.prototype as Record<string, object>)[route];
  return [FEATURE_KEY, FEATURE_BY_PERSON_TYPE_KEY].some(
    (key) =>
      Reflect.getMetadata(key, handler) !== undefined ||
      Reflect.getMetadata(key, controller) !== undefined,
  );
}

describe("cobertura da barreira por funcionalidade", () => {
  it("toda rota tem @Feature ou é uma isenção declarada", () => {
    const unguarded: string[] = [];
    for (const controller of CONTROLLERS) {
      const name = controller.name;
      for (const route of routesOf(controller)) {
        if (isGuarded(controller, route)) continue;
        if (EXEMPT[name] || EXEMPT[`${name}.${route}`]) continue;
        unguarded.push(`${name}.${route}`);
      }
    }
    expect(unguarded).toEqual([]);
  });

  it("as isenções por rota apontam para rotas que existem", () => {
    const known = new Set(
      CONTROLLERS.flatMap((c) => routesOf(c).map((r) => `${c.name}.${r}`)),
    );
    const stale = Object.keys(EXEMPT).filter(
      (key) =>
        key.includes(".") &&
        key !== "AppController.getHello" &&
        !known.has(key),
    );
    expect(stale).toEqual([]);
  });
});
