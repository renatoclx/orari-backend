import {
  Body,
  Controller,
  Get,
  HttpCode,
  Patch,
  Post,
  UseGuards,
} from "@nestjs/common";
import {
  ApiBearerAuth,
  ApiOperation,
  ApiTags,
  ApiTooManyRequestsResponse,
} from "@nestjs/swagger";
import { Throttle, ThrottlerGuard } from "@nestjs/throttler";
import { AllowReadOnly } from "../../common/decorators/allow-read-only.decorator";
import { CurrentUser } from "../../common/decorators/current-user.decorator";
import { ProfessionalApp } from "../../common/decorators/professional-app.decorator";
import { Public } from "../../common/decorators/public.decorator";
import type { AuthenticatedUser } from "../../common/interfaces/authenticated-user.interface";
import { AUTH_THROTTLER, REFRESH_LIMIT, SIGNUP_LIMIT } from "./auth-throttle";
import { AuthService } from "./auth.service";
import { ChangePasswordDto } from "./dto/change-password.dto";
import { LoginDto } from "./dto/login.dto";
import { ProfessionalLoginDto } from "./dto/professional-login.dto";
import { RefreshTokenDto } from "./dto/refresh-token.dto";
import { SignupDto } from "./dto/signup.dto";
import { SignupService } from "./signup.service";

@ApiTags("Auth")
@Controller("auth")
export class AuthController {
  constructor(
    private readonly authService: AuthService,
    private readonly signupService: SignupService,
  ) {}

  @Public()
  @Post("login")
  @HttpCode(200)
  // Limite de tentativas só nas rotas que recebem credencial (ver auth-throttle.ts).
  @UseGuards(ThrottlerGuard)
  @ApiTooManyRequestsResponse({ description: "Tentativas demais; aguarde." })
  login(@Body() dto: LoginDto) {
    return this.authService.login(dto);
  }

  // Entrada do usuário PROFESSIONAL no app: pelo telefone, como o cliente. Só
  // ele entra por aqui (os demais perfis usam o e-mail, em /auth/login).
  @Public()
  @Post("professional/login")
  @HttpCode(200)
  @UseGuards(ThrottlerGuard)
  @ApiTooManyRequestsResponse({ description: "Tentativas demais; aguarde." })
  professionalLogin(@Body() dto: ProfessionalLoginDto) {
    return this.authService.professionalLogin(dto);
  }

  // Público: a credencial aqui é o refresh token do corpo, não o access token do header.
  @Public()
  @Post("refresh")
  @HttpCode(200)
  @UseGuards(ThrottlerGuard)
  @Throttle({ [AUTH_THROTTLER]: REFRESH_LIMIT })
  @ApiTooManyRequestsResponse({ description: "Tentativas demais; aguarde." })
  refresh(@Body() dto: RefreshTokenDto) {
    return this.authService.refresh(dto);
  }

  // Cadastro sozinho pela landing: cria a empresa em teste de 7 dias e já entra
  // (devolve os tokens). Público, com limite por IP contra cadastros em massa.
  @Public()
  @Post("signup")
  @HttpCode(201)
  @UseGuards(ThrottlerGuard)
  @Throttle({ [AUTH_THROTTLER]: SIGNUP_LIMIT })
  @ApiOperation({
    summary: "Cadastro sozinho da empresa (teste grátis de 7 dias)",
    description:
      "Cria a empresa com os acessos do plano escolhido, a assinatura em teste, o contato e o administrador, e devolve os tokens. E-mail ou documento já usados: 409 com `field`.",
  })
  @ApiTooManyRequestsResponse({ description: "Tentativas demais; aguarde." })
  signup(@Body() dto: SignupDto) {
    return this.signupService.signup(dto);
  }

  // Protegida (sem @Public): devolve o usuário do access token enviado. Do app
  // do profissional também (@ProfessionalApp: o perfil só de app nega o resto).
  @ApiBearerAuth()
  @ProfessionalApp()
  @Get("me")
  me(@CurrentUser() currentUser: AuthenticatedUser) {
    return this.authService.me(currentUser.id);
  }

  // Troca da própria senha. Recebe a senha atual, então tem o mesmo limite de
  // tentativas do login (ver auth-throttle.ts).
  @ApiBearerAuth()
  @ProfessionalApp()
  // A senha é do usuário, não dado da empresa: troca mesmo em somente leitura.
  @AllowReadOnly()
  @Patch("me/password")
  @HttpCode(204)
  @UseGuards(ThrottlerGuard)
  @ApiTooManyRequestsResponse({ description: "Tentativas demais; aguarde." })
  changePassword(
    @Body() dto: ChangePasswordDto,
    @CurrentUser() currentUser: AuthenticatedUser,
  ) {
    return this.authService.changePassword(currentUser.id, dto);
  }

  @Public()
  @Post("logout")
  @HttpCode(204)
  logout(@Body() dto: RefreshTokenDto) {
    return this.authService.logout(dto);
  }
}
