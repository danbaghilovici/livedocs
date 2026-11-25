/**
 * @livedocs:file Calculates parcel prices and transit estimates for local and regional delivery.
 *
 * Each zone has a base fee and a per-kilogram rate. Billable weight rounds up
 * to the next kilogram, and quotes use integer cents before display formatting.
 *
 * | Zone | Base fee | Per billable kg | Transit estimate |
 * | --- | --- | --- | --- |
 * | `local` | 450 cents | 120 cents | 2 business days |
 * | `regional` | 725 cents | 180 cents | 4 business days |
 *
 * @livedocs:tag shipping
 * @livedocs:zone Delivery
 */
const rates = /** @type {const} */ ({
  local: { baseCents: 450, kilogramCents: 120, businessDays: 2 },
  regional: { baseCents: 725, kilogramCents: 180, businessDays: 4 },
});

/**
 * Prices a parcel by rounding its billable weight up to the next kilogram.
 * The returned quote can be displayed with {@link formatShippingQuote}.
 * @param {import('./contracts.js').ShippingZone} zone Destination area.
 * @param {number} weightGrams Total parcel weight in whole grams.
 * @returns {import('./contracts.js').ShippingQuote} Cost in cents and estimated transit time.
 * @throws {RangeError} The weight is outside the supported range of 1 to 30,000 grams.
 * @livedocs:docId fulfillment.quote
 * @livedocs:tag shipping
 * @livedocs:tag pricing
 * @example
 * quoteShipping('regional', 1_250); // { zone: 'regional', cents: 1085, businessDays: 4 }
 */
export function quoteShipping(zone, weightGrams) {
  if (!Number.isSafeInteger(weightGrams) || weightGrams < 1 || weightGrams > 30_000) {
    throw new RangeError('Parcel weight must be between 1 and 30,000 grams');
  }
  const rate = rates[zone];
  if (!rate) throw new RangeError(`Unknown shipping zone: ${zone}`);
  return { zone, cents: rate.baseCents + Math.ceil(weightGrams / 1_000) * rate.kilogramCents, businessDays: rate.businessDays };
}

/**
 * Formats the cost and transit time returned by {@linkcode quoteShipping} for display in USD.
 * Keep the original quote for calculations and use the formatted summary in customer-facing copy.
 * @param {import('./contracts.js').ShippingQuote} quote A calculated shipping quote.
 * @returns {string} A summary such as "$10.85 · 4 business days".
 */
export function formatShippingQuote(quote) {
  const dollars = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(quote.cents / 100);
  return `${dollars} · ${quote.businessDays} business days`;
}
