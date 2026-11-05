import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  Headers,
  HttpCode,
  Param,
  Patch,
  Post,
  Put,
  Query,
  UploadedFile,
  UseGuards,
  UseInterceptors,
} from "@nestjs/common";
import { FileInterceptor } from "@nestjs/platform-express";
import { ThrottlerGuard } from "@nestjs/throttler";
import {
  ApiBearerAuth,
  ApiBody,
  ApiConsumes,
  ApiOperation,
  ApiTags,
  ApiTooManyRequestsResponse,
} from "@nestjs/swagger";
import { Public } from "../../common/decorators/public.decorator";
import { CurrentAccount } from "./current-account.decorator";
import { ChangePasswordDto } from "./dto/change-password.dto";
import { LoginDto } from "./dto/login.dto";
import { RegisterDto } from "./dto/register.dto";
import { FindCityQueryDto, UpdateProfileDto } from "./dto/update-profile.dto";
import { PortalAuthGuard } from "./portal-auth.guard";
import { PortalAuthService, type PortalAccount } from "./portal-auth.service";
import { PortalPlaceService } from "./portal-place.service";
import { PortalProfileService } from "./portal-profile.service";

// Foto da conta: o mesmo limite da foto das pessoas (o app reduz antes de enviar).
const MAX_PHOTO_BYTES = 2 * 1024 * 1024;

// Conta do cliente no app, fora do login da clínica (@Public para o
// JwtAuthGuard). Fica em /portal-account, e não em /portal, para não disputar
// o endereço com o /portal/:slug de cada clínica.
@ApiTags("Portal do cliente")
@Public()
@Controller("portal-account")
export class PortalAccountController {
  constructor(
    private readonly portalAuthService: PortalAuthService,
    private readonly portalPlaceService: PortalPlaceService,
    private readonly portalProfileService: PortalProfileService,
  ) {}

  @Post("register")
  @UseGuards(ThrottlerGuard)
  @ApiTooManyRequestsResponse({ description: "Pedidos demais; aguarde." })
  @ApiOperation({
    summary: "Cria a conta do cliente (telefone + senha) e abre a sessão",
    description:
      "Telefone já usado por outra conta: 409. A conta nasce sem nenhum estabelecimento ligado. Devolve o token do portal (90 dias) uma única vez.",
  })
  register(
    @Body() dto: RegisterDto,
    @Headers("user-agent") userAgent?: string,
  ) {
    return this.portalAuthService.register(dto, userAgent);
  }

  @Post("login")
  @HttpCode(200)
  @UseGuards(ThrottlerGuard)
  @ApiTooManyRequestsResponse({ description: "Tentativas demais; aguarde." })
  @ApiOperation({
    summary: "Entra com telefone e senha (sessão de 90 dias neste aparelho)",
    description: "Telefone sem conta ou senha errada: o mesmo 401.",
  })
  login(@Body() dto: LoginDto, @Headers("user-agent") userAgent?: string) {
    return this.portalAuthService.login(dto, userAgent);
  }

  @Get()
  @UseGuards(PortalAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({
    summary: "A conta entrada e os estabelecimentos dela",
    description:
      "`places` traz só os estabelecimentos com o portal aberto, em ordem alfabética, cada um com `slug`, nome, logo e fuso.",
  })
  me(@CurrentAccount() account: PortalAccount) {
    return this.portalAuthService.me(account);
  }

  @Get("appointments")
  @UseGuards(PortalAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({
    summary: "Agendamentos da conta em todos os estabelecimentos",
    description:
      "`upcoming` (do mais perto ao mais longe) e `past` (os 20 mais recentes). Cada item é o da lista de um estabelecimento, com `place` (slug, nome, logo e fuso).",
  })
  appointments(@CurrentAccount() account: PortalAccount) {
    return this.portalPlaceService.appointments(account);
  }

  @Get("plans")
  @UseGuards(PortalAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({
    summary: "Pacotes contratados em todos os estabelecimentos (só para ver)",
    description:
      "Plano, período (`startDate`/`endDate`, aaaa-mm-dd), `status` (active, finished ou cancelled) e `place`. Sem valores. Ativos primeiro.",
  })
  plans(@CurrentAccount() account: PortalAccount) {
    return this.portalPlaceService.plans(account);
  }

  @Get("recurrences")
  @UseGuards(PortalAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({
    summary: "Recorrências em vigor em todos os estabelecimentos (só para ver)",
    description:
      "Horários fixos, de pacote (`kind` PLAN) e de turma (CLASS): serviço, profissional, `days` (weekDay, startTime e endTime em HH:MM), período e `place`. Quem marca e muda é a clínica.",
  })
  recurrences(@CurrentAccount() account: PortalAccount) {
    return this.portalPlaceService.recurrences(account);
  }

  @Post("places/:subdomain")
  @HttpCode(200)
  @UseGuards(PortalAuthGuard, ThrottlerGuard)
  @ApiBearerAuth()
  @ApiOperation({
    summary: "Entra sozinho num estabelecimento",
    description:
      "Cria um cadastro novo de cliente com o nome e o telefone da conta, marcado como não confirmado (até a clínica confirmar, no máximo 2 agendamentos futuros pelo app). Nunca junta com um cadastro existente. Já sendo cliente: `joined: false`. Portal fechado: 404.",
  })
  join(
    @CurrentAccount() account: PortalAccount,
    @Param("subdomain") subdomain: string,
  ) {
    return this.portalPlaceService.join(account, subdomain);
  }

  @Get("profile")
  @UseGuards(PortalAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({
    summary: "Meus dados: o cadastro da conta",
    description:
      "Nome, telefone, e-mail, CPF, nascimento, profissão, foto e o endereço principal (`address` nulo sem endereço).",
  })
  profile(@CurrentAccount() account: PortalAccount) {
    return this.portalProfileService.get(account);
  }

  @Put("profile")
  @UseGuards(PortalAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({
    summary: "Salva Meus dados e copia para o cadastro em cada clínica",
    description:
      "Substitui tudo (campo opcional que não vem fica vazio). Copia nome, CPF, nascimento, profissão, telefone e e-mail (contato principal) e o endereço principal para o cadastro do cliente em cada clínica; sem endereço, o da clínica fica. Trocar o telefone pede `currentPassword` (400). CPF em outro cadastro de uma das clínicas ou telefone de outra conta: 409, sem salvar nada.",
  })
  updateProfile(
    @CurrentAccount() account: PortalAccount,
    @Body() dto: UpdateProfileDto,
  ) {
    return this.portalProfileService.update(account, dto);
  }

  @Get("city")
  @UseGuards(PortalAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({
    summary: "Cidade pelo nome e pela UF (o app preenche o endereço pelo CEP)",
    description: "`?name=Belo Horizonte&state=MG`. Não achou: 404.",
  })
  city(@Query() query: FindCityQueryDto) {
    return this.portalProfileService.findCity(query.name, query.state);
  }

  @Post("photo")
  @UseGuards(PortalAuthGuard)
  @UseInterceptors(
    FileInterceptor("photo", { limits: { fileSize: MAX_PHOTO_BYTES } }),
  )
  @ApiBearerAuth()
  @ApiConsumes("multipart/form-data")
  @ApiBody({
    schema: {
      type: "object",
      required: ["photo"],
      properties: { photo: { type: "string", format: "binary" } },
    },
  })
  @ApiOperation({
    summary:
      "Troca a foto da conta e a de cada clínica (JPEG ou PNG, até 2 MB)",
  })
  uploadPhoto(
    @CurrentAccount() account: PortalAccount,
    @UploadedFile() file: Express.Multer.File | undefined,
  ) {
    if (!file) throw new BadRequestException("Envie a foto no campo photo");
    return this.portalProfileService.updatePhoto(account, file.buffer);
  }

  @Delete("photo")
  @HttpCode(204)
  @UseGuards(PortalAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: "Tira a foto da conta e a de cada clínica" })
  removePhoto(@CurrentAccount() account: PortalAccount) {
    return this.portalProfileService.removePhoto(account);
  }

  @Patch("password")
  @HttpCode(204)
  @UseGuards(PortalAuthGuard, ThrottlerGuard)
  @ApiBearerAuth()
  @ApiOperation({
    summary: "Troca a senha conferindo a atual",
    description:
      "Senha atual errada: 400. Os outros aparelhos saem; este continua entrado.",
  })
  changePassword(
    @CurrentAccount() account: PortalAccount,
    @Body() dto: ChangePasswordDto,
  ) {
    return this.portalAuthService.changePassword(account, dto);
  }

  @Post("logout")
  @HttpCode(204)
  @UseGuards(PortalAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: "Sai do app neste aparelho" })
  logout(@CurrentAccount() account: PortalAccount) {
    return this.portalAuthService.logout(account);
  }
}
