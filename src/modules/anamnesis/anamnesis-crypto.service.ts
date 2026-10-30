import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";
import { Injectable } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";

// Prefixo de versão: permite trocar o formato ou a chave no futuro sem ambiguidade.
const VERSION = "v1";
const ALGORITHM = "aes-256-gcm";
// Tamanhos recomendados para o GCM: IV de 12 bytes e tag de autenticação de 16.
const IV_BYTES = 12;
const TAG_BYTES = 16;

/**
 * Criptografia dos dados de saúde da anamnese (AES-256-GCM, no aplicativo), com
 * a chave de `ANAMNESIS_ENCRYPTION_KEY` (validada na subida, ver validateEnv).
 *
 * O valor gravado é `v1:<base64 de IV + tag + texto cifrado>`. Cada gravação usa
 * um IV novo, então o mesmo texto nunca produz o mesmo valor. O GCM autentica o
 * conteúdo: um valor alterado no banco, ou lido com outra chave, falha na leitura
 * em vez de devolver dados corrompidos.
 */
@Injectable()
export class AnamnesisCryptoService {
  private readonly key: Buffer;

  constructor(configService: ConfigService) {
    this.key = Buffer.from(
      configService.getOrThrow<string>("ANAMNESIS_ENCRYPTION_KEY"),
      "base64",
    );
  }

  encrypt(plainText: string): string {
    const iv = randomBytes(IV_BYTES);
    const cipher = createCipheriv(ALGORITHM, this.key, iv);
    const encrypted = Buffer.concat([
      cipher.update(plainText, "utf8"),
      cipher.final(),
    ]);

    return `${VERSION}:${Buffer.concat([iv, cipher.getAuthTag(), encrypted]).toString("base64")}`;
  }

  decrypt(stored: string): string {
    const [version, payload] = stored.split(":");
    if (version !== VERSION || !payload) {
      throw new Error("Formato de dado criptografado desconhecido");
    }

    const bytes = Buffer.from(payload, "base64");
    const iv = bytes.subarray(0, IV_BYTES);
    const tag = bytes.subarray(IV_BYTES, IV_BYTES + TAG_BYTES);
    const encrypted = bytes.subarray(IV_BYTES + TAG_BYTES);

    try {
      // Tamanho da tag fixo: sem ele, o Node aceitaria uma tag truncada (mais fácil de forjar).
      const decipher = createDecipheriv(ALGORITHM, this.key, iv, {
        authTagLength: TAG_BYTES,
      });
      decipher.setAuthTag(tag);

      return Buffer.concat([
        decipher.update(encrypted),
        decipher.final(),
      ]).toString("utf8");
    } catch {
      // Chave errada, valor alterado ou truncado; sem detalhes do motivo na mensagem.
      throw new Error("Não foi possível decifrar o dado da anamnese");
    }
  }
}
