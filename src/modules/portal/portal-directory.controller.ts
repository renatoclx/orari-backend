import { Controller, Get, Query, UseGuards } from "@nestjs/common";
import { Throttle, ThrottlerGuard } from "@nestjs/throttler";
import {
  ApiOperation,
  ApiTags,
  ApiTooManyRequestsResponse,
} from "@nestjs/swagger";
import { Public } from "../../common/decorators/public.decorator";
import { AUTH_THROTTLER } from "../auth/auth-throttle";
import { SearchDirectoryQueryDto } from "./dto/search-directory-query.dto";
import { PortalDirectoryService } from "./portal-directory.service";

// Buscas por minuto e por IP: o app busca enquanto o cliente digita, então o
// limite do login (5) seria apertado demais; ainda barra a varredura em massa.
export const DIRECTORY_SEARCH_LIMIT = { limit: 60, ttl: 60_000 };

// Busca de estabelecimentos do app, sem login. Fica em /portal-directory, e não
// em /portal/search, para não disputar o endereço com o /portal/:slug.
@ApiTags("Portal do cliente")
@Public()
@Controller("portal-directory")
export class PortalDirectoryController {
  constructor(
    private readonly portalDirectoryService: PortalDirectoryService,
  ) {}

  @Get()
  @UseGuards(ThrottlerGuard)
  @Throttle({ [AUTH_THROTTLER]: DIRECTORY_SEARCH_LIMIT })
  @ApiTooManyRequestsResponse({ description: "Buscas demais; aguarde." })
  @ApiOperation({
    summary: "Busca estabelecimentos pelo nome",
    description:
      "Pelo nome fantasia ou pela razão social, sem diferença de acentos e maiúsculas (`q` com 2 a 100 caracteres). Só clínicas ativas, com o portal ligado, no plano e que escolheram aparecer na busca. Até 20, em ordem alfabética, cada uma com `slug`, nome, logo, `segment` e `city` (pode ser nula).",
  })
  search(@Query() query: SearchDirectoryQueryDto) {
    return this.portalDirectoryService.search(query.q);
  }
}
