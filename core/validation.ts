import { assertValidDate, periodFromDate } from "./period.ts";
import type { Account, AccountingPeriod, JournalLine } from "./types.ts";
import { ClosedPeriodError, ValidationError } from "./types.ts";

export function assertPositiveInteger(value: number, fieldName: string): number {
  if (!Number.isFinite(value) || !Number.isInteger(value) || value <= 0) {
    throw new ValidationError(`${fieldName} harus berupa bilangan bulat lebih dari 0.`);
  }
  return value;
}

export function assertNonNegativeNumber(value: number, fieldName: string): number {
  if (!Number.isFinite(value) || value < 0) {
    throw new ValidationError(`${fieldName} tidak boleh bernilai negatif.`);
  }
  return value;
}

export function assertPositiveNumber(value: number, fieldName: string): number {
  if (!Number.isFinite(value) || value <= 0) {
    throw new ValidationError(`${fieldName} harus lebih dari 0.`);
  }
  return value;
}

export function assertNonEmptyText(value: string | undefined | null, fieldName: string): string {
  const trimmed = String(value ?? "").trim();
  if (!trimmed) {
    throw new ValidationError(`${fieldName} wajib diisi.`);
  }
  return trimmed;
}

export function validateJournalLines(
  lines: JournalLine[],
  accountMap: Record<string, Account>,
): { totalDebit: number; totalCredit: number } {
  if (!Array.isArray(lines) || lines.length < 2) {
    throw new ValidationError("Jurnal double-entry minimal harus memiliki 2 baris.", "UNBALANCED_JOURNAL");
  }

  let totalDebit = 0;
  let totalCredit = 0;

  for (let index = 0; index < lines.length; index++) {
    const line = lines[index];
    const account = accountMap[line.accountCode];
    if (!account || !account.active) {
      throw new ValidationError(`Akun "${line.accountCode}" tidak ditemukan atau nonaktif pada baris #${index + 1}.`, "INVALID_ACCOUNT");
    }

    const debit = Number(line.debit ?? 0);
    const credit = Number(line.credit ?? 0);

    if (!Number.isFinite(debit) || !Number.isFinite(credit) || !Number.isInteger(debit) || !Number.isInteger(credit)) {
      throw new ValidationError(`Nominal debit/kredit pada baris #${index + 1} harus bilangan bulat Rupiah.`, "INVALID_AMOUNT");
    }
    if (debit < 0 || credit < 0) {
      throw new ValidationError(`Nominal debit/kredit tidak boleh negatif pada baris #${index + 1}.`, "INVALID_AMOUNT");
    }
    if (debit > 0 && credit > 0) {
      throw new ValidationError(`Baris #${index + 1} tidak boleh mengisi debit dan kredit sekaligus.`, "INVALID_JOURNAL_LINE");
    }
    if (debit === 0 && credit === 0) {
      throw new ValidationError(`Baris #${index + 1} harus memiliki nilai debit atau kredit lebih dari nol.`, "ZERO_JOURNAL_LINE");
    }

    totalDebit += debit;
    totalCredit += credit;
  }

  if (totalDebit <= 0 || totalDebit !== totalCredit) {
    throw new ValidationError(
      `Jurnal tidak seimbang: Debit (${totalDebit}) != Kredit (${totalCredit}).`,
      "UNBALANCED_JOURNAL",
    );
  }

  return { totalDebit, totalCredit };
}

export function assertPeriodOpen(date: string, periods: AccountingPeriod[]): string {
  assertValidDate(date);
  const period = periodFromDate(date);
  const record = periods.find((item) => item.period === period);
  if (record && record.status === "closed") {
    throw new ClosedPeriodError(`Periode ${period} sudah ditutup. Transaksi baru atau pembatalan tidak dapat diposting ke periode tertutup.`);
  }
  return period;
}
