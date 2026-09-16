import { Test, TestingModule } from "@nestjs/testing";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { AuthController } from "./auth.controller";
import { AuthService } from "./auth.service";

describe("AuthController", () => {
  let authController: AuthController;

  const authServiceMock = {
    login: vi.fn(),
  };

  beforeEach(async () => {
    vi.clearAllMocks();

    const module: TestingModule = await Test.createTestingModule({
      controllers: [AuthController],
      providers: [{ provide: AuthService, useValue: authServiceMock }],
    }).compile();

    authController = module.get<AuthController>(AuthController);
  });

  describe("login", () => {
    it("deve delegar o login para o AuthService e repassar o resultado", async () => {
      const dto = { email: "test@example.com", password: "123456" };
      authServiceMock.login.mockResolvedValue({ accessToken: "token" });

      const result = await authController.login(dto);

      expect(authServiceMock.login).toHaveBeenCalledWith(dto);
      expect(result).toEqual({ accessToken: "token" });
    });
  });
});
