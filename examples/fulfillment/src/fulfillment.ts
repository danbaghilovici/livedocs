/**
 * @livedocs:file Coordinates the shipment workflow from order lines to a reservation and quote.
 *
 * The workflow validates quantities and parcel weight, prices the shipment,
 * and then reserves inventory. Callers receive both the quote and the reservation.
 * See [failure and retry](../docs/architecture.md#failure-and-retry) for caller guidance.
 *
 * ## Components inside the order application process
 *
 * This view focuses on shipment preparation in the Order application process.
 * Checkout hands off the validated inputs. The shipment coordinator requests
 * a quote before asking the inventory ledger to reserve stock. The
 * [integration sequence](../docs/integrations.md#checkout-to-handoff) shows the wider workflow.
 *
 * ```mermaid
 * C4Component
 * title Components - Shipment preparation in the Order application process
 * Container_Boundary(runtime, "Order application process") {
 *   Component(checkout, "Checkout workflow", "TypeScript", "Builds orders from carts and classifies destinations")
 *   Component(coordinator, "Shipment coordinator", "TypeScript", "Validates orders, gets a quote, and reserves stock")
 *   Component(pricing, "Shipping calculator", "JavaScript", "Quotes cost and transit time")
 *   Component(stock, "Inventory ledger", "TypeScript", "Holds stock for accepted orders")
 * }
 * Rel(checkout, coordinator, "Passes order")
 * Rel(coordinator, pricing, "Requests a parcel quote")
 * Rel(coordinator, stock, "Reserves the requested items")
 * UpdateRelStyle(checkout, coordinator, $offsetX="-65", $offsetY="-20")
 * UpdateLayoutConfig($c4ShapeInRow="2", $c4BoundaryInRow="1")
 * {{ diagram.link('checkout', 'fulfillment.checkout') }}
 * {{ diagram.link('coordinator', 'fulfillment.prepare') }}
 * {{ diagram.link('pricing', 'fulfillment.quote') }}
 * {{ diagram.link('stock', 'fulfillment.inventory') }}
 * ```
 *
 * **Diagram key.** The dashed outline marks the Node.js container. Each box is
 * a component with a defined responsibility. Arrows point from callers to
 * components they call. Implementation links lead to the corresponding code reference.
 *
 * ## Shipment workflow
 *
 * ```mermaid
 * flowchart TD
 *   Order([Order received]) --> Validate{Are the order lines valid?}
 *   Validate -->|No| Invalid[Throw an invalid-order error]
 *   Validate -->|Yes| Quote[Validate the parcel and calculate shipping]
 *   Quote -->|Rejected| ShippingError[Throw a shipping error]
 *   Quote -->|Quote ready| Reserve[Reserve stock]
 *   Reserve -->|Rejected| InventoryError[Throw an inventory error]
 *   Reserve -->|Reserved| Plan([Return the quote and reservation])
 * ```
 *
 * @livedocs:tag architecture
 * @livedocs:tag order-flow
 * @livedocs:zone Order operations
 */
import type { FulfillmentOrder, ShipmentPlan, ShippingZone } from './contracts.js';
import { InventoryError, InventoryLedger, type inspectStock } from './inventory.js';
import { quoteShipping, type formatShippingQuote } from './shipping.js';

/**
 * Prices a shipment and reserves its items in an {@link InventoryLedger}.
 * The {@link quoteShipping | shipping quote} is validated before stock is reserved.
 * Callers can use the reason on an {@link InventoryError} to report a rejected order.
 *
 * ### Request and response
 *
 * 1. Supply a {@link FulfillmentOrder | fulfillment order} with one or more lines and a {@link ShippingZone | delivery zone}.
 * 2. The {@link quoteShipping | shipping calculator} prices the total parcel weight. A pricing failure leaves the ledger untouched.
 * 3. The {@link InventoryLedger | inventory ledger} combines quantities for repeated SKUs and reserves the full order.
 * 4. The resulting {@link ShipmentPlan | shipment plan} includes the reservation and quote. Use {@link formatShippingQuote | the quote formatter} to present the estimate to a customer.
 *
 * ### Handling a rejected order
 *
 * An {@link InventoryError} exposes a `reason` for invalid order lines, duplicate
 * reservations, and insufficient stock. The caller can use {@link inspectStock}
 * to check current availability before retrying with a revised order.
 *
 * @param inventory Warehouse holding the order's goods.
 * @param order Items to ship in one parcel.
 * @param zone Destination area for pricing and transit estimates.
 * @returns The combined {@link ShipmentPlan}.
 * @throws {InventoryError} An order line is invalid or the order cannot be reserved.
 * @throws {RangeError} The parcel exceeds the shipping service's weight limits.
 * @livedocs:docId fulfillment.prepare
 * @livedocs:docUses fulfillment.quote
 * @livedocs:docUses fulfillment.inventory
 * @livedocs:tag order-flow
 * @livedocs:tag error-handling
 * @example
 * const inventory = new InventoryLedger({ 'MUG-01': 12, 'TEA-02': 6 });
 * const plan = prepareShipment(inventory, {
 *   id: 'order-17',
 *   lines: [
 *     { sku: 'MUG-01', quantity: 2, unitWeightGrams: 450 },
 *     { sku: 'TEA-02', quantity: 1, unitWeightGrams: 350 },
 *   ],
 * }, 'regional');
 * plan.quote.cents; // 1085
 */
export function prepareShipment(inventory: InventoryLedger, order: FulfillmentOrder, zone: ShippingZone): ShipmentPlan {
  if (!order.lines.length) throw new InventoryError('invalid-order', 'At least one order line is required');
  let weightGrams = 0;
  for (const { sku, quantity, unitWeightGrams } of order.lines) {
    if (!Number.isSafeInteger(quantity) || quantity < 1 || !Number.isSafeInteger(unitWeightGrams) || unitWeightGrams < 1) {
      throw new InventoryError('invalid-order', `Invalid quantity or unit weight for ${sku}`);
    }
    weightGrams += quantity * unitWeightGrams;
  }
  const quote = quoteShipping(zone, weightGrams);
  const reservation = inventory.reserve(order.id, order.lines);
  return { quote, reservation };
}
