import type { ConfigService } from "@nestjs/config";
import { beforeEach, describe, expect, it, vi } from "vitest";
import webpush, { WebPushError } from "web-push";
import {
  isPushServiceEndpoint,
  PushSenderService,
} from "./push-sender.service";

// Nada sai para a internet: o envio do web-push é simulado.
vi.mock("web-push", async (importOriginal) => {
  const original = await importOriginal<typeof import("web-push")>();
  const sendNotification = vi.fn();
  return {
    ...original,
    default: { ...original, sendNotification },
    sendNotification,
  };
});

const VAPID = {
  VAPID_PUBLIC_KEY: "chave-publica",
  VAPID_PRIVATE_KEY: "chave-privada",
  VAPID_SUBJECT: "mailto:contato@orariapp.com.br",
};
const configWith = (values: Record<string, string>) =>
  ({ get: (name: string) => values[name] }) as unknown as ConfigService;

const target = {
  endpoint: "https://fcm.googleapis.com/fcm/send/abc",
  p256dh: "p",
  auth: "a",
};
const payload = { title: "Orari", body: "Oi", url: "/app/menu/avisos" };

describe("isPushServiceEndpoint", () => {
  it.each([
    "https://fcm.googleapis.com/fcm/send/abc",
    "https://web.push.apple.com/QGu",
    "https://updates.push.services.mozilla.com/wpush/v2/x",
    "https://wns2-par02p.notify.windows.com/w/?token=x",
  ])("aceita o serviço de push %s", (endpoint) => {
    expect(isPushServiceEndpoint(endpoint)).toBe(true);
  });

  it.each([
    "http://fcm.googleapis.com/fcm/send/abc",
    "https://fcm.googleapis.com.evil.com/x",
    "https://evilpush.apple.com/x",
    "https://localhost:3333/x",
    "não é endereço",
  ])("recusa %s", (endpoint) => {
    expect(isPushServiceEndpoint(endpoint)).toBe(false);
  });
});

describe("PushSenderService", () => {
  const sendNotification = vi.mocked(webpush.sendNotification);

  beforeEach(() => vi.clearAllMocks());

  it("sem as chaves: desligado, sem chave pública e sem enviar", async () => {
    const sender = new PushSenderService(configWith({}));
    expect(sender.enabled).toBe(false);
    expect(sender.publicKey).toBeNull();
    await expect(sender.send(target, payload)).resolves.toBe("failed");
    expect(sendNotification).not.toHaveBeenCalled();
  });

  it("com as chaves: envia o conteúdo em JSON com as chaves VAPID", async () => {
    sendNotification.mockResolvedValue({} as never);
    const sender = new PushSenderService(configWith(VAPID));
    expect(sender.publicKey).toBe("chave-publica");

    await expect(sender.send(target, payload)).resolves.toBe("sent");
    expect(sendNotification).toHaveBeenCalledWith(
      { endpoint: target.endpoint, keys: { p256dh: "p", auth: "a" } },
      JSON.stringify(payload),
      expect.objectContaining({
        vapidDetails: {
          subject: VAPID.VAPID_SUBJECT,
          publicKey: "chave-publica",
          privateKey: "chave-privada",
        },
      }),
    );
  });

  it.each([404, 410])(
    "%s do serviço de push: o aparelho deixou de existir",
    async (status) => {
      sendNotification.mockRejectedValue(
        new WebPushError("sumiu", status, {}, "", target.endpoint),
      );
      const sender = new PushSenderService(configWith(VAPID));
      await expect(sender.send(target, payload)).resolves.toBe("gone");
    },
  );

  it("outra falha: só registra, sem lançar", async () => {
    sendNotification.mockRejectedValue(new Error("rede fora"));
    const sender = new PushSenderService(configWith(VAPID));
    await expect(sender.send(target, payload)).resolves.toBe("failed");
  });
});
