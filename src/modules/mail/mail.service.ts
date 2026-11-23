import {
  Injectable,
  Logger,
  ServiceUnavailableException,
} from "@nestjs/common";
import { ConfigService } from "@nestjs/config";

export interface MailMessage {
  to: string;
  subject: string;
  /** Versão em texto: alguns leitores de e-mail só mostram esta. */
  text: string;
  html: string;
}

/** Remetente padrão, enquanto o MAIL_FROM não for definido. */
const DEFAULT_FROM = "Orari <nao-responda@orariapp.com.br>";
const RESEND_URL = "https://api.resend.com/emails";

/**
 * Envio de e-mails do Orari (ver docs/auth.md, "Redefinir a senha"). Com a
 * RESEND_API_KEY, envia pelo Resend (uma chamada HTTP, sem biblioteca). Sem
 * ela: no ambiente local, escreve o e-mail no log da API, para testar sem
 * enviar; em produção, recusa (um link de senha nunca vai para o log).
 */
@Injectable()
export class MailService {
  private readonly logger = new Logger("Mail");

  constructor(private readonly config: ConfigService) {}

  async send(message: MailMessage): Promise<void> {
    const apiKey = this.config.get<string>("RESEND_API_KEY");
    if (!apiKey) {
      if (this.config.get<string>("NODE_ENV") === "production") {
        throw new ServiceUnavailableException(
          "O envio de e-mail não está configurado",
        );
      }
      this.logger.log(
        `E-mail (não enviado, ambiente local) para ${message.to}\nAssunto: ${message.subject}\n${message.text}`,
      );
      return;
    }

    const response = await fetch(RESEND_URL, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        from: this.config.get<string>("MAIL_FROM") || DEFAULT_FROM,
        to: [message.to],
        subject: message.subject,
        text: message.text,
        html: message.html,
      }),
    });
    if (!response.ok) {
      // O corpo traz o motivo (ex.: domínio não verificado); o destinatário não.
      throw new ServiceUnavailableException(
        `O Resend recusou o envio (${response.status}): ${await response.text()}`,
      );
    }
  }
}
