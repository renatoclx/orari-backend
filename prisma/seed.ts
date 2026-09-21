import "dotenv/config";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { PrismaPg } from "@prisma/adapter-pg";
import * as bcrypt from "bcrypt";
import { PrismaClient } from "../generated/prisma/client";
import { normalizeForSearch } from "../src/common/text/normalize-for-search";
import { isValidCnpj } from "../src/common/validators/document.validator";

interface StateSeed {
  acronym: string;
  name: string;
  cities: string[];
}

const SUPER_ADMIN_SEED_VARIABLES = [
  "SEED_COMPANY_CORPORATE_REASON",
  "SEED_COMPANY_CNPJ",
  "SEED_COMPANY_SUBDOMAIN",
  "SEED_COMPANY_FOUNDATION_DATE",
  "SEED_SUPER_ADMIN_NAME",
  "SEED_SUPER_ADMIN_EMAIL",
  "SEED_SUPER_ADMIN_PASSWORD",
] as const;

// Mesmo custo usado pelo UserService.
const PASSWORD_SALT_ROUNDS = 10;

const prisma = new PrismaClient({
  adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL }),
});

async function seedStatesAndCities() {
  // Snapshot da API de localidades do IBGE, versionado para o seed não depender de rede.
  const states = JSON.parse(
    readFileSync(join(__dirname, "seed-data", "states-cities.json"), "utf-8"),
  ) as StateSeed[];

  for (const { acronym, name, cities } of states) {
    const state = await prisma.state.upsert({
      where: { acronym },
      update: {},
      create: { acronym, name },
    });

    // skipDuplicates mantém o seed idempotente (unique em name + stateId).
    await prisma.city.createMany({
      data: cities.map((cityName) => ({
        name: cityName,
        normalizedName: normalizeForSearch(cityName),
        stateId: state.id,
      })),
      skipDuplicates: true,
    });
  }

  const [stateCount, cityCount] = await Promise.all([
    prisma.state.count(),
    prisma.city.count(),
  ]);
  console.log(
    `Estados e cidades: ${stateCount} estados, ${cityCount} cidades.`,
  );
}

/**
 * Cria a empresa da plataforma e o SUPER_ADMIN inicial. Sem ele não há como
 * acessar a API: todas as rotas exigem autenticação e só o SUPER_ADMIN cadastra
 * empresas e seus primeiros usuários.
 *
 * O seed apenas cria o que falta e nunca altera registros existentes; assim,
 * reexecutá-lo não sobrescreve a senha do SUPER_ADMIN.
 */
async function seedSuperAdmin() {
  const missing = SUPER_ADMIN_SEED_VARIABLES.filter((key) => !process.env[key]);
  if (missing.length > 0) {
    console.log(
      `SUPER_ADMIN: ignorado, variáveis ausentes: ${missing.join(", ")}.`,
    );
    return;
  }

  const env = process.env as Record<
    (typeof SUPER_ADMIN_SEED_VARIABLES)[number],
    string
  >;
  const cnpj = env.SEED_COMPANY_CNPJ.toUpperCase();
  const password = env.SEED_SUPER_ADMIN_PASSWORD;

  // O seed grava direto no banco, sem passar pelos DTOs: aplica aqui as mesmas regras.
  if (!isValidCnpj(cnpj)) {
    throw new Error("SEED_COMPANY_CNPJ não é um CNPJ válido (sem máscara).");
  }
  if (password.length < 8 || password.length > 72) {
    throw new Error("SEED_SUPER_ADMIN_PASSWORD deve ter de 8 a 72 caracteres.");
  }

  const company =
    (await prisma.company.findUnique({ where: { cnpj } })) ??
    (await prisma.company.create({
      data: {
        corporateReason: env.SEED_COMPANY_CORPORATE_REASON,
        cnpj,
        subdomain: env.SEED_COMPANY_SUBDOMAIN,
        foundationDate: new Date(env.SEED_COMPANY_FOUNDATION_DATE),
      },
    }));

  // Busca + criação em vez de upsert: o unique do e-mail é um índice parcial
  // (deletedAt IS NULL), que o ON CONFLICT do upsert nativo não reconhece.
  const superAdmin =
    (await prisma.user.findFirst({
      where: { email: env.SEED_SUPER_ADMIN_EMAIL, deletedAt: null },
    })) ??
    (await prisma.user.create({
      data: {
        name: env.SEED_SUPER_ADMIN_NAME,
        email: env.SEED_SUPER_ADMIN_EMAIL,
        password: await bcrypt.hash(password, PASSWORD_SALT_ROUNDS),
        type: "SUPER_ADMIN",
        companyId: company.id,
      },
    }));

  console.log(
    `SUPER_ADMIN: ${superAdmin.email} (empresa ${company.corporateReason}).`,
  );
}

async function main() {
  await seedStatesAndCities();
  await seedSuperAdmin();
}

main()
  .catch((error: unknown) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
