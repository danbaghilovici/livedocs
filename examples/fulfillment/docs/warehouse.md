<!-- @livedocs:tag inventory -->
<!-- @livedocs:tag error-handling -->
<!-- @livedocs:zone Guides -->

# Warehouse operations

## Checking stock

Use [checkCartAvailability](../src/operations/availability.ts#checkCartAvailability) to compare each requested SKU with the ledger. It combines duplicates and returns the requested quantity, available quantity, and shortfall. The [ledger](../src/inventory.ts#doc-fulfillment.inventory) still checks every SKU when reserving the order.

| Situation | Caller action |
| --- | --- |
| `insufficient-stock` | Refresh availability and revise quantities. |
| `already-reserved` | Locate the accepted order before retrying or replacing it. |
| `invalid-order` | Correct the lines before submitting again. |

See the [inventory error reference](../src/inventory.ts#InventoryError) for the rejection reasons.

## Cancelling an order

Before submitting a parcel to a carrier, call [cancelShipment](../src/operations/cancellation.ts#cancelShipment) with the original order ID and the same ledger used at checkout. A return value of `true` means reserved units were returned to stock. A return value of `false` means the ledger has no active reservation for that order ID.

After carrier submission, the host application must resolve the carrier outcome before making those units available again. The [reservation decision](decisions/reservation-lifecycle.md) explains why the example leaves that responsibility with the caller.
