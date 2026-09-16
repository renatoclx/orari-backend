import { Test, TestingModule } from "@nestjs/testing";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { PrismaService } from "../../prisma/prisma.service";
import { UserService } from "./user.service";

describe("UserService", () => {
  let userService: UserService;
  const prismaMock = {
    user: {
      findUnique: vi.fn(),
    },
  };

  beforeEach(async () => {
    vi.clearAllMocks();

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        UserService,
        { provide: PrismaService, useValue: prismaMock },
      ],
    }).compile();

    userService = module.get<UserService>(UserService);
  });

  describe("findByEmailWithPassword", () => {
    it("deve consultar o usuário pelo e-mail via PrismaService", async () => {
      const user = {
        id: "1",
        email: "test@example.com",
        password: "hashed",
        isActive: true,
      };
      prismaMock.user.findUnique.mockResolvedValue(user);

      const result =
        await userService.findByEmailWithPassword("test@example.com");

      expect(prismaMock.user.findUnique).toHaveBeenCalledWith({
        where: { email: "test@example.com" },
      });
      expect(result).toEqual(user);
    });

    it("deve retornar null quando o usuário não existe", async () => {
      prismaMock.user.findUnique.mockResolvedValue(null);

      const result = await userService.findByEmailWithPassword(
        "missing@example.com",
      );

      expect(result).toBeNull();
    });
  });
});
