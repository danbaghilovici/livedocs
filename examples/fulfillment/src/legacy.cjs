/**
 * @livedocs:file CommonJS shipping entry point for integrations that use flat zone fees.
 *
 * Returns a fixed fee in cents for a destination zone. New integrations can
 * use the weight-based shipping API for a parcel quote and transit estimate.
 *
 * @livedocs:tag shipping
 * @livedocs:tag legacy
 * @livedocs:zone Compatibility
 */

/**
 * Returns the old flat shipping fee for a zone.
 * @param {import('./contracts.js').ShippingZone} zone Destination area.
 * @returns {number} Flat fee in cents.
 * @deprecated Use weight-based quotes for new orders.
 */
module.exports = function legacyShippingCents(zone) {
  return zone === 'local' ? 450 : 725;
};
