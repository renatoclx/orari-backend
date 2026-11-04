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
  FEATURE_BY_PERSON_TYPE_KEY,
  FEATURE_KEY,
} from "../../common/decorators/feature.decorator";
import { AuthenticatedUser } from "../../common/interfaces/authenticated-user.interface";
import {
  PERSON_TYPE_FEATURE,
  type AccessAction,
  type FeatureKey,
} from "./access-catalog";
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
    const byPersonType = this.reflector.getAllAndOverride<boolean | undefined>(
      FEATURE_BY_PERSON_TYPE_KEY,
      targets,
    );
    if (!feature && !byPersonType) return true;

    const request = context.switchToHttp().getRequest<GuardedRequest>();
    const { user, method } = request;
    if (!user) return false;
    if (user.type === UserType.SUPER_ADMIN) return true;

    const features = feature
      ? [feature]
      : await this.featuresOfPerson(request, user.companyId);

    const action =
      this.reflector.getAllAndOverride<AccessAction | undefined>(
        FEATURE_ACTION_KEY,
        targets,
      ) ?? actionFromMethod(method);

    if (await this.hasAll(user.companyId, features, action)) return true;
    // O código permite ao front distinguir "fora do plano" de uma recusa comum.
    throw new ForbiddenException({
      statusCode: 403,
      error: "Forbidden",
      code: "FEATURE_NOT_IN_PLAN",
      message: "Esta funcionalidade não está disponível para a sua empresa",
    });
  }

  private async hasAll(
    companyId: string,
    features: FeatureKey[],
    action: AccessAction,
  ): Promise<boolean> {
    for (const feature of features) {
      if (!(await this.companyAccessService.can(companyId, feature, action))) {
        return false;
      }
    }
    return true;
  }

  /**
   * /people atende clientes, funcionários e profissionais. Vale o tipo gravado
   * (rota com `:id`) e o tipo pedido (`type` do corpo ou do filtro): quem muda o
   * tipo de uma pessoa precisa das duas funcionalidades. Sem nenhum tipo
   * reconhecido, exige as três.
   */
  private async featuresOfPerson(
    { params, body, query }: GuardedRequest,
    companyId: string,
  ): Promise<FeatureKey[]> {
    const stored = params?.id
      ? await this.companyAccessService.findPersonType(companyId, params.id)
      : undefined;
    const requested = asText(body?.type) ?? asText(query?.type);

    const features = new Set<FeatureKey>();
    for (const type of [stored, requested]) {
      // hasOwn: um `type` como "constructor" não pode virar chave do objeto.
      if (type && Object.hasOwn(PERSON_TYPE_FEATURE, type)) {
        features.add(PERSON_TYPE_FEATURE[type]);
      }
    }
    return features.size > 0
      ? [...features]
      : Object.values(PERSON_TYPE_FEATURE);
  }
}

interface GuardedRequest {
  user?: AuthenticatedUser;
  method: string;
  params?: Record<string, string>;
  body?: Record<string, unknown>;
  query?: Record<string, unknown>;
}

const asText = (value: unknown) =>
  typeof value === "string" ? value : undefined;
