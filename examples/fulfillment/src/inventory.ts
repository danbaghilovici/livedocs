/**
 * @livedocs:file Tracks available stock and order reservations for one warehouse.
 *
 * The ledger combines duplicate line items and checks every SKU before
 * deducting stock. Releasing a reservation restores the units it held.
 *
 * @livedocs:tag inventory
 * @livedocs:zone Order operations
 */
import type { OrderLine, Reservation, Sku, StockStatus } from './contracts.js';

/**
 * Inventory rejection with a reason callers can use to report the failure.
 *
 * | Reason | Caller action |
 * | --- | --- |
 * | `invalid-order` | Correct the order lines and try again. |
 * | `already-reserved` | Use the original reservation or release it before submitting a replacement. |
 * | `insufficient-stock` | Call {@link inspectStock} and revise the requested quantities. |
 *
 * @livedocs:tag error-handling
 */
export class InventoryError extends Error {
  constructor(
    public readonly reason: 'invalid-order' | 'already-reserved' | 'insufficient-stock',
    message: string,
  ) {
    super(message);
    this.name = 'InventoryError';
  }
}

/**
 * Tracks available units and reservations for a single warehouse.
 * A reservation changes stock only after every requested SKU has been checked.
 * Use {@link inspectStock} to read availability before submitting an order.
 *
 * A successful call returns one {@link Reservation | reservation} per order ID.
 * If any requested {@link Sku | SKU} is short, the call throws an
 * {@link InventoryError} and each SKU retains its previous quantity.
 *
 * @livedocs:docId fulfillment.inventory
 * @livedocs:tag inventory
 * @livedocs:tag order-flow
 * @example
 * const warehouse = new InventoryLedger({ 'MUG-01': 12 });
 * warehouse.reserve('order-17', [{ sku: 'MUG-01', quantity: 2 }]);
 * warehouse.available('MUG-01'); // 10
 * warehouse.release('order-17');
 */
export class InventoryLedger {
  readonly #stock: Map<Sku, number>;
  readonly #reservations = new Map<string, Reservation>();

  constructor(initialStock: Readonly<Record<Sku, number>>) {
    this.#stock = new Map(Object.entries(initialStock));
    for (const [sku, quantity] of this.#stock) {
      if (!Number.isSafeInteger(quantity) || quantity < 0) {
        throw new RangeError(`Invalid starting quantity for ${sku}`);
      }
    }
  }

  available(sku: Sku): number {
    return this.#stock.get(sku) ?? 0;
  }

  reserve(orderId: string, lines: readonly Pick<OrderLine, 'sku' | 'quantity'>[]): Reservation {
    if (!lines.length) throw new InventoryError('invalid-order', 'At least one order line is required');
    if (this.#reservations.has(orderId)) throw new InventoryError('already-reserved', `Order ${orderId} already has a reservation`);

    const requested = new Map<Sku, number>();
    for (const { sku, quantity } of lines) {
      if (!Number.isSafeInteger(quantity) || quantity < 1) {
        throw new InventoryError('invalid-order', `Invalid quantity for ${sku}`);
      }
      requested.set(sku, (requested.get(sku) ?? 0) + quantity);
    }

    for (const [sku, quantity] of requested) {
      if (quantity > this.available(sku)) throw new InventoryError('insufficient-stock', `Not enough units of ${sku}`);
    }
    for (const [sku, quantity] of requested) this.#stock.set(sku, this.available(sku) - quantity);

    const reservation = Object.freeze({ orderId, units: Object.freeze(Object.fromEntries(requested)) });
    this.#reservations.set(orderId, reservation);
    return reservation;
  }

  release(orderId: string): boolean {
    const reservation = this.#reservations.get(orderId);
    if (!reservation) return false;
    for (const [sku, quantity] of Object.entries(reservation.units)) this.#stock.set(sku, this.available(sku) + quantity);
    return this.#reservations.delete(orderId);
  }
}

/**
 * Read stock from an {@link InventoryLedger} without creating a reservation.
 * The {@link StockStatus | stock status} distinguishes available units from an
 * out-of-stock SKU. The list overload keeps the order of the requested SKUs.
 * @param ledger Warehouse to query.
 * @param sku A single SKU or an ordered list of SKUs.
 * @returns One status for a single SKU, or one status per requested SKU.
 */
export function inspectStock(ledger: InventoryLedger, sku: Sku): StockStatus;
export function inspectStock(ledger: InventoryLedger, sku: readonly Sku[]): readonly StockStatus[];
export function inspectStock(ledger: InventoryLedger, sku: Sku | readonly Sku[]): StockStatus | readonly StockStatus[] {
  const inspect = (key: Sku): StockStatus => {
    const available = ledger.available(key);
    return available > 0 ? { state: 'in-stock', sku: key, available } : { state: 'out-of-stock', sku: key, available: 0 };
  };
  return typeof sku === 'string' ? inspect(sku) : sku.map(inspect);
}
