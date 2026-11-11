import {
  CallHandler,
  ExecutionContext,
  Injectable,
  NestInterceptor,
} from "@nestjs/common";
import { map, Observable } from "rxjs";
import { isPrivateUploadPath, signUploadPath } from "./signed-upload-url";

/**
 * Troca, em toda resposta da API, o caminho de cada foto privada pelo link
 * assinado (ver signed-upload-url.ts). Fica num lugar só para que nenhuma rota
 * precise lembrar de assinar: a foto aparece em dezenas de consultas (pessoas,
 * agenda, relatórios, portal).
 *
 * Só percorre arrays e objetos simples; Date, Decimal, Buffer e arquivos
 * (StreamableFile) passam intactos. Devolve cópias: o objeto original, que pode
 * estar em uso em outro lugar, não é alterado.
 */
@Injectable()
export class SignedUploadsInterceptor implements NestInterceptor {
  constructor(private readonly secret: string) {}

  intercept(
    _context: ExecutionContext,
    next: CallHandler,
  ): Observable<unknown> {
    return next.handle().pipe(map((body) => this.sign(body, Date.now())));
  }

  private sign(value: unknown, now: number): unknown {
    if (typeof value === "string") {
      return isPrivateUploadPath(value)
        ? signUploadPath(value, this.secret, now)
        : value;
    }
    if (Array.isArray(value)) {
      return value.map((item) => this.sign(item, now));
    }
    if (isPlainObject(value)) {
      return Object.fromEntries(
        Object.entries(value).map(([key, item]) => [key, this.sign(item, now)]),
      );
    }

    return value;
  }
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  if (value === null || typeof value !== "object") {
    return false;
  }
  const prototype = Object.getPrototypeOf(value) as unknown;

  return prototype === Object.prototype || prototype === null;
}
