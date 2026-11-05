import {
  CanActivate,
  ExecutionContext,
  Injectable,
  UnauthorizedException,
} from "@nestjs/common";
import {
  PortalAuthService,
  type PortalAccount,
  type PortalClient,
} from "./portal-auth.service";

interface PortalRequest {
  headers: { authorization?: string };
  params: { slug?: string };
  portalAccount?: PortalAccount;
  portalClient?: PortalClient;
}

/** Token do portal do cabeçalho Authorization ("Bearer <token>"), se houver. */
export function bearerToken(request: PortalRequest): string | undefined {
  const [scheme, token] = request.headers.authorization?.split(" ") ?? [];
  return scheme === "Bearer" && token ? token : undefined;
}

/**
 * Rotas do app que exigem a conta entrada. Aceita só o token do portal (opaco,
 * conferido no banco); o JWT do login da clínica não vale aqui, e o token do
 * portal não vale nas rotas da clínica (lá o JwtAuthGuard o recusa). Nas rotas
 * de um local (`/portal/:slug/...`), também encontra o cadastro da conta nessa
 * clínica.
 */
@Injectable()
export class PortalAuthGuard implements CanActivate {
  constructor(private readonly portalAuthService: PortalAuthService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<PortalRequest>();
    const token = bearerToken(request);
    if (!token) throw new UnauthorizedException();

    request.portalAccount = await this.portalAuthService.authenticate(token);
    if (request.params.slug) {
      request.portalClient = await this.portalAuthService.resolveClient(
        request.portalAccount,
        request.params.slug,
      );
    }
    return true;
  }
}
