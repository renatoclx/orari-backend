import { ServiceUnavailableException } from "@nestjs/common";
import type { ConfigService } from "@nestjs/config";
import { afterEach, describe, expect, it, vi } from "vitest";
import { MailService } from "./mail.service";

const message = {
  to: "ana@exemplo.com",
  subject: "Assunto",
  text: "Texto",
  html: "<p>Texto</p>",
};
const config = (env: Record<string, string | undefined>) =>
  ({ get: (key: string) => env[key] }) as unknown as ConfigService;

describe("MailService", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("sem chave, no ambiente local: só escreve no log (não envia)", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    await new MailService(config({})).send(message);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("sem chave, em produção: recusa (o link nunca vai para o log)", async () => {
    await expect(
      new MailService(config({ NODE_ENV: "production" })).send(message),
    ).rejects.toBeInstanceOf(ServiceUnavailableException);
  });

  it("com chave: envia pelo Resend, com o remetente configurado", async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response("{}"));
    vi.stubGlobal("fetch", fetchMock);
    await new MailService(
      config({ RESEND_API_KEY: "re_teste", MAIL_FROM: "Orari <a@b.com>" }),
    ).send(message);
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("https://api.resend.com/emails");
    expect(init.headers).toMatchObject({ Authorization: "Bearer re_teste" });
    expect(JSON.parse(init.body as string)).toMatchObject({
      from: "Orari <a@b.com>",
      to: ["ana@exemplo.com"],
      subject: "Assunto",
    });
  });

  it("Resend recusou: erro com o motivo", async () => {
    vi.stubGlobal(
      "fetch",
      vi
        .fn()
        .mockResolvedValue(
          new Response("domínio não verificado", { status: 403 }),
        ),
    );
    await expect(
      new MailService(config({ RESEND_API_KEY: "re_teste" })).send(message),
    ).rejects.toThrow(/403/);
  });
});
