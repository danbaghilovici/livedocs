/**
 * @livedocs:file Releases stock for an order whose shipment is cancelled before dispatch.
 *
 * Use the same ledger instance that handled checkout. See the
 * [cancellation runbook](../../docs/warehouse.md#cancelling-an-order) for the caller's responsibilities.
 *
 * @livedocs:tag inventory
 * @livedocs:zone Warehouse support
 */
import type { InventoryLedger } from '../inventory.js';

/**
 * Releases an active reservation. A repeated cancellation leaves the ledger unchanged.
 * @param ledger Warehouse that holds the reservation.
 * @param orderId Order reference used at checkout.
 * @returns Whether an active reservation was released.
 * @livedocs:docId fulfillment.cancel
 * @livedocs:docUses fulfillment.inventory
 */
export function cancelShipment(ledger: InventoryLedger, orderId: string): boolean {
  return ledger.release(orderId);
}
