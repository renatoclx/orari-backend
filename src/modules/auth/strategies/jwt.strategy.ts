import { Injectable, UnauthorizedException } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { PassportStrategy } from "@nestjs/passport";
import { ExtractJwt, Strategy } from "passport-jwt";
import { AuthenticatedUser } from "../../../common/interfaces/authenticated-user.interface";
import { CompanyService } from "../../company/company.service";
import { UserService } from "../../user/user.service";
import { JwtPayload } from "../jwt-payload.interface";

@Injectable()
export class JwtStrategy extends PassportStrategy(Strategy) {
  constructor(
    configService: ConfigService,
    private readonly userService: UserService,
    private readonly companyService: CompanyService,
  ) {
    super({
      jwtFromRequest: ExtractJwt.fromAuthHeaderAsBearerToken(),
      ignoreExpiration: false,
      secretOrKey: configService.get<string>("JWT_SECRET")!,
    });
  }

  // O token carrega só a identificação (ver docs/auth.md). Recarregar o usuário a cada
  // requisição também invalida na hora tokens de usuários excluídos ou de empresas inativas.
  async validate(payload: JwtPayload): Promise<AuthenticatedUser> {
    const user = await this.userService.findActiveById(payload.sub);

    if (!user || !(await this.companyService.isActive(user.companyId))) {
      throw new UnauthorizedException();
    }

    return {
      id: user.id,
      email: user.email,
      type: user.type,
      companyId: user.companyId,
    };
  }
}
