<!-- @realdocs:tag shipping -->
<!-- @realdocs:zone Guides -->

# Delivery and carrier handoff

## Rate selection

[Destination classification](../src/delivery/destination.ts#classifyDestination) normalizes the postal code and selects a demonstration rate zone. The [catalog](../src/catalog/products.ts#findProduct) supplies per-unit weights. [Shipment preparation](../src/fulfillment.ts#shipment-workflow) adds those weights and asks the [pricing calculator](../src/shipping.js#quoteShipping) for a quote.

| Input | Effect |
| --- | --- |
| Five-digit code with prefix `100`, `101`, or `102` | Local rate |
| Other five-digit code | Regional rate |
| Parcel between 1 and 30,000 grams | Round up to the next whole billable kilogram |
| Invalid code or weight | Reject before holding stock |

## Carrier handoff

Use [createDispatchRequest](../src/delivery/dispatch.ts#createDispatchRequest) once checkout has succeeded. The payload carries the order ID, destination, and shipment plan. The caller submits it to the carrier and records the outcome.

Use the [shipment message formatter](../src/integrations/notification.ts#shipmentMessage) when presenting an estimate. For the full call sequence, see the [integration guide](integrations.md#checkout-to-handoff).
