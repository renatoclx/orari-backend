import { Injectable, UnauthorizedException } from "@nestjs/common";
import { JwtService } from "@nestjs/jwt";
import * as bcrypt from "bcrypt";
import { CompanyService } from "../company/company.service";
import { UserService } from "../user/user.service";
import { LoginDto } from "./dto/login.dto";
import { JwtPayload } from "./jwt-payload.interface";

@Injectable()
export class AuthService {
  constructor(
    private readonly userService: UserService,
    private readonly companyService: CompanyService,
    private readonly jwtService: JwtService,
  ) {}

  async login(dto: LoginDto): Promise<{ accessToken: string }> {
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

    const payload: JwtPayload = { sub: user.id, email: user.email };

    return { accessToken: await this.jwtService.signAsync(payload) };
  }
}
