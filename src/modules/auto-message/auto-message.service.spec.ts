import { BadRequestException } from "@nestjs/common";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { PrismaService } from "../../prisma/prisma.service";
import { AUTO_MESSAGE_KINDS } from "./auto-message.catalog";
import { AutoMessageService } from "./auto-message.service";

const COMPANY = "company-1";

describe("AutoMessageService", () => {
  const prismaMock = {
    autoMessage: { findMany: vi.fn(), findUnique: vi.fn(), upsert: vi.fn() },
    $transaction: vi.fn((ops: Promise<unknown>[]) => Promise.all(ops)),
  };
  const service = new AutoMessageService(
    prismaMock as unknown as PrismaService,
  );

  beforeEach(() => {
    vi.clearAllMocks();
    prismaMock.autoMessage.findMany.mockResolvedValue([]);
  });

  it("quem nunca salvou recebe os nove padrões: lembrete, agendamentos e avisos do profissional e do administrador ligados", async () => {
    const all = await service.findAll(COMPANY);
    expect(all.map((item) => item.kind)).toEqual([...AUTO_MESSAGE_KINDS]);
    expect(
      Object.fromEntries(all.map((item) => [item.kind, item.enabled])),
    ).toEqual({
      REMINDER: true,
      APPOINTMENT_CREATED: true,
      APPOINTMENT_RESCHEDULED: true,
      APPOINTMENT_CANCELLED: true,
      BIRTHDAY: false,
      MISS_YOU: false,
      PROFESSIONAL_REMINDER: true,
      PROFESSIONAL_SUMMARY: true,
      ADMIN_SUMMARY: true,
    });
    expect(all[0].reminderOffsets).toEqual([1440, 30]);
    expect(all[5].missYouDays).toBe(30);
  });

  it("o gravado substitui o padrão daquela situação", async () => {
    prismaMock.autoMessage.findMany.mockResolvedValue([
      {
        kind: "BIRTHDAY",
        enabled: true,
        body: "Parabéns, {nome}!",
        reminderOffsets: [],
        missYouDays: null,
      },
    ]);
    const all = await service.findAll(COMPANY);
    expect(all.find((item) => item.kind === "BIRTHDAY")).toMatchObject({
      enabled: true,
      body: "Parabéns, {nome}!",
    });
  });

  describe("replace", () => {
    it("grava cada situação com só a opção dela (tempos do maior para o menor)", async () => {
      await service.replace(COMPANY, {
        items: [
          {
            kind: "REMINDER",
            enabled: true,
            body: "Oi {nome}",
            reminderOffsets: [30, 1440],
            missYouDays: 60,
          },
          {
            kind: "MISS_YOU",
            enabled: true,
            body: "Volte, {nome}",
            reminderOffsets: [30],
            missYouDays: 60,
          },
        ],
      });
      expect(prismaMock.autoMessage.upsert).toHaveBeenCalledWith({
        where: { companyId_kind: { companyId: COMPANY, kind: "REMINDER" } },
        create: {
          companyId: COMPANY,
          kind: "REMINDER",
          enabled: true,
          body: "Oi {nome}",
          reminderOffsets: [1440, 30],
          missYouDays: null,
          // A hora e os itens só existem no resumo do administrador.
          summaryHour: null,
          summaryItems: [],
        },
        update: expect.objectContaining({
          reminderOffsets: [1440, 30],
          missYouDays: null,
        }) as object,
      });
      expect(prismaMock.autoMessage.upsert).toHaveBeenCalledWith(
        expect.objectContaining({
          create: expect.objectContaining({
            kind: "MISS_YOU",
            reminderOffsets: [],
            missYouDays: 60,
          }) as object,
        }),
      );
    });

    it("variável que não existe na situação: 400 com o nome, sem gravar", async () => {
      await expect(
        service.replace(COMPANY, {
          items: [
            { kind: "BIRTHDAY", enabled: true, body: "Oi {nome}, até {data}" },
          ],
        }),
      ).rejects.toThrow("Aniversário: {data} não existe nesta mensagem");
      expect(prismaMock.$transaction).not.toHaveBeenCalled();
    });

    it("lembrete ligado sem tempo: 400; desligado, pode", async () => {
      await expect(
        service.replace(COMPANY, {
          items: [
            {
              kind: "REMINDER",
              enabled: true,
              body: "Oi",
              reminderOffsets: [],
            },
          ],
        }),
      ).rejects.toBeInstanceOf(BadRequestException);
      await expect(
        service.replace(COMPANY, {
          items: [
            {
              kind: "REMINDER",
              enabled: false,
              body: "Oi",
              reminderOffsets: [],
            },
          ],
        }),
      ).resolves.toHaveLength(9);
    });

    it("o lembrete e o resumo do profissional não têm opção: gravam só ligado e texto", async () => {
      await service.replace(COMPANY, {
        items: [
          {
            kind: "PROFESSIONAL_REMINDER",
            enabled: false,
            body: "Atendimento às {hora}.",
            reminderOffsets: [30, 60],
          },
          {
            kind: "PROFESSIONAL_SUMMARY",
            enabled: true,
            body: "Bom dia, {nome}! Hoje: {quantidade}.",
          },
        ],
      });
      const calls = prismaMock.autoMessage.upsert.mock.calls as unknown as [
        {
          create: {
            kind: string;
            reminderOffsets: number[];
            missYouDays: number | null;
          };
        },
      ][];
      for (const [args] of calls) {
        // O tempo (30 min) e a hora (7h30) são fixos: nada de opção gravada.
        expect(args.create.reminderOffsets).toEqual([]);
        expect(args.create.missYouDays).toBeNull();
      }
    });

    it("o texto do profissional não aceita o nome do cliente; o resumo aceita {quantidade}, o lembrete não", async () => {
      await expect(
        service.replace(COMPANY, {
          items: [
            {
              kind: "PROFESSIONAL_REMINDER",
              enabled: true,
              body: "Com {cliente}",
            },
          ],
        }),
      ).rejects.toThrow("{cliente} não existe nesta mensagem");
      await expect(
        service.replace(COMPANY, {
          items: [
            {
              kind: "PROFESSIONAL_REMINDER",
              enabled: true,
              body: "Hoje: {quantidade}",
            },
          ],
        }),
      ).rejects.toThrow("{quantidade} não existe nesta mensagem");
      await expect(
        service.replace(COMPANY, {
          items: [
            {
              kind: "PROFESSIONAL_SUMMARY",
              enabled: true,
              body: "Hoje: {quantidade}, às {hora}",
            },
          ],
        }),
      ).resolves.toHaveLength(9);
    });

    it("o resumo do administrador guarda a hora e os itens; ligado sem item: 400", async () => {
      await service.replace(COMPANY, {
        items: [
          {
            kind: "ADMIN_SUMMARY",
            enabled: true,
            body: "Hoje: {resumo}",
            summaryHour: 9,
            summaryItems: ["PAYABLE_TODAY", "BIRTHDAYS"],
          },
        ],
      });
      const calls = prismaMock.autoMessage.upsert.mock.calls as unknown as [
        {
          create: {
            summaryHour: number | null;
            summaryItems: string[];
            reminderOffsets: number[];
          };
        },
      ][];
      expect(calls.at(-1)?.[0].create).toMatchObject({
        summaryHour: 9,
        summaryItems: ["PAYABLE_TODAY", "BIRTHDAYS"],
        reminderOffsets: [],
      });
      await expect(
        service.replace(COMPANY, {
          items: [
            {
              kind: "ADMIN_SUMMARY",
              enabled: true,
              body: "Hoje: {resumo}",
              summaryItems: [],
            },
          ],
        }),
      ).rejects.toBeInstanceOf(BadRequestException);
      // Desligado, pode ficar sem item.
      await expect(
        service.replace(COMPANY, {
          items: [
            {
              kind: "ADMIN_SUMMARY",
              enabled: false,
              body: "Hoje: {resumo}",
              summaryItems: [],
            },
          ],
        }),
      ).resolves.toHaveLength(9);
    });

    it("as outras situações não guardam hora nem itens do resumo", async () => {
      await service.replace(COMPANY, {
        items: [{ kind: "BIRTHDAY", enabled: true, body: "Parabéns, {nome}!" }],
      });
      const calls = prismaMock.autoMessage.upsert.mock.calls as unknown as [
        { create: { summaryHour: number | null; summaryItems: string[] } },
      ][];
      expect(calls.at(-1)?.[0].create).toMatchObject({
        summaryHour: null,
        summaryItems: [],
      });
    });

    it("a mesma situação duas vezes: 400", async () => {
      await expect(
        service.replace(COMPANY, {
          items: [
            { kind: "BIRTHDAY", enabled: true, body: "a" },
            { kind: "BIRTHDAY", enabled: false, body: "b" },
          ],
        }),
      ).rejects.toThrow("uma vez só");
    });
  });
});
