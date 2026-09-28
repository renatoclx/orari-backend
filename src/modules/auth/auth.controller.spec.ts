import { Test, TestingModule } from "@nestjs/testing";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { AuthController } from "./auth.controller";
import { AuthService } from "./auth.service";

describe("AuthController", () => {
  let authController: AuthController;

  const authServiceMock = {
    login: vi.fn(),
    refresh: vi.fn(),
    logout: vi.fn(),
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

  describe("refresh", () => {
    it("deve delegar o refresh para o AuthService e repassar o resultado", async () => {
      const dto = { refreshToken: "raw-token" };
      authServiceMock.refresh.mockResolvedValue({
        accessToken: "new-access",
        refreshToken: "new-refresh",
      });

      const result = await authController.refresh(dto);

      expect(authServiceMock.refresh).toHaveBeenCalledWith(dto);
      expect(result).toEqual({
        accessToken: "new-access",
        refreshToken: "new-refresh",
      });
    });
  });

  describe("logout", () => {
    it("deve delegar o logout para o AuthService", async () => {
      const dto = { refreshToken: "raw-token" };
      authServiceMock.logout.mockResolvedValue(undefined);

      await authController.logout(dto);

      expect(authServiceMock.logout).toHaveBeenCalledWith(dto);
    });
  });
});
