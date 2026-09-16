import { Injectable } from "@nestjs/common";
import { PrismaService } from "../../prisma/prisma.service";

@Injectable()
export class UserService {
  constructor(private readonly prisma: PrismaService) {}

  findByEmailWithPassword(email: string) {
    return this.prisma.user.findUnique({ where: { email } });
  }
}
