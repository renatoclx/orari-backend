import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
} from "@nestjs/common";
import { Reflector } from "@nestjs/core";
import { UserType } from "../../../../generated/prisma/enums";
import { IS_PUBLIC_KEY } from "../../../common/decorators/public.decorator";
import { PROFESSIONAL_APP_KEY } from "../../../common/decorators/professional-app.decorator";
import { AuthenticatedUser } from "../../../common/interfaces/authenticated-user.interface";

/**
 * O usuário PROFESSIONAL (só app) nega por padrão: o RolesGuard libera a rota
 * sem @Roles para qualquer usuário logado, e há muitas assim (agenda, pessoas,
 * pagamentos...). Este guard fecha esse buraco para o perfil novo: só passam
 * as rotas marcadas com @ProfessionalApp(). Roda depois do RolesGuard.
 */
@Injectable()
export class ProfessionalAppGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const targets = [context.getHandler(), context.getClass()];

    if (this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, targets)) {
      return true;
    }

    const { user } = context
      .switchToHttp()
      .getRequest<{ user?: AuthenticatedUser }>();
    if (user?.type !== UserType.PROFESSIONAL) {
      return true;
    }

    if (
      this.reflector.getAllAndOverride<boolean>(PROFESSIONAL_APP_KEY, targets)
    ) {
      return true;
    }
    throw new ForbiddenException(
      "Este acesso é só do aplicativo do profissional",
    );
  }
}
