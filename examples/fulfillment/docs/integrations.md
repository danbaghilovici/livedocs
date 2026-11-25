<!-- @livedocs:tag order-flow -->
<!-- @livedocs:tag public-api -->
<!-- @livedocs:zone Guides -->

# Host integration

## Checkout to handoff

The host supplies a cart and a postal code. [Checkout](../src/integrations/checkout.ts#checkout) builds the order and reserves stock. The [dispatch adapter](../src/delivery/dispatch.ts#createDispatchRequest) and [message formatter](../src/integrations/notification.ts#shipmentMessage) consume that completed result.

```mermaid
sequenceDiagram
  participant Host
  participant Checkout as Checkout workflow
  participant Catalog as Product catalog
  participant Shipping as Shipping calculator
  participant Ledger as Inventory ledger
  participant Dispatch as Dispatch adapter
  Host->>Checkout: Submit cart and postal code
  Checkout->>Catalog: Look up unit weights
  Checkout->>Shipping: Price the parcel
  Checkout->>Ledger: Reserve the requested units
  Ledger-->>Checkout: Active reservation
  Checkout-->>Host: Accepted order and quote
  Host->>Dispatch: Build carrier handoff
  Dispatch-->>Host: Handoff payload
```

## Checkout dependencies

Follow the declared dependencies from checkout into the core shipment workflow.

{{ diagram.dependencies('fulfillment.checkout') }}

Use the [first shipment](quickstart.md) example to try the public API. The [delivery guide](delivery.md#carrier-handoff) covers responsibilities after checkout returns.
