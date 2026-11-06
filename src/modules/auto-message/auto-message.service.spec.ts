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

  it("quem nunca salvou recebe os seis padrões: lembrete e agendamentos ligados", async () => {
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
      ).resolves.toHaveLength(6);
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
