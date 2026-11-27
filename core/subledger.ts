import type { Invoice, InvoiceKind, InvoicePayment, InvoiceStatus, Party } from "./types.ts";
import { NotFoundError, OverpaymentError, ValidationError } from "./types.ts";
import { assertPositiveInteger } from "./validation.ts";

export function assertPartyMatchesKind(party: Party, kind: InvoiceKind): void {
  if (!party.active) {
    throw new ValidationError(`Pihak "${party.name}" berstatus nonaktif.`);
  }
  if (kind === "receivable" && party.type === "supplier") {
    throw new ValidationError(`"${party.name}" adalah pemasok, bukan pelanggan untuk piutang usaha.`);
  }
  if (kind === "payable" && party.type === "customer") {
    throw new ValidationError(`"${party.name}" adalah pelanggan, bukan pemasok untuk utang usaha.`);
  }
}

export function createInvoiceRecord(params: {
  id: string;
  tenantId: string;
  kind: InvoiceKind;
  invoiceNumber: string;
  party: Party;
  journalEntryId: string;
  issueDate: string;
  dueDate?: string | null;
  totalAmount: number;
  nowIso: string;
}): Invoice {
  assertPartyMatchesKind(params.party, params.kind);
  const cleanTotal = assertPositiveInteger(params.totalAmount, "Nilai faktur");

  return {
    id: params.id,
    tenantId: params.tenantId,
    kind: params.kind,
    invoiceNumber: params.invoiceNumber,
    partyId: params.party.id,
    partyName: params.party.name,
    journalEntryId: params.journalEntryId,
    issueDate: params.issueDate,
    dueDate: params.dueDate ?? null,
    totalAmount: cleanTotal,
    paidAmount: 0,
    remainingAmount: cleanTotal,
    status: "open",
    createdAt: params.nowIso,
    updatedAt: params.nowIso,
  };
}

export function applyPaymentToInvoice(params: {
  invoice: Invoice;
  expectedKind: InvoiceKind;
  partyId: string;
  paymentAmount: number;
  paymentId: string;
  journalEntryId: string;
  paymentDate: string;
  nowIso: string;
}): { updatedInvoice: Invoice; payment: InvoicePayment } {
  const { invoice } = params;
  if (invoice.kind !== params.expectedKind) {
    throw new ValidationError(
      params.expectedKind === "receivable"
        ? `Faktur "${invoice.invoiceNumber}" bukan faktur piutang.`
        : `Faktur "${invoice.invoiceNumber}" bukan faktur utang.`,
    );
  }
  if (invoice.status === "voided") {
    throw new ValidationError(`Faktur "${invoice.invoiceNumber}" sudah dibatalkan (void).`);
  }
  if (invoice.partyId !== params.partyId) {
    throw new ValidationError(
      `Faktur "${invoice.invoiceNumber}" milik "${invoice.partyName}", tidak cocok dengan pihak yang dipilih.`,
    );
  }

  const cleanAmount = assertPositiveInteger(params.paymentAmount, "Nilai pelunasan");
  if (invoice.remainingAmount <= 0 || invoice.status === "paid") {
    throw new OverpaymentError(`Faktur "${invoice.invoiceNumber}" sudah lunas.`);
  }
  if (cleanAmount > invoice.remainingAmount) {
    throw new OverpaymentError(
      `Nilai pelunasan (${cleanAmount}) melebihi sisa tagihan faktur "${invoice.invoiceNumber}" (${invoice.remainingAmount}).`,
    );
  }

  const nextPaid = invoice.paidAmount + cleanAmount;
  const nextRemaining = invoice.remainingAmount - cleanAmount;
  const nextStatus: InvoiceStatus = nextRemaining === 0 ? "paid" : "partial";

  return {
    updatedInvoice: {
      ...invoice,
      paidAmount: nextPaid,
      remainingAmount: nextRemaining,
      status: nextStatus,
      updatedAt: params.nowIso,
    },
    payment: {
      id: params.paymentId,
      tenantId: invoice.tenantId,
      invoiceId: invoice.id,
      partyId: invoice.partyId,
      journalEntryId: params.journalEntryId,
      paymentDate: params.paymentDate,
      amount: cleanAmount,
      status: "posted",
      voidedAt: null,
      createdAt: params.nowIso,
    },
  };
}

export function reversePaymentOnInvoice(
  invoice: Invoice,
  payment: InvoicePayment,
  nowIso: string,
): { updatedInvoice: Invoice; updatedPayment: InvoicePayment } {
  if (payment.status === "voided") {
    throw new ValidationError("Pembayaran sudah dibatalkan sebelumnya.");
  }
  const nextPaid = Math.max(0, invoice.paidAmount - payment.amount);
  const nextRemaining = invoice.totalAmount - nextPaid;
  const nextStatus: InvoiceStatus =
    invoice.status === "voided"
      ? "voided"
      : nextPaid === 0
        ? "open"
        : nextRemaining === 0
          ? "paid"
          : "partial";

  return {
    updatedInvoice: {
      ...invoice,
      paidAmount: nextPaid,
      remainingAmount: nextRemaining,
      status: nextStatus,
      updatedAt: nowIso,
    },
    updatedPayment: {
      ...payment,
      status: "voided",
      voidedAt: nowIso,
    },
  };
}

export function assertInvoiceCanBeVoided(invoice: Invoice, activePayments: InvoicePayment[]): void {
  const hasPostedPayments = activePayments.some(
    (p) => p.invoiceId === invoice.id && p.status === "posted",
  );
  if (hasPostedPayments || invoice.paidAmount > 0) {
    throw new ValidationError(
      `Faktur "${invoice.invoiceNumber}" sudah memiliki pembayaran aktif. Batalkan (void) transaksi pelunasan terlebih dahulu sebelum membatalkan faktur.`,
    );
  }
}

export function requireParty(parties: Party[], partyId: string): Party {
  const found = parties.find((party) => party.id === partyId);
  if (!found) {
    throw new NotFoundError(`Pelanggan/pemasok dengan ID "${partyId}" tidak ditemukan.`);
  }
  return found;
}
