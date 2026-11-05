import { createParamDecorator, ExecutionContext } from "@nestjs/common";
import type { PortalAccount } from "./portal-auth.service";

// A conta do app preenchida pelo PortalAuthGuard (como o @CurrentUser da clínica).
export const CurrentAccount = createParamDecorator(
  (_data: unknown, context: ExecutionContext): PortalAccount =>
    context.switchToHttp().getRequest<{ portalAccount: PortalAccount }>()
      .portalAccount,
);
