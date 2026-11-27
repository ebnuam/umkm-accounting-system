import type { CostComponentPlaceholder, InventoryMovement, InventoryMovementType, Item } from "./types.ts";
import { InsufficientStockError, ValidationError } from "./types.ts";
import { assertPositiveInteger, assertPositiveNumber } from "./validation.ts";

export interface InventoryUpdateResult {
  updatedItem: Item;
  unitCost: number;
  totalCost: number;
  quantityDelta: number;
  balanceQtyAfter: number;
  balanceValueAfter: number;
  movingAverageAfter: number;
}

function roundQuantity(qty: number): number {
  return Math.round(qty * 1_000_000) / 1_000_000;
}

export function assertTrackableInventoryItem(item: Item): void {
  if (!item.trackInventory || !item.inventoryAccountCode) {
    throw new ValidationError(`Barang "${item.name}" tidak melacak persediaan perpetual.`);
  }
}

/**
 * Perpetual Moving Average receipt (purchase, opening balance, positive opname, production receipt).
 * Updates totalInventoryValue and derives movingAverageCost = totalValue / qtyOnHand.
 */
export function calculateMovingAverageReceipt(
  item: Item,
  qtyIn: number,
  totalCostIn: number,
  nowIso: string,
): InventoryUpdateResult {
  assertTrackableInventoryItem(item);
  const cleanQty = roundQuantity(assertPositiveNumber(qtyIn, "Kuantitas masuk"));
  const cleanTotal = assertPositiveInteger(totalCostIn, "Nilai total persediaan masuk");

  const nextQty = roundQuantity(item.quantityOnHand + cleanQty);
  const nextTotalValue = item.totalInventoryValue + cleanTotal;
  const nextAvg = nextQty > 0 ? nextTotalValue / nextQty : 0;
  const effectiveUnitCost = cleanTotal / cleanQty;

  return {
    updatedItem: {
      ...item,
      quantityOnHand: nextQty,
      totalInventoryValue: nextTotalValue,
      movingAverageCost: nextAvg,
      updatedAt: nowIso,
    },
    unitCost: effectiveUnitCost,
    totalCost: cleanTotal,
    quantityDelta: cleanQty,
    balanceQtyAfter: nextQty,
    balanceValueAfter: nextTotalValue,
    movingAverageAfter: nextAvg,
  };
}

/**
 * Perpetual Moving Average issue (sale COGS, raw material consumption, negative opname).
 * Guarantees zero residual value when remaining quantity reaches zero.
 */
export function calculateMovingAverageIssue(
  item: Item,
  qtyOut: number,
  nowIso: string,
): InventoryUpdateResult {
  assertTrackableInventoryItem(item);
  const cleanQty = roundQuantity(assertPositiveNumber(qtyOut, "Kuantitas keluar"));

  if (cleanQty > item.quantityOnHand + 1e-9) {
    throw new InsufficientStockError(
      `Stok "${item.name}" tidak mencukupi. Tersedia ${item.quantityOnHand} ${item.unit}, diminta ${cleanQty} ${item.unit}.`,
    );
  }

  const nextQty = roundQuantity(Math.max(0, item.quantityOnHand - cleanQty));
  const cogsTotal =
    nextQty === 0
      ? item.totalInventoryValue
      : Math.min(
          item.totalInventoryValue,
          Math.round((item.totalInventoryValue * cleanQty) / item.quantityOnHand),
        );

  const nextTotalValue = item.totalInventoryValue - cogsTotal;
  const nextAvg = nextQty > 0 ? nextTotalValue / nextQty : 0;
  const unitCost = cleanQty > 0 ? cogsTotal / cleanQty : item.movingAverageCost;

  return {
    updatedItem: {
      ...item,
      quantityOnHand: nextQty,
      totalInventoryValue: nextTotalValue,
      movingAverageCost: nextAvg,
      updatedAt: nowIso,
    },
    unitCost,
    totalCost: cogsTotal,
    quantityDelta: -cleanQty,
    balanceQtyAfter: nextQty,
    balanceValueAfter: nextTotalValue,
    movingAverageAfter: nextAvg,
  };
}

/**
 * Reverses a prior inventory movement during void/reversal.
 * - Reversing an OUT movement (sale, usage, opname_out) restores exact qty & totalCost.
 * - Reversing an IN movement (purchase, opening, opname_in, production_in) deducts exact qty & totalCost,
 *   blocking the void if current stock on hand is already lower than the receipt being reversed.
 */
export function reverseInventoryState(
  item: Item,
  originalMovement: InventoryMovement,
  nowIso: string,
): InventoryUpdateResult {
  assertTrackableInventoryItem(item);

  if (originalMovement.quantityDelta > 0) {
    // Reversing a receipt: subtract qty and exact original cost
    const qtyToRemove = roundQuantity(originalMovement.quantityDelta);
    if (qtyToRemove > item.quantityOnHand + 1e-9) {
      throw new InsufficientStockError(
        `Tidak dapat membatalkan penerimaan stok "${item.name}" karena sebagian stok sudah keluar (tersedia ${item.quantityOnHand} ${item.unit}, perlu dibatalkan ${qtyToRemove} ${item.unit}).`,
      );
    }
    const nextQty = roundQuantity(Math.max(0, item.quantityOnHand - qtyToRemove));
    if (originalMovement.totalCost > item.totalInventoryValue) {
      throw new InsufficientStockError(
        `Nilai persediaan "${item.name}" saat ini (${item.totalInventoryValue}) lebih kecil dari nilai penerimaan yang dibatalkan (${originalMovement.totalCost}).`,
      );
    }
    const nextTotalValue = nextQty === 0 ? 0 : item.totalInventoryValue - originalMovement.totalCost;
    const costRemoved = item.totalInventoryValue - nextTotalValue;
    const nextAvg = nextQty > 0 ? nextTotalValue / nextQty : 0;

    return {
      updatedItem: {
        ...item,
        quantityOnHand: nextQty,
        totalInventoryValue: nextTotalValue,
        movingAverageCost: nextAvg,
        updatedAt: nowIso,
      },
      unitCost: originalMovement.unitCost,
      totalCost: costRemoved,
      quantityDelta: -qtyToRemove,
      balanceQtyAfter: nextQty,
      balanceValueAfter: nextTotalValue,
      movingAverageAfter: nextAvg,
    };
  }

  // Reversing an issue: restore exact qty and exact original COGS
  const qtyToRestore = roundQuantity(Math.abs(originalMovement.quantityDelta));
  const nextQty = roundQuantity(item.quantityOnHand + qtyToRestore);
  const nextTotalValue = item.totalInventoryValue + originalMovement.totalCost;
  const nextAvg = nextQty > 0 ? nextTotalValue / nextQty : 0;

  return {
    updatedItem: {
      ...item,
      quantityOnHand: nextQty,
      totalInventoryValue: nextTotalValue,
      movingAverageCost: nextAvg,
      updatedAt: nowIso,
    },
    unitCost: originalMovement.unitCost,
    totalCost: originalMovement.totalCost,
    quantityDelta: qtyToRestore,
    balanceQtyAfter: nextQty,
    balanceValueAfter: nextTotalValue,
    movingAverageAfter: nextAvg,
  };
}

export function buildMovementRecord(params: {
  id: string;
  tenantId: string;
  itemId: string;
  journalEntryId: string;
  date: string;
  type: InventoryMovementType;
  result: InventoryUpdateResult;
  referenceDoc: string;
  notes?: string | null;
  reversesMovementId?: string | null;
  batchRef?: string | null;
  costComponents?: CostComponentPlaceholder[] | null;
  nowIso: string;
}): InventoryMovement {
  return {
    id: params.id,
    tenantId: params.tenantId,
    itemId: params.itemId,
    journalEntryId: params.journalEntryId,
    date: params.date,
    type: params.type,
    quantityDelta: params.result.quantityDelta,
    unitCost: params.result.unitCost,
    totalCost: params.result.totalCost,
    balanceQtyAfter: params.result.balanceQtyAfter,
    balanceValueAfter: params.result.balanceValueAfter,
    movingAverageAfter: params.result.movingAverageAfter,
    referenceDoc: params.referenceDoc,
    notes: params.notes ?? null,
    reversesMovementId: params.reversesMovementId ?? null,
    batchRef: params.batchRef ?? null,
    costComponents: params.costComponents ?? null,
    createdAt: params.nowIso,
  };
}
