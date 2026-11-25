/**
 * @realdocs:file Turns a dispatch request into a customer-facing message.
 *
 * The message summarizes the quote. Its wording describes estimated delivery,
 * since preparing a dispatch request does not submit it to a carrier.
 *
 * @realdocs:tag shipping
 * @realdocs:zone Integrations
 */
import type { DispatchRequest } from '../delivery/dispatch.js';
import { formatShippingQuote } from '../shipping.js';

/**
 * Uses {@link formatShippingQuote} to show cost and estimated transit time.
 * @param request Prepared carrier handoff data.
 * @returns Message text for the host application to present.
 * @realdocs:docId fulfillment.notification
 */
export function shipmentMessage(request: DispatchRequest): string {
  return `Order ${request.reference} for ${request.destination.postalCode}: ${formatShippingQuote(request.plan.quote)} estimated.`;
}
