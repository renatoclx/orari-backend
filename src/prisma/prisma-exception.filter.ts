import {
  ArgumentsHost,
  Catch,
  ExceptionFilter,
  HttpStatus,
  Logger,
} from "@nestjs/common";
import type { Response } from "express";
import { Prisma } from "../../generated/prisma/client";

// Resposta HTTP de cada erro conhecido do Prisma que nenhum service tratou.
const KNOWN_ERRORS: Record<string, { status: HttpStatus; message: string }> = {
  // Registro removido (ou fora do filtro) no meio da operação.
  P2025: {
    status: HttpStatus.NOT_FOUND,
    message: "Registro não encontrado",
  },
  // Unicidade que o service não conferiu antes.
  P2002: {
    status: HttpStatus.CONFLICT,
    message: "Já existe um registro com estes dados",
  },
  // Chave estrangeira: referência inexistente ou registro ainda em uso.
  P2003: {
    status: HttpStatus.CONFLICT,
    message: "A operação depende de um registro que não existe ou está em uso",
  },
  // Conflito de escrita ou deadlock entre transações simultâneas.
  P2034: {
    status: HttpStatus.CONFLICT,
    message: "Outra operação mudou estes dados; tente novamente",
  },
};

/**
 * Rede de proteção para os erros do Prisma (ver docs/technical-debt.md,
 * "Legibilidade"). Os services seguem traduzindo os casos que conhecem, com
 * mensagens precisas; este filtro só recebe o que escapou deles, e evita que
 * um erro previsível responda 500. Um código fora da lista continua 500, com
 * log, como qualquer erro inesperado.
 */
@Catch(Prisma.PrismaClientKnownRequestError)
export class PrismaExceptionFilter implements ExceptionFilter {
  private readonly logger = new Logger(PrismaExceptionFilter.name);

  catch(
    error: Prisma.PrismaClientKnownRequestError,
    host: ArgumentsHost,
  ): void {
    const response = host.switchToHttp().getResponse<Response>();
    const known = KNOWN_ERRORS[error.code];

    if (!known) {
      this.logger.error(`Erro do Prisma ${error.code}`, error.stack);
      response.status(HttpStatus.INTERNAL_SERVER_ERROR).json({
        statusCode: HttpStatus.INTERNAL_SERVER_ERROR,
        message: "Internal server error",
      });
      return;
    }

    // O código fica no log para achar o service que deveria ter tratado o caso.
    this.logger.warn(`Erro do Prisma ${error.code} sem tratamento no service`);
    response.status(known.status).json({
      statusCode: known.status,
      error: known.status === HttpStatus.NOT_FOUND ? "Not Found" : "Conflict",
      message: known.message,
    });
  }
}
