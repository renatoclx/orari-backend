import { randomBytes, createHash } from "node:crypto";
import { Injectable, UnauthorizedException } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { JwtService } from "@nestjs/jwt";
import * as bcrypt from "bcrypt";
import ms, { type StringValue } from "ms";
import { UserType } from "../../../generated/prisma/enums";
import { PrismaService } from "../../prisma/prisma.service";
import { CompanyService } from "../company/company.service";
import { UserService } from "../user/user.service";
import { LoginDto } from "./dto/login.dto";
import { RefreshTokenDto } from "./dto/refresh-token.dto";
import { JwtPayload } from "./jwt-payload.interface";

/**
 * Hash bcrypt de um texto qualquer, com o mesmo custo das senhas. Quando o
 * e-mail não existe, a senha é comparada com ele para o login levar o mesmo
 * tempo nos dois casos: sem isso, a resposta mais rápida revelaria quais
 * e-mails têm conta.
 */
const TIMING_PLACEHOLDER_HASH =
  "$2b$10$XmRU9YoHggPHKfhUuaInaOJmQbcemEM0nCmq9lkAKJq6Wd6tLdsnq";

export interface AuthTokens {
  accessToken: string;
  refreshToken: string;
}

// Resposta do GET /auth/me: quem está logado e em qual empresa.
export interface MeResponse {
  id: string;
  name: string;
  email: string;
  type: UserType;
  company: {
    id: string;
    // Nome fantasia; sem ele, a razão social.
    name: string;
    // O front exibe os horários da agenda no fuso da empresa.
    timezone: string;
    logoUrl: string | null;
  };
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

    // Verifica se o password enviado corresponde ao bcrypt já registrado. A
    // comparação roda mesmo sem usuário (ver TIMING_PLACEHOLDER_HASH).
    const passwordMatches = await bcrypt.compare(
      dto.password,
      user?.password ?? TIMING_PLACEHOLDER_HASH,
    );
    if (!user || !passwordMatches) {
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
   * Perfil do usuário autenticado, para o front montar a sessão. O usuário já
   * foi validado pelo JwtStrategy; se tiver sido excluído nesse meio tempo,
   * responde 401, como um token inválido.
   */
  async me(userId: string): Promise<MeResponse> {
    const profile = await this.userService.findProfile(userId);
    if (!profile) {
      throw new UnauthorizedException();
    }

    const { company, ...user } = profile;

    return {
      ...user,
      company: {
        id: company.id,
        name: company.fantasyName ?? company.corporateReason,
        timezone: company.timezone,
        logoUrl: company.logoUrl,
      },
    };
  }

  /**
   * Troca um refresh token válido por um novo par de tokens. O refresh token
   * usado é revogado nesse momento (rotação): cada token serve uma única vez.
   */
  async refresh(dto: RefreshTokenDto): Promise<AuthTokens> {
    const tokenHash = this.hashToken(dto.refreshToken);
    const now = new Date();

    // Conferir e revogar no mesmo comando: com duas requisições usando o mesmo
    // token ao mesmo tempo, só a primeira encontra o token ainda válido. Ler e
    // revogar em passos separados deixaria as duas passarem. Revogado já aqui,
    // o token não é reaproveitado mesmo que as checagens abaixo falhem.
    const { count } = await this.prisma.refreshToken.updateMany({
      where: { tokenHash, revokedAt: null, expiresAt: { gt: now } },
      data: { revokedAt: now },
    });
    if (count === 0) {
      throw new UnauthorizedException("Refresh token inválido");
    }

    const { userId } = await this.prisma.refreshToken.findUniqueOrThrow({
      where: { tokenHash },
      select: { userId: true },
    });
    const user = await this.userService.findActiveById(userId);
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
