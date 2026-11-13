import { beforeEach, describe, expect, it, vi } from "vitest";
import type { PrismaService } from "../../prisma/prisma.service";
import type { NotificationDispatcher } from "./notification-dispatcher.service";
import { WelcomeListener } from "./welcome.listener";

describe("WelcomeListener", () => {
  const prismaMock = {
    user: { updateMany: vi.fn(), findUnique: vi.fn() },
  };
  const dispatcherMock = { notify: vi.fn() };
  const listener = new WelcomeListener(
    prismaMock as unknown as PrismaService,
    dispatcherMock as unknown as NotificationDispatcher,
  );

  beforeEach(() => {
    vi.clearAllMocks();
    prismaMock.user.updateMany.mockResolvedValue({ count: 1 });
    prismaMock.user.findUnique.mockResolvedValue({
      companyId: "company-1",
      type: "ADMIN",
    });
    dispatcherMock.notify.mockResolvedValue(1);
  });

  it("primeiro acesso do ADMIN: marca de forma atômica e manda as boas-vindas, que abrem os primeiros passos", async () => {
    await listener.onLoggedIn({ userId: "user-1" });

    expect(prismaMock.user.updateMany).toHaveBeenCalledWith({
      where: { id: "user-1", welcomedAt: null, deletedAt: null },
      data: { welcomedAt: expect.any(Date) as Date },
    });
    expect(dispatcherMock.notify).toHaveBeenCalledWith(
      expect.objectContaining({
        companyId: "company-1",
        userIds: ["user-1"],
        category: "WELCOME",
        title: "Boas-vindas ao Orari!",
        url: "/dashboard?passos=1",
        dedupeKey: "welcome",
      }),
    );
  });

  it("o profissional é levado a Menu → Avisos no celular", async () => {
    prismaMock.user.findUnique.mockResolvedValue({
      companyId: "company-1",
      type: "PROFESSIONAL",
    });
    await listener.onLoggedIn({ userId: "pro-1" });
    expect(dispatcherMock.notify).toHaveBeenCalledWith(
      expect.objectContaining({ url: "/app/menu/notificacoes" }),
    );
  });

  it("o push é só o convite, sem números nem nomes", async () => {
    await listener.onLoggedIn({ userId: "user-1" });
    const [[call]] = dispatcherMock.notify.mock.calls as [
      { push: { body: string } },
    ][];
    expect(call.push.body).toBe("Toque para conhecer o Orari.");
  });

  it("quem já foi recebido (ou entrou em outro aparelho ao mesmo tempo) não recebe de novo", async () => {
    prismaMock.user.updateMany.mockResolvedValue({ count: 0 });
    await listener.onLoggedIn({ userId: "user-1" });
    expect(dispatcherMock.notify).not.toHaveBeenCalled();
  });

  it("o SUPER_ADMIN não tem boas-vindas", async () => {
    prismaMock.user.findUnique.mockResolvedValue({
      companyId: "company-1",
      type: "SUPER_ADMIN",
    });
    await listener.onLoggedIn({ userId: "super-1" });
    expect(dispatcherMock.notify).not.toHaveBeenCalled();
  });

  it("falha ao enviar não vaza (quem entrou não espera nem vê)", async () => {
    dispatcherMock.notify.mockRejectedValue(new Error("banco"));
    await expect(
      listener.onLoggedIn({ userId: "user-1" }),
    ).resolves.toBeUndefined();
  });
});
