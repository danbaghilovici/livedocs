<!-- @livedocs:tag getting-started -->
<!-- @livedocs:tag order-flow -->
<!-- @livedocs:zone Guides -->

# First shipment

Start with the public API and run a cart from availability check through the carrier handoff. The [checkout walkthrough](integrations.md#checkout-to-handoff) follows the same sequence across the underlying files.

```ts
import {
  WarehouseInventory,
  checkCartAvailability,
  checkout,
  createDispatchRequest,
  shipmentMessage,
} from './src/index.js';

const warehouse = new WarehouseInventory({ 'MUG-01': 12, 'TEA-02': 6 });
const cart = [{ sku: 'MUG-01', quantity: 2 }, { sku: 'TEA-02', quantity: 1 }];

checkCartAvailability(warehouse, cart);
const accepted = checkout(warehouse, 'order-17', cart, '90210');
const handoff = createDispatchRequest(accepted);
shipmentMessage(handoff); // Order order-17 for 90210: $10.85 · 4 business days estimated.
```

[Stock availability](../src/operations/availability.ts#checkCartAvailability) is advisory. The reservation happens during [checkout](../src/integrations/checkout.ts#checkout), when the ledger verifies the whole order against current stock. See the [warehouse guide](warehouse.md) for retry and cancellation steps.
