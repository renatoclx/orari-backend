import { ServiceUnavailableException } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { describe, expect, it } from "vitest";
import { MessageSenderService } from "./message-sender.service";

const message = {
  companyId: "c1",
  companyName: "Studio Aurora",
  phone: "31988887777",
  code: "123456",
};
const senderIn = (env: string) =>
  new MessageSenderService({ get: () => env } as unknown as ConfigService);

describe("MessageSenderService", () => {
  it("em desenvolvimento, aceita (o código vai para o log)", async () => {
    await expect(
      senderIn("development").sendVerificationCode(message),
    ).resolves.toBeUndefined();
  });

  it("em produção, sem canal configurado, recusa: o código nunca vai para o log", async () => {
    await expect(
      senderIn("production").sendVerificationCode(message),
    ).rejects.toBeInstanceOf(ServiceUnavailableException);
  });
});
