import {
  Body,
  Controller,
  Get,
  HttpCode,
  Ip,
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
import {
  AUTH_THROTTLER,
  FORGOT_PASSWORD_LIMIT,
  REFRESH_LIMIT,
  RESET_PASSWORD_LIMIT,
  SIGNUP_LIMIT,
} from "./auth-throttle";
import { AuthService } from "./auth.service";
import { ChangePasswordDto } from "./dto/change-password.dto";
import { LoginDto } from "./dto/login.dto";
import { ProfessionalLoginDto } from "./dto/professional-login.dto";
import { RefreshTokenDto } from "./dto/refresh-token.dto";
import { SignupDto } from "./dto/signup.dto";
import { ForgotPasswordDto } from "./dto/forgot-password.dto";
import { PasswordResetDto } from "./dto/password-reset.dto";
import { PasswordResetService } from "./password-reset.service";
import { SignupService } from "./signup.service";

@ApiTags("Auth")
@Controller("auth")
export class AuthController {
  constructor(
    private readonly authService: AuthService,
    private readonly signupService: SignupService,
    private readonly passwordResetService: PasswordResetService,
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

  // "Esqueci minha senha": manda o link por e-mail. Responde sempre 204, exista
  // o e-mail ou não, para não revelar quem tem conta.
  @Public()
  @Post("password/forgot")
  @HttpCode(204)
  @UseGuards(ThrottlerGuard)
  @Throttle({ [AUTH_THROTTLER]: FORGOT_PASSWORD_LIMIT })
  @ApiOperation({
    summary: "Pede o link de redefinição de senha por e-mail",
    description:
      "Sempre 204. Com o e-mail cadastrado (usuário ativo), envia um link que vale 1 hora e uma vez só; no máximo um por minuto por e-mail.",
  })
  @ApiTooManyRequestsResponse({ description: "Tentativas demais; aguarde." })
  async forgotPassword(@Body() dto: ForgotPasswordDto) {
    await this.passwordResetService.request(dto.email);
  }

  // Senha nova com o token do link. Encerra todas as sessões da pessoa.
  @Public()
  @Post("password/reset")
  @HttpCode(200)
  @UseGuards(ThrottlerGuard)
  @Throttle({ [AUTH_THROTTLER]: RESET_PASSWORD_LIMIT })
  @ApiOperation({
    summary: "Define a senha nova com o link do e-mail",
    description:
      "Link usado, vencido ou desconhecido: 400. Devolve `professional` (a pessoa entra pelo app, não pelo sistema web).",
  })
  @ApiTooManyRequestsResponse({ description: "Tentativas demais; aguarde." })
  resetPassword(@Body() dto: PasswordResetDto, @Ip() ip: string) {
    return this.passwordResetService.reset(dto.token, dto.newPassword, ip);
  }
}
