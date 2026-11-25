/**
 * @livedocs:file Classifies a destination into one of the sample rate zones.
 *
 * The demo treats postal prefixes 100, 101, and 102 as local. All other
 * five-digit codes are regional. See the [pricing guide](../../docs/delivery.md#rate-selection).
 *
 * @livedocs:tag shipping
 * @livedocs:zone Delivery
 */
import type { ShippingZone } from '../contracts.js';

/** Postal code and the example rate zone it belongs to. */
export interface Destination {
  readonly postalCode: string;
  readonly zone: ShippingZone;
}

/**
 * Normalizes a postal code for pricing and dispatch.
 * @param postalCode Five-digit postal code, with optional surrounding spaces.
 * @returns The postal code and rate zone.
 * @throws {RangeError} The code does not have exactly five digits.
 * @livedocs:docId fulfillment.destination
 */
export function classifyDestination(postalCode: string): Destination {
  const code = postalCode.trim();
  if (!/^\d{5}$/.test(code)) throw new RangeError('Expected a five-digit postal code');
  return { postalCode: code, zone: /^10[012]/.test(code) ? 'local' : 'regional' };
}
