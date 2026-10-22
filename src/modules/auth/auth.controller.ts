import {
  Body,
  Controller,
  Get,
  HttpCode,
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
import { Public } from "../../common/decorators/public.decorator";
import type { AuthenticatedUser } from "../../common/interfaces/authenticated-user.interface";
import { AUTH_THROTTLER, REFRESH_LIMIT } from "./auth-throttle";
import { AuthService } from "./auth.service";
import { LoginDto } from "./dto/login.dto";
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

  // Protegida (sem @Public): devolve o usuário do access token enviado.
  @ApiBearerAuth()
  @Get("me")
  me(@CurrentUser() currentUser: AuthenticatedUser) {
    return this.authService.me(currentUser.id);
  }

  @Public()
  @Post("logout")
  @HttpCode(204)
  logout(@Body() dto: RefreshTokenDto) {
    return this.authService.logout(dto);
  }
}
