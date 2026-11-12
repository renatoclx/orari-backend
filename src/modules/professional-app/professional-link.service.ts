import { ForbiddenException, Injectable } from "@nestjs/common";
import { PeopleType } from "../../../generated/prisma/enums";
import type { AuthenticatedUser } from "../../common/interfaces/authenticated-user.interface";
import { PrismaService } from "../../prisma/prisma.service";

/**
 * O profissional do usuário logado: toda consulta do app parte dele (nunca de
 * um parâmetro), então ninguém vê os dados de outro mudando a URL.
 */
@Injectable()
export class ProfessionalLinkService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * Cadastro inativado suspende o acesso (como o /auth/me, que o mostra sem
   * vínculo); usuário sem vínculo ou ligado a funcionário também é recusado.
   */
  async requireProfessionalId(user: AuthenticatedUser): Promise<string> {
    const found = await this.prisma.user.findFirst({
      where: { id: user.id, companyId: user.companyId, deletedAt: null },
      select: { people: { select: { id: true, type: true, deletedAt: true } } },
    });
    const person = found?.people;
    if (
      !person ||
      person.deletedAt ||
      person.type !== PeopleType.PROFESSIONAL
    ) {
      throw new ForbiddenException("O cadastro de profissional está inativo");
    }
    return person.id;
  }
}
