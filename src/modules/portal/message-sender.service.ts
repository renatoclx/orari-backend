import {
  Injectable,
  Logger,
  ServiceUnavailableException,
} from "@nestjs/common";
import { ConfigService } from "@nestjs/config";

export interface VerificationMessage {
  companyId: string;
  companyName: string;
  // Telefone do cliente, com DDD, só dígitos.
  phone: string;
  code: string;
}

/**
 * Envio das mensagens ao cliente. Mais adiante, escolhe o canal por empresa: o
 * WhatsApp conectado da clínica ou, sem ele, o número do Orari. Por enquanto só
 * existe o modo de desenvolvimento, que escreve o código no log da API; em
 * produção, sem um canal configurado, o envio é recusado (nunca vai para o log).
 */
@Injectable()
export class MessageSenderService {
  private readonly logger = new Logger("PortalMessages");

  constructor(private readonly config: ConfigService) {}

  async sendVerificationCode(message: VerificationMessage): Promise<void> {
    if (this.config.get<string>("NODE_ENV") === "production") {
      throw new ServiceUnavailableException(
        "O envio do código ainda não está disponível",
      );
    }
    this.logger.log(
      `Código do portal para ${message.phone} (${message.companyName}): ${message.code}`,
    );
    return Promise.resolve();
  }
}
