/**
 * @livedocs:file Prepares a carrier handoff from a successful checkout.
 *
 * The library builds the request in memory. The calling application owns
 * carrier submission and delivery tracking. See the [handoff guide](../../docs/delivery.md#carrier-handoff).
 *
 * @livedocs:tag shipping
 * @livedocs:zone Delivery
 */
import type { ShipmentPlan } from '../contracts.js';
import type { CheckoutResult } from '../integrations/checkout.js';
import type { Destination } from './destination.js';

/** The information the calling application needs to hand a parcel to a carrier. */
export interface DispatchRequest {
  readonly reference: string;
  readonly destination: Destination;
  readonly plan: ShipmentPlan;
}

/**
 * Packages a {@link CheckoutResult} for carrier handoff using its order ID as the reference.
 * @param checkout A successful checkout with an active reservation.
 * @returns The in-memory handoff payload.
 * @livedocs:docId fulfillment.dispatch
 */
export function createDispatchRequest(checkout: CheckoutResult): DispatchRequest {
  return { reference: checkout.order.id, destination: checkout.destination, plan: checkout.plan };
}
