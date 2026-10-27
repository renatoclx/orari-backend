import { ForbiddenException, Injectable } from "@nestjs/common";
import { PeopleType, UserType } from "../../../generated/prisma/enums";
import type { AuthenticatedUser } from "../../common/interfaces/authenticated-user.interface";
import { PrismaService } from "../../prisma/prisma.service";

/**
 * Quem pode usar a anamnese (ver docs/business-rules.md, "Acesso"): o ADMIN e o
 * usuário vinculado a um profissional ativo da própria empresa. Os demais,
 * inclusive o SUPER_ADMIN sem vínculo, não acessam dados de saúde.
 */
@Injectable()
export class AnamnesisAccessService {
  constructor(private readonly prisma: PrismaService) {}

  async canAccess(user: AuthenticatedUser): Promise<boolean> {
    if (user.type === UserType.ADMIN) {
      return true;
    }

    // Consulta pelo lado do profissional: vale só enquanto ele estiver ativo
    // (inativar o profissional suspende o acesso sem desfazer o vínculo).
    const professional = await this.prisma.people.findFirst({
      where: {
        companyId: user.companyId,
        type: PeopleType.PROFESSIONAL,
        deletedAt: null,
        users: { some: { id: user.id, deletedAt: null } },
      },
      select: { id: true },
    });

    return professional !== null;
  }

  // Versão para os services: recusa com 403 quando não há acesso.
  async ensureAccess(user: AuthenticatedUser): Promise<void> {
    if (!(await this.canAccess(user))) {
      throw new ForbiddenException(
        "Apenas administradores e profissionais acessam a anamnese",
      );
    }
  }
}
