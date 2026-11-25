/**
 * @realdocs:file Shared contracts for orders, inventory reservations, and shipping quotes.
 *
 * Quantities are in whole units, weights are in grams, and shipping costs are
 * in cents. The same contracts are used by the TypeScript and JavaScript APIs.
 *
 * @realdocs:tag order-flow
 * @realdocs:zone Data contracts
 */

/** Inventory key for a single sellable item. */
export type Sku = string;

/** One line in a {@link FulfillmentOrder}. Quantity counts units of one {@link Sku} and weight is per unit in grams. */
export interface OrderLine {
  readonly sku: Sku;
  readonly quantity: number;
  readonly unitWeightGrams: number;
}

/** Goods to fulfill as a single shipment. Multiple {@link OrderLine | order lines} can share a {@link Sku}. */
export interface FulfillmentOrder {
  readonly id: string;
  readonly lines: readonly OrderLine[];
}

/** Number of units that can still be reserved for a SKU. */
export type StockStatus =
  | { readonly state: 'in-stock'; readonly sku: Sku; readonly available: number }
  | { readonly state: 'out-of-stock'; readonly sku: Sku; readonly available: 0 };

/** Units held for a {@link FulfillmentOrder}. Quantities are grouped by {@link Sku}. */
export interface Reservation {
  readonly orderId: string;
  readonly units: Readonly<Record<Sku, number>>;
}

/** Delivery area used to select a shipping rate. */
export type ShippingZone = 'local' | 'regional';

/** Shipping cost in cents and estimated transit time in business days for a {@link ShippingZone}. */
export interface ShippingQuote {
  readonly zone: ShippingZone;
  readonly cents: number;
  readonly businessDays: number;
}

/** A completed plan combines a stock {@link Reservation} with a {@link ShippingQuote} for the same order. */
export interface ShipmentPlan {
  readonly reservation: Reservation;
  readonly quote: ShippingQuote;
}
