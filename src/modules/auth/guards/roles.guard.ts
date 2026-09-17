import { CanActivate, ExecutionContext, Injectable } from "@nestjs/common";
import { Reflector } from "@nestjs/core";
import { UserType } from "../../../../generated/prisma/enums";
import { IS_PUBLIC_KEY } from "../../../common/decorators/public.decorator";
import { ROLES_KEY } from "../../../common/decorators/roles.decorator";
import { AuthenticatedUser } from "../../../common/interfaces/authenticated-user.interface";

@Injectable()
export class RolesGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const targets = [context.getHandler(), context.getClass()];

    if (this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, targets)) {
      return true;
    }

    const roles = this.reflector.getAllAndOverride<UserType[] | undefined>(
      ROLES_KEY,
      targets,
    );
    if (!roles?.length) {
      return true;
    }

    const { user } = context
      .switchToHttp()
      .getRequest<{ user?: AuthenticatedUser }>();

    return !!user && roles.includes(user.type);
  }
}
