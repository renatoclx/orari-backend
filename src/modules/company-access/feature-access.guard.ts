import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
} from "@nestjs/common";
import { Reflector } from "@nestjs/core";
import { UserType } from "../../../generated/prisma/enums";
import { IS_PUBLIC_KEY } from "../../common/decorators/public.decorator";
import {
  FEATURE_ACTION_KEY,
  FEATURE_KEY,
} from "../../common/decorators/feature.decorator";
import { AuthenticatedUser } from "../../common/interfaces/authenticated-user.interface";
import type { AccessAction, FeatureKey } from "./access-catalog";
import { CompanyAccessService } from "./company-access.service";

/** Ação exigida por padrão, a partir do verbo HTTP. */
export function actionFromMethod(method: string): AccessAction {
  switch (method.toUpperCase()) {
    case "GET":
    case "HEAD":
      return "view";
    case "POST":
      return "create";
    case "DELETE":
      return "remove";
    default:
      return "edit";
  }
}

/**
 * Barra a rota quando a empresa do usuário não tem a ação liberada na
 * funcionalidade (ver docs/business-rules.md, "Acessos e limites da empresa").
 * Roda depois do JwtAuthGuard e do RolesGuard. O SUPER_ADMIN não é limitado.
 */
@Injectable()
export class FeatureAccessGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly companyAccessService: CompanyAccessService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const targets = [context.getHandler(), context.getClass()];

    if (this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, targets)) {
      return true;
    }
    const feature = this.reflector.getAllAndOverride<FeatureKey | undefined>(
      FEATURE_KEY,
      targets,
    );
    if (!feature) return true;

    const { user, method } = context
      .switchToHttp()
      .getRequest<{ user?: AuthenticatedUser; method: string }>();
    if (!user) return false;
    if (user.type === UserType.SUPER_ADMIN) return true;

    const action =
      this.reflector.getAllAndOverride<AccessAction | undefined>(
        FEATURE_ACTION_KEY,
        targets,
      ) ?? actionFromMethod(method);

    if (await this.companyAccessService.can(user.companyId, feature, action)) {
      return true;
    }
    // O código permite ao front distinguir "fora do plano" de uma recusa comum.
    throw new ForbiddenException({
      statusCode: 403,
      error: "Forbidden",
      code: "FEATURE_NOT_IN_PLAN",
      message: "Esta funcionalidade não está disponível para a sua empresa",
    });
  }
}
