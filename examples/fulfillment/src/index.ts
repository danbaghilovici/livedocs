/**
 * @realdocs:file Public API for reserving warehouse stock and preparing shipments.
 *
 * Use this entry point to create a warehouse, inspect stock, price shipping,
 * or prepare a full shipment. It also exposes the shared order and quote types.
 * Read the [architecture guide](../docs/architecture.md) for the request path
 * through the library and its retry behavior.
 *
 * ## System context
 *
 * The system in scope is the example host application that uses this library.
 * An integration developer supplies orders and opening stock. The application
 * prices parcels, reserves items, and prepares handoff information.
 *
 * ```mermaid
 * C4Context
 * title System context - Fulfillment application
 * Person(developer, "Integration developer", "Supplies orders and opening stock")
 * System(fulfillment, "Fulfillment application", "Prices parcels, reserves stock, and prepares carrier handoffs")
 * Rel(developer, fulfillment, "Submits orders and manages stock")
 * UpdateLayoutConfig($c4ShapeInRow="2", $c4BoundaryInRow="1")
 * ```
 *
 * **Diagram key.** The person is the integration developer. The system box
 * represents the host application. The arrow points from the actor to the system they use.
 *
 * ## Containers
 *
 * The Fulfillment application uses a single Node.js container, the Order
 * application process. It runs the library and keeps reservations in memory.
 * Each ledger instance holds the stock and reservations for one warehouse.
 *
 * ```mermaid
 * C4Container
 * title Containers - Fulfillment application
 * Person(developer, "Integration developer", "Runs checkout and warehouse operations")
 * System_Boundary(fulfillment, "Fulfillment application") {
 *   Container(runtime, "Order application process", "Node.js", "Runs checkout, parcel pricing, and in-memory stock reservations")
 * }
 * Rel(developer, runtime, "Runs checkout and warehouse operations", "Host script")
 * UpdateLayoutConfig($c4ShapeInRow="2", $c4BoundaryInRow="1")
 * ```
 *
 * **Diagram key.** The dashed outline marks the system boundary. The container
 * inside it is the running Node.js application. The arrow shows how the developer starts its operations.
 *
 * ## Choosing an operation
 *
 * | Goal | Public operation |
 * | --- | --- |
 * | Check availability before committing stock | `inspectStock` |
 * | Estimate the cost of a parcel | `quoteShipping` |
 * | Produce a quote and reserve items together | `prepareShipment` |
 * | Prepare a shipment from a retail cart and postal code | `checkout` |
 * | Build a handoff payload and delivery message | `createDispatchRequest` and `shipmentMessage` |
 *
 * @realdocs:tag architecture
 * @realdocs:tag public-api
 * @realdocs:zone Public API
 */
export type { FulfillmentOrder, OrderLine, Reservation, ShipmentPlan, ShippingQuote, ShippingZone, Sku, StockStatus } from './contracts.js';
export { prepareShipment } from './fulfillment.js';
export { InventoryError, InventoryLedger as WarehouseInventory, inspectStock } from './inventory.js';
export { formatShippingQuote, quoteShipping } from './shipping.js';
export { findProduct, type Product } from './catalog/products.js';
export { orderFromCart, type CartLine } from './catalog/orders.js';
export { classifyDestination, type Destination } from './delivery/destination.js';
export { createDispatchRequest, type DispatchRequest } from './delivery/dispatch.js';
export { checkout, type CheckoutResult } from './integrations/checkout.js';
export { shipmentMessage } from './integrations/notification.js';
export { checkCartAvailability, type CartAvailability } from './operations/availability.js';
export { cancelShipment } from './operations/cancellation.js';
