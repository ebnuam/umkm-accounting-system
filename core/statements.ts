import { parsePeriod } from "./period.ts";
import type { Account, JournalEntry } from "./types.ts";

export interface LedgerMovementRow {
  entryId: string;
  documentNumber: string;
  date: string;
  description: string;
  source: JournalEntry["source"];
  status: JournalEntry["status"];
  debit: number;
  credit: number;
  runningBalance: number;
}

export interface GeneralLedgerResult {
  account: Account;
  openingBalance: number;
  movements: LedgerMovementRow[];
  endingBalance: number;
}

export interface TrialBalanceRow {
  accountCode: string;
  accountName: string;
  nature: Account["nature"];
  debit: number;
  credit: number;
  netRaw: number;
}

export interface TrialBalanceResult {
  period: string;
  includeAdjustments: boolean;
  includeClosing: boolean;
  rows: TrialBalanceRow[];
  totalDebit: number;
  totalCredit: number;
  isBalanced: boolean;
}

export interface FinancialStatementsResult {
  period: string;
  periodLabel: string;
  endLabel: string;
  /** Cumulative balances through period.end (excluding closing entry of active period if preClosing=true) */
  cumulativeBalances: Record<string, number>;
  /** Activity strictly inside active period (excluding closing entries) */
  periodActivityBalances: Record<string, number>;
  revenue: number;
  cogs: number;
  grossProfit: number;
  operatingExpenses: number;
  totalExpenses: number;
  netIncome: number;
  openingCapital: number;
  capitalAdditions: number;
  drawings: number;
  endingCapital: number;
  currentAssets: number;
  fixedAssetsNet: number;
  totalAssets: number;
  totalLiabilities: number;
  unclosedPriorEarnings: number;
  totalEquity: number;
  isBalanced: boolean;
  isPeriodClosed: boolean;
}

function emptyBalanceMap(accounts: Account[]): Record<string, number> {
  return Object.fromEntries(accounts.map((account) => [account.code, 0]));
}

function accumulateEntries(
  accounts: Account[],
  entries: JournalEntry[],
): Record<string, number> {
  const balances = emptyBalanceMap(accounts);
  for (const entry of entries) {
    for (const line of entry.lines) {
      balances[line.accountCode] =
        (balances[line.accountCode] ?? 0) + (line.debit || 0) - (line.credit || 0);
    }
  }
  return balances;
}

export function sortJournalEntries(entries: JournalEntry[]): JournalEntry[] {
  return [...entries].sort(
    (a, b) =>
      a.date.localeCompare(b.date) ||
      a.createdAt.localeCompare(b.createdAt) ||
      a.id.localeCompare(b.id),
  );
}

/**
 * Computes Trial Balance cumulatively through `period.end`.
 * - Prior periods include all entries (transactions, adjustments, opnames, closings, reversals).
 * - Active period includes transactions, opnames, reversals, and optionally adjustments/closing.
 */
export function buildTrialBalance(params: {
  accounts: Account[];
  entries: JournalEntry[];
  period: string;
  includeAdjustments: boolean;
  includeClosing?: boolean;
}): TrialBalanceResult {
  const info = parsePeriod(params.period);
  const includeClosing = params.includeClosing ?? false;

  const relevant = sortJournalEntries(params.entries).filter((entry) => {
    if (entry.date > info.end) return false;
    if (entry.date < info.start) return true;
    if (entry.source === "closing" && !includeClosing) return false;
    if (entry.source === "adjustment" && !params.includeAdjustments) return false;
    return true;
  });

  const balances = accumulateEntries(params.accounts, relevant);
  let totalDebit = 0;
  let totalCredit = 0;
  const rows: TrialBalanceRow[] = [];

  for (const account of params.accounts) {
    const raw = balances[account.code] ?? 0;
    if (raw === 0) continue;
    const debit = raw > 0 ? raw : 0;
    const credit = raw < 0 ? -raw : 0;
    totalDebit += debit;
    totalCredit += credit;
    rows.push({
      accountCode: account.code,
      accountName: account.name,
      nature: account.nature,
      debit,
      credit,
      netRaw: raw,
    });
  }

  return {
    period: params.period,
    includeAdjustments: params.includeAdjustments,
    includeClosing,
    rows,
    totalDebit,
    totalCredit,
    isBalanced: totalDebit === totalCredit,
  };
}

/**
 * General Ledger for one account in a given period, carrying forward opening balance
 * from all entries dated prior to `period.start`.
 */
export function buildGeneralLedger(params: {
  accounts: Account[];
  entries: JournalEntry[];
  accountCode: string;
  period: string;
  includeClosing?: boolean;
}): GeneralLedgerResult {
  const account = params.accounts.find((a) => a.code === params.accountCode);
  if (!account) {
    throw new Error(`Account "${params.accountCode}" not found.`);
  }
  const info = parsePeriod(params.period);
  const includeClosing = params.includeClosing ?? true;
  const sorted = sortJournalEntries(params.entries);

  let openingBalance = 0;
  for (const entry of sorted) {
    if (entry.date >= info.start) break;
    for (const line of entry.lines) {
      if (line.accountCode === params.accountCode) {
        openingBalance += (line.debit || 0) - (line.credit || 0);
      }
    }
  }

  let running = openingBalance;
  const movements: LedgerMovementRow[] = [];
  for (const entry of sorted) {
    if (entry.date < info.start || entry.date > info.end) continue;
    if (!includeClosing && entry.source === "closing") continue;
    for (const line of entry.lines) {
      if (line.accountCode !== params.accountCode) continue;
      const debit = line.debit || 0;
      const credit = line.credit || 0;
      running += debit - credit;
      movements.push({
        entryId: entry.id,
        documentNumber: entry.documentNumber,
        date: entry.date,
        description: entry.description,
        source: entry.source,
        status: entry.status,
        debit,
        credit,
        runningBalance: running,
      });
    }
  }

  return {
    account,
    openingBalance,
    movements,
    endingBalance: running,
  };
}

/**
 * Builds Income Statement (period-scoped), Equity Statement (opening + period activity),
 * and Balance Sheet (cumulative real accounts + prior unclosed net income + current net income)
 * so Balance Sheet continuity holds across periods both before and after period closing.
 */
export function buildFinancialStatements(params: {
  accounts: Account[];
  entries: JournalEntry[];
  period: string;
  isPeriodClosed: boolean;
}): FinancialStatementsResult {
  const info = parsePeriod(params.period);
  const sorted = sortJournalEntries(params.entries);

  const priorEntries = sorted.filter((entry) => entry.date < info.start);
  const currentOperatingEntries = sorted.filter(
    (entry) =>
      entry.date >= info.start &&
      entry.date <= info.end &&
      entry.source !== "closing",
  );
  const cumulativePreClosingEntries = [...priorEntries, ...currentOperatingEntries];

  const priorBalances = accumulateEntries(params.accounts, priorEntries);
  const periodActivityBalances = accumulateEntries(params.accounts, currentOperatingEntries);
  const cumulativeBalances = accumulateEntries(params.accounts, cumulativePreClosingEntries);

  // Period Income Statement (strictly current period, excluding closing entries)
  const revenue = params.accounts
    .filter((a) => a.group === "revenue")
    .reduce((sum, a) => sum - (periodActivityBalances[a.code] ?? 0), 0);

  const cogs = ((periodActivityBalances["5101"] ?? 0) + (periodActivityBalances["5108"] ?? 0)) || 0;
  const totalExpenses =
    params.accounts
      .filter((a) => a.group === "expense")
      .reduce((sum, a) => sum + (periodActivityBalances[a.code] ?? 0), 0) || 0;
  const operatingExpenses = (totalExpenses - cogs) || 0;
  const grossProfit = (revenue - cogs) || 0;
  const netIncome = (revenue - totalExpenses) || 0;

  // Prior unclosed nominal earnings (0 if prior periods were properly closed)
  const priorUnclosedRevenue = params.accounts
    .filter((a) => a.group === "revenue")
    .reduce((sum, a) => sum - (priorBalances[a.code] ?? 0), 0);
  const priorUnclosedExpenses = params.accounts
    .filter((a) => a.group === "expense")
    .reduce((sum, a) => sum + (priorBalances[a.code] ?? 0), 0);
  const priorUnclosedDrawings = params.accounts
    .filter((a) => a.group === "drawing")
    .reduce((sum, a) => sum + (priorBalances[a.code] ?? 0), 0);
  const priorClosingResidual = params.accounts
    .filter((a) => a.group === "closing")
    .reduce((sum, a) => sum - (priorBalances[a.code] ?? 0), 0);
  const unclosedPriorEarnings =
    priorUnclosedRevenue - priorUnclosedExpenses - priorUnclosedDrawings + priorClosingResidual;

  // Real Equity balances carried from prior periods
  const priorRealEquity = params.accounts
    .filter((a) => a.group === "equity")
    .reduce((sum, a) => sum - (priorBalances[a.code] ?? 0), 0);

  const capitalAdditions = params.accounts
    .filter((a) => a.group === "equity")
    .reduce((sum, a) => sum - (periodActivityBalances[a.code] ?? 0), 0);

  const drawings = params.accounts
    .filter((a) => a.group === "drawing")
    .reduce((sum, a) => sum + (periodActivityBalances[a.code] ?? 0), 0);

  const openingCapital = priorRealEquity + unclosedPriorEarnings;
  const endingCapital = openingCapital + capitalAdditions + netIncome - drawings;

  // Balance Sheet (Cumulative Real Accounts through period.end)
  const currentAssets = params.accounts
    .filter((a) => a.group === "asset" && a.code.startsWith("11"))
    .reduce((sum, a) => sum + (cumulativeBalances[a.code] ?? 0), 0);

  const fixedAssetsGross = params.accounts
    .filter((a) => a.group === "asset" && !a.code.startsWith("11"))
    .reduce((sum, a) => sum + (cumulativeBalances[a.code] ?? 0), 0);
  const contraAssets = params.accounts
    .filter((a) => a.group === "contra_asset")
    .reduce((sum, a) => sum + (cumulativeBalances[a.code] ?? 0), 0);
  const fixedAssetsNet = fixedAssetsGross + contraAssets;
  const totalAssets = currentAssets + fixedAssetsNet;

  const totalLiabilities = params.accounts
    .filter((a) => a.group === "liability")
    .reduce((sum, a) => sum - (cumulativeBalances[a.code] ?? 0), 0);

  const totalEquity = endingCapital;

  return {
    period: params.period,
    periodLabel: info.label,
    endLabel: info.endLabel,
    cumulativeBalances,
    periodActivityBalances,
    revenue,
    cogs,
    grossProfit,
    operatingExpenses,
    totalExpenses,
    netIncome,
    openingCapital,
    capitalAdditions,
    drawings,
    endingCapital,
    currentAssets,
    fixedAssetsNet,
    totalAssets,
    totalLiabilities,
    unclosedPriorEarnings,
    totalEquity,
    isBalanced: totalAssets === totalLiabilities + totalEquity,
    isPeriodClosed: params.isPeriodClosed,
  };
}
