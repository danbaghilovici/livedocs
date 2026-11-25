/**
 * @livedocs:file Runs the host-facing checkout workflow for a cart and destination.
 *
 * Checkout resolves product weights and the rate zone before delegating to
 * [shipment preparation](../fulfillment.ts#doc-fulfillment.prepare). Read the
 * [integration walkthrough](../../docs/integrations.md#checkout-to-handoff) for the full request path.
 *
 * @livedocs:tag order-flow
 * @livedocs:zone Integrations
 */
import { orderFromCart, type CartLine } from '../catalog/orders.js';
import type { FulfillmentOrder, ShipmentPlan } from '../contracts.js';
import { classifyDestination, type Destination } from '../delivery/destination.js';
import { prepareShipment } from '../fulfillment.js';
import type { InventoryLedger } from '../inventory.js';

/** An accepted order, its destination, and the quote and reservation it produced. */
export interface CheckoutResult {
  readonly order: FulfillmentOrder;
  readonly destination: Destination;
  readonly plan: ShipmentPlan;
}

/**
 * Builds and reserves an order using {@link orderFromCart}, {@link classifyDestination}, and {@link prepareShipment}.
 * @param ledger Warehouse holding the products.
 * @param orderId Order reference supplied by the caller.
 * @param items Requested cart lines.
 * @param postalCode Delivery postal code.
 * @returns The order, destination, quote, and reservation needed by the caller.
 * @livedocs:docId fulfillment.checkout
 * @livedocs:docUses fulfillment.cart
 * @livedocs:docUses fulfillment.destination
 * @livedocs:docUses fulfillment.prepare
 */
export function checkout(ledger: InventoryLedger, orderId: string, items: readonly CartLine[], postalCode: string): CheckoutResult {
  const order = orderFromCart(orderId, items);
  const destination = classifyDestination(postalCode);
  const plan = prepareShipment(ledger, order, destination.zone);
  return { order, destination, plan };
}
