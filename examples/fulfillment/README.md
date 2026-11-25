<!-- @realdocs:tag getting-started -->
<!-- @realdocs:zone Guides -->

# Fulfillment example

A warehouse project that turns a cart into a shipment, reserves stock, and prepares a carrier handoff. It also includes availability and cancellation workflows and a legacy shipping entry point.

Run these commands from the RealDocs repository root.

```sh
npm run build
npm --prefix examples/fulfillment run docs -- build
```

Open `dist/wiki/index.md`. The wiki includes this guide and the standalone [architecture guide](docs/architecture.md). The [shipment page](src/fulfillment.ts) links to inventory, shipping, and contract pages. The [public API page](src/index.ts) includes the `WarehouseInventory` re-export and both `inspectStock` overloads. The [legacy page](src/legacy.cjs) shows a CommonJS export with a deprecation note.

Each source file starts with a JSDoc `@realdocs:file` comment. Its description appears under the title of that file's wiki page. Start the description on the `@realdocs:file` line and use separate JSDoc comments for individual exports.

The public API overview includes C4 system context and container diagrams for the example host application. The shipment overview zooms in on the components involved in preparing a shipment and includes its execution flow. The `prepareShipment` guide links to the inventory, pricing, and contract definitions through JSDoc. [Public API source](src/index.ts) · [Shipment source](src/fulfillment.ts)

The diagrams use Mermaid's C4 notation in `@realdocs:file` comments. [C4 model](https://c4model.com/diagrams) · [Mermaid C4 syntax](https://mermaid.js.org/syntax/c4.html)

The component view uses responsibility-based names and resolves implementation links from `@realdocs:docId` annotations. The standalone guide also generates a diagram from `@realdocs:docUses` relationships. [Component view](src/fulfillment.ts#components-inside-the-order-application-process) · [Declared dependencies](docs/architecture.md#declared-dependencies)

Open **Tags** on the wiki home to browse related pages and exports together. Try `architecture` for the C4 views and guide, or `order-flow` for the path through contracts, shipment coordination, and inventory.

The **File map** section on the wiki home shows how the source files and guides relate. In the HTML wiki, select `src/fulfillment.ts` and choose **Show neighbors only** to inspect the files involved in preparing a shipment.

To explore the wider graph, start with [First shipment](docs/quickstart.md) and follow the [checkout sequence](docs/integrations.md#checkout-to-handoff) into [delivery](docs/delivery.md) and [warehouse operations](docs/warehouse.md). The [reservation lifecycle decision](docs/decisions/reservation-lifecycle.md) links back to the code and runbook that implement the decision.

## Generate HTML

```sh
npm --prefix examples/fulfillment run docs -- build --format html --out dist/wiki-html
```

Open `dist/wiki-html/index.html` in a browser. The [shipment page](src/fulfillment.ts#shipment-workflow) renders the flowchart using the bundled Mermaid script. Use `watch` with the same flags to regenerate the HTML as you edit.

## Try a live edit

```sh
npm --prefix examples/fulfillment run docs -- watch
```

1. Change the `@realdocs:file` description in the shipping module and save. The new overview should appear under the shipping page title. [shipping.js](src/shipping.js)
2. Change the description on `quoteShipping` and save. The new wording should appear on both the shipping page and the public API page. [shipping.js](src/shipping.js)
3. Rename the `WarehouseInventory` alias to `WarehouseStock`. The public API page should show the alias, and `prepareShipment` should still link to the original `InventoryLedger` declaration. [index.ts](src/index.ts)
4. Change the `@param` name on `quoteShipping` from `weightGrams` to `oldWeight` while leaving the function parameter alone. The watcher should report the stale tag and keep the last successful wiki. Restore the tag to resume generation. [shipping.js](src/shipping.js)
5. Edit the retry guidance in the standalone architecture guide and save. The watcher updates its generated page. [Architecture guide](docs/architecture.md#failure-and-retry)

To run a one-off check with the same entry points and strict validation:

```sh
npm --prefix examples/fulfillment run docs -- check
```
