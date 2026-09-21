import "dotenv/config";
import { randomBytes } from "node:crypto";
import { NestFactory } from "@nestjs/core";
import { AppModule } from "../app.module";
import { AuthenticatedUser } from "../common/interfaces/authenticated-user.interface";
import { zonedToUtc } from "../common/time/time-zone";
import { PrismaService } from "../prisma/prisma.service";
import { AddressService } from "../modules/address/address.service";
import { AppointmentService } from "../modules/appointment/appointment.service";
import { BusinessHourService } from "../modules/business-hour/business-hour.service";
import { CityService } from "../modules/city/city.service";
import { CompanyService } from "../modules/company/company.service";
import { ContactService } from "../modules/contact/contact.service";
import { PaymentService } from "../modules/payment/payment.service";
import { PaymentMethodService } from "../modules/payment-method/payment-method.service";
import { PeopleService } from "../modules/people/people.service";
import { RecurringAppointmentService } from "../modules/recurring-appointment/recurring-appointment.service";
import { ServiceService } from "../modules/service/service.service";
import { UserService } from "../modules/user/user.service";

/**
 * Cria um cadastro completo de demonstração, para inspecionar o banco com dados
 * realistas: empresa, usuários, pessoas, contatos, endereços, serviços, horários
 * de funcionamento, um agendamento avulso, um agendamento recorrente (com os
 * agendamentos que ele gera) e pagamentos.
 *
 * Os dados são criados pelos próprios services da aplicação — e não por SQL —
 * para respeitarem todas as regras (tipos de pessoa, janela de atendimento,
 * conflito de horário, geração da recorrência).
 *
 * É idempotente: se a empresa de demonstração já existir, nada é recriado.
 */
const DEMO = {
  company: {
    corporateReason: "Orari Demonstração LTDA",
    fantasyName: "Orari Demo",
    cnpj: "11222333000181",
    subdomain: "demo",
    foundationDate: new Date("2024-03-10"),
    timezone: "America/Sao_Paulo",
  },
  adminEmail: "admin.demo@orari.local",
};

const TIME_ZONE = DEMO.company.timezone;

// Próximo dia útil (segunda a sexta) no relógio da empresa, em um horário dado.
function nextWeekdayAt(hours: number, minutes = 0): Date {
  const now = new Date();
  for (let ahead = 1; ahead <= 7; ahead += 1) {
    const day = new Date(now);
    day.setUTCDate(day.getUTCDate() + ahead);

    const weekDay = day.getUTCDay();
    if (weekDay === 0 || weekDay === 6) {
      continue;
    }

    return zonedToUtc(
      {
        year: day.getUTCFullYear(),
        month: day.getUTCMonth() + 1,
        day: day.getUTCDate(),
        hours,
        minutes,
      },
      TIME_ZONE,
    );
  }

  throw new Error("Não foi possível encontrar um dia útil");
}

async function main() {
  const app = await NestFactory.createApplicationContext(AppModule, {
    logger: ["error"],
  });

  const prisma = app.get(PrismaService);
  const companies = app.get(CompanyService);
  const users = app.get(UserService);
  const people = app.get(PeopleService);
  const contacts = app.get(ContactService);
  const addresses = app.get(AddressService);
  const cities = app.get(CityService);
  const services = app.get(ServiceService);
  const businessHours = app.get(BusinessHourService);
  const appointments = app.get(AppointmentService);
  const recurring = app.get(RecurringAppointmentService);
  const paymentMethods = app.get(PaymentMethodService);
  const payments = app.get(PaymentService);

  const existing = await prisma.company.findUnique({
    where: { cnpj: DEMO.company.cnpj },
  });
  if (existing) {
    console.log(
      `Demonstração já cadastrada (empresa ${existing.id}). Nada foi criado.`,
    );
    await app.close();
    return;
  }

  // O SUPER_ADMIN do seed é quem cadastra empresas e o primeiro usuário delas.
  const superAdmin = await prisma.user.findFirst({
    where: { type: "SUPER_ADMIN", deletedAt: null },
  });
  if (!superAdmin) {
    throw new Error(
      "Nenhum SUPER_ADMIN encontrado. Rode antes: npm run prisma:seed",
    );
  }
  const platformUser: AuthenticatedUser = {
    id: superAdmin.id,
    email: superAdmin.email,
    type: "SUPER_ADMIN",
    companyId: superAdmin.companyId,
  };

  const company = await companies.create(DEMO.company);

  const adminPassword = randomBytes(9).toString("base64url");
  const admin = await users.create(
    {
      name: "Administrador da Demonstração",
      email: DEMO.adminEmail,
      password: adminPassword,
      passwordConfirmation: adminPassword,
      type: "ADMIN",
      companyId: company.id,
    },
    platformUser,
  );

  // Daqui em diante tudo acontece no escopo da empresa de demonstração.
  const companyId = company.id;

  const [beloHorizonte] = (
    await cities.findAll({ page: 1, limit: 1, name: "Belo Horizonte" })
  ).items;

  await contacts.create(
    {
      type: "MAIN",
      phone: "3133334444",
      email: "contato@demo.orari",
      companyId,
    },
    companyId,
  );
  await addresses.create(
    {
      type: "MAIN",
      cep: "30130000",
      publicPlace: "Avenida Afonso Pena",
      number: "1000",
      complement: "Sala 302",
      cityId: beloHorizonte.id,
      companyId,
    },
    companyId,
  );

  const clientOne = await people.create(
    {
      name: "Ana Paula Souza",
      document: "52998224725",
      birthDate: new Date("1990-04-12"),
      type: "CLIENT",
    },
    companyId,
  );
  const clientTwo = await people.create(
    {
      name: "Bruno Carvalho",
      document: "11144477735",
      birthDate: new Date("1986-11-02"),
      type: "CLIENT",
    },
    companyId,
  );
  const professionalOne = await people.create(
    {
      name: "Carla Menezes",
      document: "12345678909",
      birthDate: new Date("1982-07-30"),
      profession: "Fisioterapeuta",
      type: "PROFESSIONAL",
    },
    companyId,
  );
  const professionalTwo = await people.create(
    {
      name: "Diego Ramalho",
      document: "39053344705",
      birthDate: new Date("1979-01-25"),
      profession: "Massoterapeuta",
      type: "PROFESSIONAL",
    },
    companyId,
  );
  await people.create(
    {
      name: "Elaine Rocha",
      document: "16899539772",
      birthDate: new Date("1995-09-18"),
      profession: "Recepcionista",
      type: "EMPLOYEE",
    },
    companyId,
  );

  // Contato e endereço de uma pessoa, para exercitar o dono alternativo.
  await contacts.create(
    { type: "MAIN", phone: "31988887777", peopleId: clientOne.id },
    companyId,
  );
  await addresses.create(
    {
      type: "MAIN",
      cep: "30140071",
      publicPlace: "Rua da Bahia",
      number: "500",
      cityId: beloHorizonte.id,
      peopleId: clientOne.id,
    },
    companyId,
  );

  const fisioterapia = await services.create(
    {
      name: "Sessão de fisioterapia",
      description: "Atendimento individual de 1 hora",
      price: 180,
      duration: 60,
    },
    companyId,
  );
  const massagem = await services.create(
    { name: "Massagem relaxante", price: 150, duration: 60 },
    companyId,
  );

  // Segunda a sexta em dois turnos; sábado só de manhã.
  const weekDays = [
    "MONDAY",
    "TUESDAY",
    "WEDNESDAY",
    "THURSDAY",
    "FRIDAY",
  ] as const;
  for (const weekDay of weekDays) {
    await businessHours.create(
      { weekDay, openAt: "09:00", closeAt: "12:00" },
      companyId,
    );
    await businessHours.create(
      { weekDay, openAt: "13:00", closeAt: "18:00" },
      companyId,
    );
  }
  await businessHours.create(
    { weekDay: "SATURDAY", openAt: "09:00", closeAt: "13:00" },
    companyId,
  );

  const pix = await paymentMethods.create({ name: "PIX" }, companyId);
  await paymentMethods.create({ name: "Cartão de crédito" }, companyId);

  // Agendamento avulso: próximo dia útil às 10h, dentro da janela da manhã.
  const standard = await appointments.create(
    {
      clientId: clientOne.id,
      professionalId: professionalOne.id,
      serviceId: fisioterapia.id,
      startAt: nextWeekdayAt(10),
      note: "Primeira avaliação",
    },
    companyId,
  );
  await payments.create(
    {
      appointmentId: standard.id,
      paymentMethodId: pix.id,
      status: "PAID",
      paidAt: new Date(),
    },
    companyId,
  );

  // Recorrente: terças e quintas às 14h, sem data final — gera 90 dias de agenda.
  const recurringAppointment = await recurring.create(
    {
      clientId: clientTwo.id,
      professionalId: professionalTwo.id,
      serviceId: massagem.id,
      startDate: new Date(),
      note: "Pacote semanal",
      days: [
        { weekDay: "TUESDAY", startTime: "14:00", endTime: "15:00" },
        { weekDay: "THURSDAY", startTime: "14:00", endTime: "15:00" },
      ],
    },
    companyId,
  );

  // Pagamento pendente no primeiro atendimento gerado; o valor vem do serviço.
  const [firstGenerated] = (
    await appointments.findAll({ page: 1, limit: 100 }, companyId)
  ).items.filter(
    (appointment) =>
      appointment.recurringAppointmentId === recurringAppointment.id,
  );
  if (firstGenerated) {
    await payments.create(
      { appointmentId: firstGenerated.id, paymentMethodId: pix.id },
      companyId,
    );
  }

  const generated = await prisma.appointment.count({
    where: { recurringAppointmentId: recurringAppointment.id },
  });

  console.log("Demonstração criada:");
  console.table({
    empresa: `${company.corporateReason} (${company.id})`,
    fuso: company.timezone,
    admin: `${admin.email} / senha: ${adminPassword}`,
    pessoas: await prisma.people.count({ where: { companyId } }),
    servicos: await prisma.service.count({ where: { companyId } }),
    janelas: await prisma.businessHour.count({ where: { companyId } }),
    agendamentoAvulso: standard.id,
    agendamentoRecorrente: recurringAppointment.id,
    agendamentosGerados: generated,
    pagamentos: await prisma.payment.count({
      where: { appointment: { companyId } },
    }),
  });

  await app.close();
}

main().catch((error: unknown) => {
  console.error(error);
  process.exitCode = 1;
});
