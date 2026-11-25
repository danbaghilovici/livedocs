/**
 * @realdocs:file Reports availability for the items in a proposed cart.
 *
 * The report is advisory. Use [checkout](../integrations/checkout.ts#checkout) to
 * reserve units against the current ledger, and see the [warehouse guide](../../docs/warehouse.md).
 *
 * @realdocs:tag inventory
 * @realdocs:zone Warehouse support
 */
import type { CartLine } from '../catalog/orders.js';
import type { Sku } from '../contracts.js';
import { inspectStock, type InventoryLedger } from '../inventory.js';

/** Requested and available stock for one distinct SKU in a cart. */
export interface CartAvailability {
  readonly sku: Sku;
  readonly requested: number;
  readonly available: number;
  readonly shortBy: number;
}

/**
 * Combines duplicate SKUs and reads their stock through {@link inspectStock}.
 * @param ledger Warehouse to inspect.
 * @param items Validated cart lines, each with a positive integer quantity.
 * @returns One availability row for every distinct SKU, in first-seen order.
 * @realdocs:docId fulfillment.availability
 */
export function checkCartAvailability(ledger: InventoryLedger, items: readonly CartLine[]): CartAvailability[] {
  const quantities = new Map<Sku, number>();
  for (const { sku, quantity } of items) quantities.set(sku, (quantities.get(sku) ?? 0) + quantity);
  return inspectStock(ledger, [...quantities.keys()]).map(({ sku, available }) => {
    const requested = quantities.get(sku)!;
    return { sku, requested, available, shortBy: Math.max(0, requested - available) };
  });
}
