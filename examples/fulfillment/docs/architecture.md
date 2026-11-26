<!-- @realdocs:tag architecture -->
<!-- @realdocs:tag order-flow -->
<!-- @realdocs:zone Guides -->

# Fulfillment architecture

The **Fulfillment application** is the example host system. It has one container, the **Order application process** running on Node.js. The fulfillment library runs in that process. The host supplies order data and creates an in-memory ledger for each warehouse it manages.

Follow the [system context](../src/index.ts#system-context) to see the actor and system, the [container view](../src/index.ts#containers) for the runtime boundary, and the [component view](../src/fulfillment.ts#components-inside-the-order-application-process) for the shipment preparation slice inside that process.

The [host integration guide](integrations.md) covers the wider checkout flow, including catalog weights, destination classification, and handoff. The [reservation lifecycle decision](decisions/reservation-lifecycle.md) records the boundary between the ledger and the host application.

## Preparing a shipment
<!-- @realdocs:c4 fulfillment -->

1. The caller supplies a [fulfillment order](../src/contracts.ts#FulfillmentOrder) and a [shipping zone](../src/contracts.ts#ShippingZone).
2. [Shipment coordination](../src/fulfillment.ts#doc-fulfillment.prepare) validates the order lines and requests a [shipping quote](../src/shipping.js#doc-fulfillment.quote).
3. The [inventory ledger](../src/inventory.ts#doc-fulfillment.inventory) checks stock and reserves the full order. The caller receives a [shipment plan](../src/contracts.ts#ShipmentPlan) with the reservation and quote.

See the [shipment workflow](../src/fulfillment.ts#shipment-workflow) for the branch taken when validation or a reservation fails.

## Declared dependencies

This diagram follows the `@realdocs:docUses` relationships on the shipment coordinator. The links below it lead to the documented exports.

{{ diagram.dependencies('fulfillment.prepare') }}

## Failure and retry

A rejected quote leaves stock untouched. For a rejected reservation, inspect the [inventory error reason](../src/inventory.ts#InventoryError) and use [the availability API](../src/inventory.ts#inspectStock) before submitting revised quantities. When replacing an accepted reservation, release it by order ID before submitting the replacement.

[Return to the example guide](../README.md).
