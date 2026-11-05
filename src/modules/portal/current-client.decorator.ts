import { createParamDecorator, ExecutionContext } from "@nestjs/common";
import type { PortalClient } from "./portal-auth.service";

// O cliente do portal preenchido pelo PortalAuthGuard (como o @CurrentUser da clínica).
export const CurrentClient = createParamDecorator(
  (_data: unknown, context: ExecutionContext): PortalClient =>
    context.switchToHttp().getRequest<{ portalClient: PortalClient }>()
      .portalClient,
);
