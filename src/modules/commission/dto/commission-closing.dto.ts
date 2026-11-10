import { IsUUID, Matches } from "class-validator";

const DATE = /^\d{4}-\d{2}-\d{2}$/;

// Prévia do fechamento: o que está em aberto até a data de corte.
export class CommissionClosingPreviewQueryDto {
  @IsUUID(undefined, { message: "Profissional inválido" })
  professionalId!: string;

  /** Data de corte, AAAA-MM-DD no calendário da empresa. */
  @Matches(DATE, { message: "Informe a data de corte no formato AAAA-MM-DD" })
  until!: string;
}

// Fechar: a data de corte e o pagamento ao profissional (método e data).
export class CreateCommissionClosingDto extends CommissionClosingPreviewQueryDto {
  @IsUUID(undefined, { message: "Método de pagamento inválido" })
  paymentMethodId!: string;

  @Matches(DATE, {
    message: "Informe a data do pagamento no formato AAAA-MM-DD",
  })
  paidAt!: string;
}

// Fechamentos de um profissional.
export class CommissionClosingListQueryDto {
  @IsUUID(undefined, { message: "Profissional inválido" })
  professionalId!: string;
}
