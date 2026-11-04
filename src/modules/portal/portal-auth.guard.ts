import {
  CanActivate,
  ExecutionContext,
  Injectable,
  UnauthorizedException,
} from "@nestjs/common";
import { PortalAuthService, PortalClient } from "./portal-auth.service";

interface PortalRequest {
  headers: { authorization?: string };
  params: { slug?: string };
  portalClient?: PortalClient;
}

/**
 * Rotas do portal que exigem o cliente entrado. Aceita só o token do portal
 * (opaco, conferido no banco); o JWT do login da clínica não vale aqui, e o token
 * do portal não vale nas rotas da clínica (lá o JwtAuthGuard o recusa).
 */
@Injectable()
export class PortalAuthGuard implements CanActivate {
  constructor(private readonly portalAuthService: PortalAuthService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<PortalRequest>();
    const [scheme, token] = request.headers.authorization?.split(" ") ?? [];
    if (scheme !== "Bearer" || !token || !request.params.slug) {
      throw new UnauthorizedException();
    }
    request.portalClient = await this.portalAuthService.authenticate(
      request.params.slug,
      token,
    );
    return true;
  }
}
