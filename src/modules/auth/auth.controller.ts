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
  ApiTags,
  ApiTooManyRequestsResponse,
} from "@nestjs/swagger";
import { Throttle, ThrottlerGuard } from "@nestjs/throttler";
import { CurrentUser } from "../../common/decorators/current-user.decorator";
import { ProfessionalApp } from "../../common/decorators/professional-app.decorator";
import { Public } from "../../common/decorators/public.decorator";
import type { AuthenticatedUser } from "../../common/interfaces/authenticated-user.interface";
import { AUTH_THROTTLER, REFRESH_LIMIT } from "./auth-throttle";
import { AuthService } from "./auth.service";
import { ChangePasswordDto } from "./dto/change-password.dto";
import { LoginDto } from "./dto/login.dto";
import { ProfessionalLoginDto } from "./dto/professional-login.dto";
import { RefreshTokenDto } from "./dto/refresh-token.dto";

@ApiTags("Auth")
@Controller("auth")
export class AuthController {
  constructor(private readonly authService: AuthService) {}

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
