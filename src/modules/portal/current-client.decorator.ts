import { createParamDecorator, ExecutionContext } from "@nestjs/common";
import type { PortalClient } from "./portal-auth.service";

// O cadastro da conta na clínica do endereço, preenchido pelo PortalAuthGuard.
export const CurrentClient = createParamDecorator(
  (_data: unknown, context: ExecutionContext): PortalClient =>
    context.switchToHttp().getRequest<{ portalClient: PortalClient }>()
      .portalClient,
);
