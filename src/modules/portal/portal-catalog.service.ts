import { Injectable } from "@nestjs/common";
import { PrismaService } from "../../prisma/prisma.service";

/**
 * O que o cliente vê antes de entrar: os serviços da clínica com quem os
 * atende. Um serviço aparece se está ativo e tem ao menos um profissional
 * ativo ligado a ele (ver ServiceProfessional).
 */
@Injectable()
export class PortalCatalogService {
  constructor(private readonly prisma: PrismaService) {}

  async services(companyId: string) {
    const activeProfessional = {
      type: "PROFESSIONAL" as const,
      deletedAt: null,
    };
    const services = await this.prisma.service.findMany({
      where: {
        companyId,
        isActive: true,
        deletedAt: null,
        professionals: { some: { people: activeProfessional } },
      },
      select: {
        id: true,
        name: true,
        description: true,
        duration: true,
        price: true,
        color: true,
        professionals: {
          where: { people: activeProfessional },
          select: {
            people: { select: { id: true, name: true, photoUrl: true } },
          },
          orderBy: { people: { name: "asc" } },
        },
      },
      orderBy: { name: "asc" },
    });
    return services.map(({ professionals, price, ...service }) => ({
      ...service,
      price: price === null ? null : Number(price),
      professionals: professionals.map((link) => link.people),
    }));
  }
}
