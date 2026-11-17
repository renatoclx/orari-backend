import { CanActivate, ExecutionContext, Injectable } from "@nestjs/common";
import { Reflector } from "@nestjs/core";
import { UserType } from "../../../generated/prisma/enums";
import { ALLOW_READ_ONLY_KEY } from "../../common/decorators/allow-read-only.decorator";
import { IS_PUBLIC_KEY } from "../../common/decorators/public.decorator";
import type { AuthenticatedUser } from "../../common/interfaces/authenticated-user.interface";
import { SubscriptionService } from "./subscription.service";

const READ_METHODS = new Set(["GET", "HEAD", "OPTIONS"]);

/**
 * Barra as gravações da empresa com a assinatura em somente leitura (teste
 * encerrado, atraso além da tolerância ou cancelada). Ler continua liberado,
 * e os dados ficam. O SUPER_ADMIN não é afetado; rotas públicas (portal) se
 * protegem por conta própria.
 */
@Injectable()
export class ReadOnlyGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly subscriptionService: SubscriptionService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const targets = [context.getHandler(), context.getClass()];
    if (this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, targets)) {
      return true;
    }
    const request = context
      .switchToHttp()
      .getRequest<{ method: string; user?: AuthenticatedUser }>();
    if (READ_METHODS.has(request.method.toUpperCase())) return true;

    const { user } = request;
    if (!user || user.type === UserType.SUPER_ADMIN) return true;
    if (
      this.reflector.getAllAndOverride<boolean>(ALLOW_READ_ONLY_KEY, targets)
    ) {
      return true;
    }

    await this.subscriptionService.assertWritable(user.companyId);
    return true;
  }
}
