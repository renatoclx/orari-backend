import { randomBytes, createHash } from "node:crypto";
import { Injectable, UnauthorizedException } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { JwtService } from "@nestjs/jwt";
import * as bcrypt from "bcrypt";
import ms, { type StringValue } from "ms";
import { PrismaService } from "../../prisma/prisma.service";
import { CompanyService } from "../company/company.service";
import { UserService } from "../user/user.service";
import { LoginDto } from "./dto/login.dto";
import { RefreshTokenDto } from "./dto/refresh-token.dto";
import { JwtPayload } from "./jwt-payload.interface";

export interface AuthTokens {
  accessToken: string;
  refreshToken: string;
}

@Injectable()
export class AuthService {
  constructor(
    private readonly userService: UserService,
    private readonly companyService: CompanyService,
    private readonly jwtService: JwtService,
    private readonly configService: ConfigService,
    private readonly prisma: PrismaService,
  ) {}

  async login(dto: LoginDto): Promise<AuthTokens> {
    const user = await this.userService.findByEmailWithPassword(dto.email);

    if (!user) {
      throw new UnauthorizedException("Credenciais inválidas");
    }

    // Verifica se o password enviado corresponde ao bcrypt já registrado.
    const passwordMatches = await bcrypt.compare(dto.password, user.password);
    if (!passwordMatches) {
      throw new UnauthorizedException("Credenciais inválidas");
    }

    // Mesma mensagem genérica: não revela a quem tenta logar que a empresa está inativa.
    const companyIsActive = await this.companyService.isActive(user.companyId);
    if (!companyIsActive) {
      throw new UnauthorizedException("Credenciais inválidas");
    }

    return this.issueTokens(user.id, user.email);
  }

  /**
   * Troca um refresh token válido por um novo par de tokens. O refresh token
   * usado é revogado nesse momento (rotação): só serve uma vez, o que permite
   * detectar reuso de um token vazado.
   */
  async refresh(dto: RefreshTokenDto): Promise<AuthTokens> {
    const tokenHash = this.hashToken(dto.refreshToken);
    const now = new Date();

    const stored = await this.prisma.refreshToken.findUnique({
      where: { tokenHash },
    });

    if (!stored || stored.revokedAt || stored.expiresAt <= now) {
      throw new UnauthorizedException("Refresh token inválido");
    }

    // Revogado já aqui: mesmo que as checagens abaixo falhem, o token não pode
    // ser reaproveitado.
    await this.prisma.refreshToken.update({
      where: { id: stored.id },
      data: { revokedAt: now },
    });

    const user = await this.userService.findActiveById(stored.userId);
    if (!user || !(await this.companyService.isActive(user.companyId))) {
      throw new UnauthorizedException("Refresh token inválido");
    }

    return this.issueTokens(user.id, user.email);
  }

  /** Revoga o refresh token informado. Idempotente: token inexistente ou já revogado não é erro. */
  async logout(dto: RefreshTokenDto): Promise<void> {
    await this.prisma.refreshToken.updateMany({
      where: { tokenHash: this.hashToken(dto.refreshToken), revokedAt: null },
      data: { revokedAt: new Date() },
    });
  }

  private async issueTokens(
    userId: string,
    email: string,
  ): Promise<AuthTokens> {
    const payload: JwtPayload = { sub: userId, email };
    const [accessToken, refreshToken] = await Promise.all([
      this.jwtService.signAsync(payload),
      this.createRefreshToken(userId),
    ]);

    return { accessToken, refreshToken };
  }

  // Token opaco (não é JWT): só o hash é persistido, e o valor bruto é devolvido uma única vez.
  private async createRefreshToken(userId: string): Promise<string> {
    const rawToken = randomBytes(64).toString("hex");
    const expiresIn = this.configService.get<string>(
      "JWT_REFRESH_EXPIRES_IN",
    ) as StringValue;

    await this.prisma.refreshToken.create({
      data: {
        userId,
        tokenHash: this.hashToken(rawToken),
        expiresAt: new Date(Date.now() + ms(expiresIn)),
      },
    });

    return rawToken;
  }

  // SHA-256: o token já tem entropia alta (512 bits), então não precisa do
  // hash lento do bcrypt — e um hash determinístico permite buscar por igualdade.
  private hashToken(token: string): string {
    return createHash("sha256").update(token).digest("hex");
  }
}
