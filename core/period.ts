import { ValidationError } from "./types.ts";

const MONTHS = [
  "Januari",
  "Februari",
  "Maret",
  "April",
  "Mei",
  "Juni",
  "Juli",
  "Agustus",
  "September",
  "Oktober",
  "November",
  "Desember",
];

export interface PeriodInfo {
  value: string;
  start: string;
  end: string;
  label: string;
  endLabel: string;
}

export function assertValidPeriod(period: string): string {
  if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(period)) {
    throw new ValidationError(`Format periode tidak valid: "${period}". Gunakan YYYY-MM.`, "INVALID_PERIOD");
  }
  return period;
}

export function assertValidDate(date: string): string {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    throw new ValidationError(`Format tanggal tidak valid: "${date}". Gunakan YYYY-MM-DD.`, "INVALID_DATE");
  }
  const [year, month, day] = date.split("-").map(Number);
  const parsed = new Date(Date.UTC(year, month - 1, day));
  if (
    parsed.getUTCFullYear() !== year ||
    parsed.getUTCMonth() !== month - 1 ||
    parsed.getUTCDate() !== day
  ) {
    throw new ValidationError(`Tanggal kalender tidak valid: "${date}".`, "INVALID_DATE");
  }
  return date;
}

export function periodFromDate(date: string): string {
  assertValidDate(date);
  return date.slice(0, 7);
}

export function parsePeriod(value: string): PeriodInfo {
  const safe = assertValidPeriod(value);
  const [year, month] = safe.split("-").map(Number);
  const lastDay = new Date(Date.UTC(year, month, 0)).getUTCDate();
  return {
    value: safe,
    start: `${safe}-01`,
    end: `${safe}-${String(lastDay).padStart(2, "0")}`,
    label: `${MONTHS[month - 1]} ${year}`,
    endLabel: `${lastDay} ${MONTHS[month - 1]} ${year}`,
  };
}

export function comparePeriods(a: string, b: string): number {
  assertValidPeriod(a);
  assertValidPeriod(b);
  return a.localeCompare(b);
}

export function isDateInPeriod(date: string, period: string): boolean {
  const info = parsePeriod(period);
  return date >= info.start && date <= info.end;
}

export function nextPeriod(period: string): string {
  assertValidPeriod(period);
  const [year, month] = period.split("-").map(Number);
  if (month === 12) return `${year + 1}-01`;
  return `${year}-${String(month + 1).padStart(2, "0")}`;
}
