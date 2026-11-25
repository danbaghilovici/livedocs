/**
 * @realdocs:file Converts a cart into the order contract used by shipment preparation.
 *
 * Cart quantities come from the caller. Unit weights come from the
 * [product catalog](products.ts) so the caller cannot accidentally supply stale weights.
 *
 * @realdocs:tag catalog
 * @realdocs:tag order-flow
 * @realdocs:zone Catalog
 */
import type { FulfillmentOrder, Sku } from '../contracts.js';
import { findProduct } from './products.js';

/** An item and quantity requested by a customer. */
export interface CartLine {
  readonly sku: Sku;
  readonly quantity: number;
}

/**
 * Uses {@link findProduct} to add catalog weights to the requested items.
 * @param id A non-empty order ID supplied by the caller.
 * @param items Cart lines in their original order.
 * @returns A {@link FulfillmentOrder} ready for shipment preparation.
 * @throws {RangeError} The cart is empty, a quantity is invalid, or a SKU is unknown.
 * @realdocs:docId fulfillment.cart
 * @realdocs:docUses fulfillment.product
 */
export function orderFromCart(id: string, items: readonly CartLine[]): FulfillmentOrder {
  if (!id.trim() || !items.length) throw new RangeError('An order ID and at least one cart line are required');
  return {
    id,
    lines: items.map(({ sku, quantity }) => {
      const product = findProduct(sku);
      if (!product) throw new RangeError(`Unknown SKU: ${sku}`);
      if (!Number.isSafeInteger(quantity) || quantity < 1) throw new RangeError(`Invalid quantity for ${sku}`);
      return { sku, quantity, unitWeightGrams: product.unitWeightGrams };
    }),
  };
}
