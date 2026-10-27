import { Injectable } from "@nestjs/common";
import { Prisma } from "../../../generated/prisma/client";
import { AuditAction } from "../../../generated/prisma/enums";
import { PaginatedResult } from "../../common/interfaces/paginated-result.interface";
import { PrismaService } from "../../prisma/prisma.service";
import { FindAuditLogsQueryDto } from "./dto/find-audit-logs-query.dto";

// Dados de uma ação sensível a registrar (a data é preenchida pelo banco).
export interface AuditEntry {
  companyId: string;
  // Quem executou a ação.
  userId: string;
  action: AuditAction;
  // O que foi acessado ou alterado (ex.: "USER" e o id do usuário).
  entityType: string;
  entityId: string;
  // Cliente a que a ação se refere, quando houver.
  clientId?: string;
  ip?: string;
}

/**
 * Auditoria de ações sensíveis (ver docs/business-rules.md, "Anamnese"). Só
 * insere e consulta: o registro nunca é alterado nem excluído.
 */
@Injectable()
export class AuditService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * Grava o registro. Quem chama não deve engolir o erro: a ação sensível não
   * pode acontecer sem deixar rastro. Para que as duas gravações sejam
   * atômicas, a operação principal passa o `client` da própria transação.
   */
  async record(
    entry: AuditEntry,
    client: Prisma.TransactionClient = this.prisma,
  ): Promise<void> {
    await client.auditLog.create({ data: entry });
  }

  // Consulta da própria empresa, da ação mais recente para a mais antiga.
  async findAll(
    { page, limit, clientId, userId, action, from, to }: FindAuditLogsQueryDto,
    companyId: string,
  ): Promise<PaginatedResult<Prisma.AuditLogGetPayload<object>>> {
    const where: Prisma.AuditLogWhereInput = {
      companyId,
      clientId,
      userId,
      action,
      // Sem período, o filtro é omitido; com uma só ponta, fica aberto do outro lado.
      createdAt: from || to ? { gte: from, lte: to } : undefined,
    };

    const [items, total] = await this.prisma.$transaction([
      this.prisma.auditLog.findMany({
        where,
        orderBy: { createdAt: "desc" },
        skip: (page - 1) * limit,
        take: limit,
      }),
      this.prisma.auditLog.count({ where }),
    ]);

    return { items, total, page, limit };
  }
}
