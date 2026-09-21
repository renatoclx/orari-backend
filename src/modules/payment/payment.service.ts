import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import { Decimal } from "../../../generated/prisma/internal/prismaNamespace";
import { Payment, Prisma } from "../../../generated/prisma/client";
import { PaymentStatus } from "../../../generated/prisma/enums";
import { PaginatedResult } from "../../common/interfaces/paginated-result.interface";
import { isUniqueConstraintViolation } from "../../prisma/prisma-errors";
import { PrismaService } from "../../prisma/prisma.service";
import { AppointmentService } from "../appointment/appointment.service";
import { PaymentMethodService } from "../payment-method/payment-method.service";
import { ServiceService } from "../service/service.service";
import { CreatePaymentDto } from "./dto/create-payment.dto";
import { FindPaymentsQueryDto } from "./dto/find-payments-query.dto";
import { UpdatePaymentDto } from "./dto/update-payment.dto";

/**
 * O pagamento não guarda a empresa: ela vem do agendamento. O filtro pela relação
 * `appointment` é um JOIN de leitura que restringe o pagamento à empresa do
 * usuário autenticado; pagamentos de outras empresas respondem 404.
 */
const ownedByCompany = (companyId: string) => ({
  appointment: { companyId },
});

@Injectable()
export class PaymentService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly appointmentService: AppointmentService,
    private readonly paymentMethodService: PaymentMethodService,
    private readonly serviceService: ServiceService,
  ) {}

  async create(dto: CreatePaymentDto, companyId: string): Promise<Payment> {
    // Ambos validam empresa e existência, lançando 404 quando não pertencem a ela.
    const appointment = await this.appointmentService.findOne(
      dto.appointmentId,
      companyId,
    );
    await this.paymentMethodService.findOne(dto.paymentMethodId, companyId);

    const status = dto.status ?? PaymentStatus.PENDING;
    this.ensurePaidAtMatchesStatus(status, dto.paidAt);
    const amount = await this.resolveAmount(
      dto.amount,
      appointment.serviceId,
      companyId,
    );

    try {
      return await this.prisma.payment.create({
        data: { ...dto, amount, status },
      });
    } catch (error) {
      throw this.mapUniqueViolation(error);
    }
  }

  async findAll(
    {
      page,
      limit,
      status,
      appointmentId,
      paymentMethodId,
    }: FindPaymentsQueryDto,
    companyId: string,
  ): Promise<PaginatedResult<Payment>> {
    const where: Prisma.PaymentWhereInput = {
      ...ownedByCompany(companyId),
      deletedAt: null,
      status,
      appointmentId,
      paymentMethodId,
    };

    const [items, total] = await this.prisma.$transaction([
      this.prisma.payment.findMany({
        where,
        orderBy: { createdAt: "desc" },
        skip: (page - 1) * limit,
        take: limit,
      }),
      this.prisma.payment.count({ where }),
    ]);

    return { items, total, page, limit };
  }

  async findOne(id: string, companyId: string): Promise<Payment> {
    const payment = await this.prisma.payment.findFirst({
      where: { id, deletedAt: null, ...ownedByCompany(companyId) },
    });

    if (!payment) {
      throw new NotFoundException("Pagamento não encontrado");
    }

    return payment;
  }

  async update(
    id: string,
    dto: UpdatePaymentDto,
    companyId: string,
  ): Promise<Payment> {
    const payment = await this.findOne(id, companyId);

    if (dto.paymentMethodId) {
      await this.paymentMethodService.findOne(dto.paymentMethodId, companyId);
    }

    // Estado final do pagamento, considerando o que veio no PATCH.
    const status = dto.status ?? payment.status;

    // Sair de PAID limpa a data do pagamento, então a data atual não conta na
    // validação: só reclama se o próprio PATCH tentar informar uma data.
    const clearsPaidAt = status !== PaymentStatus.PAID;
    const paidAt = clearsPaidAt
      ? (dto.paidAt ?? null)
      : (dto.paidAt ?? payment.paidAt);
    this.ensurePaidAtMatchesStatus(status, paidAt);

    return this.prisma.payment.update({
      where: { id },
      data: { ...dto, paidAt, updatedAt: new Date() },
    });
  }

  async remove(id: string, companyId: string): Promise<void> {
    await this.findOne(id, companyId);

    const now = new Date();
    await this.prisma.payment.update({
      where: { id },
      data: { deletedAt: now, updatedAt: now },
    });
  }

  /**
   * Valor do pagamento: o informado ou, na ausência, o preço do serviço do
   * agendamento. Serviço sem preço exige o valor no payload.
   */
  private async resolveAmount(
    amount: number | undefined,
    serviceId: string,
    companyId: string,
  ): Promise<number | Decimal> {
    if (amount !== undefined) {
      return amount;
    }

    const service = await this.serviceService.findOne(serviceId, companyId);
    if (service.price === null) {
      throw new BadRequestException(
        "amount é obrigatório porque o serviço não possui preço",
      );
    }

    return service.price;
  }

  // Só um pagamento PAID tem data de pagamento (ver docs/business-rules.md).
  private ensurePaidAtMatchesStatus(
    status: PaymentStatus,
    paidAt?: Date | null,
  ) {
    if (status === PaymentStatus.PAID && !paidAt) {
      throw new BadRequestException(
        "paidAt é obrigatório quando o pagamento está PAID",
      );
    }

    if (status !== PaymentStatus.PAID && paidAt) {
      throw new BadRequestException(
        "paidAt só pode ser informado quando o pagamento está PAID",
      );
    }
  }

  private mapUniqueViolation(error: unknown): unknown {
    return isUniqueConstraintViolation(error)
      ? new ConflictException("Este agendamento já possui um pagamento")
      : error;
  }
}
