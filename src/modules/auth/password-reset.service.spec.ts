import { createHash } from "node:crypto";
import { BadRequestException } from "@nestjs/common";
import type { ConfigService } from "@nestjs/config";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { PrismaService } from "../../prisma/prisma.service";
import type { AuditService } from "../audit/audit.service";
import type { MailService } from "../mail/mail.service";
import type { UserService } from "../user/user.service";
import { PasswordResetService } from "./password-reset.service";

const NOW = new Date("2026-11-23T15:00:00Z");
const sha = (value: string) => createHash("sha256").update(value).digest("hex");

describe("PasswordResetService", () => {
  const tx = {
    passwordResetToken: { updateMany: vi.fn() },
  };
  const prisma = {
    user: { findFirst: vi.fn() },
    passwordResetToken: {
      findFirst: vi.fn(),
      findUnique: vi.fn(),
      create: vi.fn(),
    },
    $transaction: vi.fn((callback: (client: typeof tx) => unknown) =>
      callback(tx),
    ),
  };
  const mail = { send: vi.fn() };
  const users = { replacePassword: vi.fn() };
  const audit = { record: vi.fn() };
  const env: Record<string, string | undefined> = {};
  let service: PasswordResetService;

  beforeEach(() => {
    vi.clearAllMocks();
    delete env.APP_DOMAIN;
    prisma.user.findFirst.mockResolvedValue({
      id: "u1",
      name: "Marina Alves",
      email: "marina@aurora.com",
    });
    prisma.passwordResetToken.findFirst.mockResolvedValue(null);
    tx.passwordResetToken.updateMany.mockResolvedValue({ count: 1 });
    service = new PasswordResetService(
      prisma as unknown as PrismaService,
      users as unknown as UserService,
      mail as unknown as MailService,
      audit as unknown as AuditService,
      { get: (key: string) => env[key] } as unknown as ConfigService,
    );
  });

  describe("request", () => {
    it("guarda só o hash do token e manda o link de 1 hora por e-mail", async () => {
      env.APP_DOMAIN = "app.orariapp.com.br";
      await service.request("Marina@Aurora.com ", NOW);

      const data = (
        prisma.passwordResetToken.create.mock.calls[0] as [
          { data: { tokenHash: string; expiresAt: Date } },
        ]
      )[0].data;
      expect(data.expiresAt).toEqual(new Date("2026-11-23T16:00:00Z"));

      const sent = (
        mail.send.mock.calls[0] as [{ to: string; text: string }]
      )[0];
      expect(sent.to).toBe("marina@aurora.com");
      const token = /token=([\w-]+)/.exec(sent.text)![1];
      expect(sent.text).toContain(
        `https://app.orariapp.com.br/redefinir-senha?token=${token}`,
      );
      // O banco não tem o token, só o hash dele.
      expect(data.tokenHash).toBe(sha(token));
      expect(data.tokenHash).not.toContain(token);
    });

    it("e-mail sem conta: não faz nada (e não avisa quem pediu)", async () => {
      prisma.user.findFirst.mockResolvedValue(null);
      await expect(service.request("x@y.com", NOW)).resolves.toBeUndefined();
      expect(prisma.passwordResetToken.create).not.toHaveBeenCalled();
      expect(mail.send).not.toHaveBeenCalled();
    });

    it("pedido repetido em menos de 1 minuto: não manda outro link", async () => {
      prisma.passwordResetToken.findFirst.mockResolvedValue({ id: "t0" });
      await service.request("marina@aurora.com", NOW);
      expect(mail.send).not.toHaveBeenCalled();
    });

    it("falha no envio não vira erro para quem pediu", async () => {
      mail.send.mockRejectedValueOnce(new Error("Resend fora do ar"));
      await expect(
        service.request("marina@aurora.com", NOW),
      ).resolves.toBeUndefined();
    });

    it("no ambiente local, o link aponta para o Next na porta 3000", async () => {
      await service.request("marina@aurora.com", NOW);
      const sent = (mail.send.mock.calls[0] as [{ text: string }])[0];
      expect(sent.text).toContain(
        "http://localhost:3000/redefinir-senha?token=",
      );
    });
  });

  describe("reset", () => {
    const link = (extra: Record<string, unknown> = {}) => ({
      id: "t1",
      usedAt: null,
      expiresAt: new Date("2026-11-23T15:30:00Z"),
      user: { id: "u1", type: "ADMIN", companyId: "c1", deletedAt: null },
      ...extra,
    });

    it("troca a senha, marca os links como usados e registra a auditoria", async () => {
      prisma.passwordResetToken.findUnique.mockResolvedValue(link());
      const result = await service.reset("abc", "NovaSenha#1", "1.1.1.1", NOW);

      expect(prisma.passwordResetToken.findUnique).toHaveBeenCalledWith(
        expect.objectContaining({ where: { tokenHash: sha("abc") } }),
      );
      expect(users.replacePassword).toHaveBeenCalledWith(
        "u1",
        "NovaSenha#1",
        tx,
      );
      expect(tx.passwordResetToken.updateMany).toHaveBeenCalledWith({
        where: { userId: "u1", usedAt: null },
        data: { usedAt: NOW },
      });
      expect(audit.record).toHaveBeenCalledWith(
        expect.objectContaining({ action: "PASSWORD_RESET_COMPLETED" }),
        tx,
      );
      expect(result).toEqual({ professional: false });
    });

    it("profissional: avisa para entrar pelo app", async () => {
      prisma.passwordResetToken.findUnique.mockResolvedValue(
        link({
          user: {
            id: "u1",
            type: "PROFESSIONAL",
            companyId: "c1",
            deletedAt: null,
          },
        }),
      );
      await expect(
        service.reset("abc", "NovaSenha#1", undefined, NOW),
      ).resolves.toEqual({
        professional: true,
      });
    });

    it("link desconhecido, já usado, vencido ou de usuário excluído: 400", async () => {
      for (const found of [
        null,
        link({ usedAt: new Date() }),
        link({ expiresAt: new Date("2026-11-23T14:59:00Z") }),
        link({
          user: {
            id: "u1",
            type: "ADMIN",
            companyId: "c1",
            deletedAt: new Date(),
          },
        }),
      ]) {
        prisma.passwordResetToken.findUnique.mockResolvedValueOnce(found);
        await expect(
          service.reset("abc", "NovaSenha#1", undefined, NOW),
        ).rejects.toBeInstanceOf(BadRequestException);
      }
      expect(users.replacePassword).not.toHaveBeenCalled();
    });

    it("dois pedidos juntos com o mesmo link: só o primeiro troca", async () => {
      prisma.passwordResetToken.findUnique.mockResolvedValue(link());
      tx.passwordResetToken.updateMany.mockResolvedValueOnce({ count: 0 });
      await expect(
        service.reset("abc", "NovaSenha#1", undefined, NOW),
      ).rejects.toBeInstanceOf(BadRequestException);
      expect(users.replacePassword).not.toHaveBeenCalled();
    });
  });
});
