import { BadRequestException, ConflictException } from "@nestjs/common";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { PrismaService } from "../../prisma/prisma.service";
import type { AutoMessageSender } from "../auto-message/auto-message-sender.service";
import type { ClientNotifierService } from "../portal/client-notifier.service";
import { MessageCampaignService } from "./message-campaign.service";

const COMPANY = {
  id: "c-1",
  name: "Studio Aurora",
  timezone: "America/Sao_Paulo",
};
const dto = {
  title: "Novidade, {nome}!",
  body: "Semana do Pilates no {estabelecimento}.",
};

describe("MessageCampaignService", () => {
  const prismaMock = {
    $transaction: vi.fn((fn: (tx: unknown) => unknown) => fn(prismaMock)),
    $executeRaw: vi.fn(),
    company: { findUniqueOrThrow: vi.fn() },
    people: { count: vi.fn(), findMany: vi.fn() },
    messageCampaign: {
      count: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
      findMany: vi.fn(),
    },
  };
  const senderMock = { sendingCompany: vi.fn() };
  const notifierMock = { notify: vi.fn() };
  const service = new MessageCampaignService(
    prismaMock as unknown as PrismaService,
    senderMock as unknown as AutoMessageSender,
    notifierMock as unknown as ClientNotifierService,
  );

  beforeEach(() => {
    vi.clearAllMocks();
    prismaMock.company.findUniqueOrThrow.mockResolvedValue({
      timezone: COMPANY.timezone,
    });
    senderMock.sendingCompany.mockResolvedValue(COMPANY);
    prismaMock.messageCampaign.count.mockResolvedValue(0);
    prismaMock.messageCampaign.create.mockResolvedValue({ id: "camp-1" });
    prismaMock.messageCampaign.update.mockImplementation(
      ({ data }: { data: object }) => ({ id: "camp-1", ...data }),
    );
    prismaMock.people.findMany.mockResolvedValue([
      { name: "Ana Souza", clientAccountId: "acc-1" },
      { name: "Bia Lima", clientAccountId: "acc-2" },
      { name: "Caio Reis", clientAccountId: "acc-3" },
    ]);
    // Caio desligou as promoções: o aviso não é gravado.
    notifierMock.notify.mockImplementation(
      ({ accountId }: { accountId: string }) =>
        Promise.resolve({ saved: accountId !== "acc-3", devices: 1 }),
    );
  });

  it("envia a cada cliente com o nome dele e grava quantos receberam", async () => {
    await expect(service.send("c-1", "user-1", dto)).resolves.toMatchObject({
      recipients: 2,
    });
    expect(prismaMock.messageCampaign.create).toHaveBeenCalledWith({
      data: {
        companyId: "c-1",
        createdById: "user-1",
        title: dto.title,
        body: dto.body,
      },
    });
    expect(notifierMock.notify).toHaveBeenCalledWith({
      accountId: "acc-1",
      companyId: "c-1",
      kind: "CAMPAIGN",
      title: "Novidade, Ana!",
      body: "Semana do Pilates no Studio Aurora.",
    });
    expect(prismaMock.people.findMany).toHaveBeenCalledWith({
      where: {
        companyId: "c-1",
        type: "CLIENT",
        deletedAt: null,
        clientAccountId: { not: null },
      },
      select: { name: true, clientAccountId: true },
    });
  });

  it("trava por clínica antes de conferir o dia (dois cliques ao mesmo tempo)", async () => {
    await service.send("c-1", "user-1", dto);
    const lock = (
      prismaMock.$executeRaw.mock.calls[0][0] as TemplateStringsArray
    ).join("?");
    expect(lock).toContain("pg_advisory_xact_lock");
  });

  it("segunda do dia (no relógio da clínica): 409, sem enviar", async () => {
    prismaMock.messageCampaign.count.mockResolvedValue(1);
    await expect(service.send("c-1", "user-1", dto)).rejects.toBeInstanceOf(
      ConflictException,
    );
    expect(notifierMock.notify).not.toHaveBeenCalled();
  });

  it("variável que não existe (também no título): 400", async () => {
    await expect(
      service.send("c-1", "user-1", {
        title: "Oi {data}",
        body: "{nome} {servico}",
      }),
    ).rejects.toThrow("{data}, {servico} não existe nesta mensagem");
    await expect(
      service.send("c-1", "user-1", { title: "Oi", body: "{cpf}" }),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(prismaMock.messageCampaign.create).not.toHaveBeenCalled();
  });

  it("portal desligado (ou sem o plano): 409, sem registrar", async () => {
    senderMock.sendingCompany.mockResolvedValue(null);
    await expect(service.send("c-1", "user-1", dto)).rejects.toThrow(
      "portal do cliente está desligado",
    );
    expect(prismaMock.messageCampaign.create).not.toHaveBeenCalled();
  });

  it("audience: com o app, quantos desligaram as promoções e se ainda pode enviar hoje", async () => {
    prismaMock.people.count.mockResolvedValueOnce(12).mockResolvedValueOnce(3);
    await expect(service.audience("c-1")).resolves.toEqual({
      clients: 12,
      promotionsOff: 3,
      canSendToday: true,
    });
  });
});
