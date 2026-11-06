import { Injectable, Logger } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import webpush, { WebPushError } from "web-push";

/** O que o aparelho recebe; o service worker do app monta a notificação. */
export interface PushPayload {
  title: string;
  body: string;
  // Caminho do app aberto ao tocar.
  url: string;
}

export interface PushTarget {
  endpoint: string;
  p256dh: string;
  auth: string;
}

/**
 * sent: entregue ao serviço de push; gone: o aparelho deixou de existir (o
 * cliente desinstalou ou bloqueou) e a inscrição deve ser apagada; failed:
 * outra falha, só registrada.
 */
export type PushResult = "sent" | "gone" | "failed";

// Por quanto tempo o serviço de push guarda o aviso com o aparelho desligado.
const PUSH_TTL_SECONDS = 24 * 60 * 60;

// Serviços de push dos navegadores (Chrome/Android, Safari/iPhone, Firefox,
// Edge). A inscrição só aceita esses endereços: a API nunca faz POST para um
// endereço qualquer informado por quem chama.
const PUSH_SERVICE_HOSTS = [
  "fcm.googleapis.com",
  "push.apple.com",
  "push.services.mozilla.com",
  "notify.windows.com",
];

export function isPushServiceEndpoint(endpoint: string): boolean {
  try {
    const url = new URL(endpoint);
    return (
      url.protocol === "https:" &&
      PUSH_SERVICE_HOSTS.some(
        (host) => url.hostname === host || url.hostname.endsWith(`.${host}`),
      )
    );
  } catch {
    return false;
  }
}

/**
 * Envio pelo padrão Web Push (chaves VAPID). Sem as chaves no ambiente, o push
 * fica desligado: `publicKey` é nulo e nada é enviado (ver validateEnv).
 */
@Injectable()
export class PushSenderService {
  private readonly logger = new Logger("PushSender");
  readonly publicKey: string | null;
  private readonly vapid: {
    subject: string;
    publicKey: string;
    privateKey: string;
  } | null;

  constructor(config: ConfigService) {
    const publicKey = config.get<string>("VAPID_PUBLIC_KEY");
    const privateKey = config.get<string>("VAPID_PRIVATE_KEY");
    const subject = config.get<string>("VAPID_SUBJECT");
    this.vapid =
      publicKey && privateKey && subject
        ? { subject, publicKey, privateKey }
        : null;
    this.publicKey = this.vapid?.publicKey ?? null;
  }

  get enabled(): boolean {
    return this.vapid !== null;
  }

  async send(target: PushTarget, payload: PushPayload): Promise<PushResult> {
    if (!this.vapid) return "failed";
    try {
      await webpush.sendNotification(
        {
          endpoint: target.endpoint,
          keys: { p256dh: target.p256dh, auth: target.auth },
        },
        JSON.stringify(payload),
        { TTL: PUSH_TTL_SECONDS, urgency: "high", vapidDetails: this.vapid },
      );
      return "sent";
    } catch (error) {
      // 404 e 410: o serviço de push avisa que a inscrição não existe mais.
      if (
        error instanceof WebPushError &&
        (error.statusCode === 404 || error.statusCode === 410)
      ) {
        return "gone";
      }
      this.logger.warn(
        `Falha no envio para ${new URL(target.endpoint).hostname}: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
      return "failed";
    }
  }
}
