---
name: realdocs-c4
description: Use when creating or updating C4 architecture diagrams and their supporting documentation in a project that uses RealDocs and Mermaid.
---

# C4 architecture with RealDocs

Use the C4 abstractions to explain the project's runtime architecture, then use RealDocs to publish the diagrams and link them to the relevant guides and code. [C4 abstractions](https://c4model.com/abstractions) · [Mermaid C4 syntax](https://mermaid.js.org/syntax/c4.html)

## Establish the scope

Work from the target project's documentation root. Read its instructions, existing architecture guides, and RealDocs config or docs script. Identify the system in scope, its users and external dependencies, and the runtime boundaries. Verify them against entry points, deployment and datastore configuration, and integration code. In a monorepo, follow runtime boundaries across packages. For a library, use a documented host application if the scope includes one. Describe unverified details as open questions and label proposed architecture separately from the current system.

| View | What to show | Mermaid syntax |
| --- | --- | --- |
| System context (L1) | One software system, its user roles, and directly connected external systems. Use language readers outside the engineering team can follow. | `C4Context` with `Person`, `System`, and `System_Ext` |
| Containers (L2) | The applications and data stores that make up that system, their responsibilities and technologies, and how they communicate. Keep relevant actors and external systems outside the system boundary. A C4 container is a runtime or storage boundary, so use evidence beyond package layouts or Docker definitions. | `C4Container` with `System_Boundary`, `Container`, and `ContainerDb` as appropriate |
| Components (L3) | Zoom into one container. Group related functionality behind meaningful interfaces and show its direct connections. Keep peer containers and external systems at their existing abstraction level. | `C4Component` with `Container_Boundary` and `Component` |
| Code (L4) | Zoom into one component only when implementation detail helps. Link to the generated API reference or document the relevant classes, interfaces, or functions. | Mermaid has no `C4Code` type. Use `classDiagram` or `erDiagram` when the code detail calls for it. |

Start with context and containers for a new overview. Add component or code views when the requested scope or a concrete reader question calls for them. Use `C4Dynamic` for a specific interaction and `C4Deployment` for an identified environment when those questions come up. [C4 diagram types](https://c4model.com/diagrams)

## Write the diagrams and guides

- Put each view in its own top-level `mermaid` fence. Start with the diagram type and a title that names the scope. Use descriptive camelCase aliases (`controlPlane`, not `cp`) and keep each alias, display name, and description the same in every view: RealDocs treats one alias as one element across the whole wiki. Do not give one element two aliases.
- Give elements short responsibility descriptions and name the technologies for containers and components. Use directed `Rel(from, to, "Action", "Protocol")` edges. Use a verb phrase that reads from source to target, and give the verified technology or protocol for communication between containers.
- Name the boundary after the element it opens. `Container_Boundary(controlPlane, "Control plane")` in a `C4Component` view becomes the zoom level of the `controlPlane` container in the interactive C4 page, and `System_Boundary(dataris, …)` is the inside of `System(dataris, …)`. A boundary whose alias matches no element only groups. Peer containers and external systems drawn outside the boundary are references to elements defined elsewhere. Several views with the same boundary merge into one level.
- Write a short Markdown key below each diagram to explain the elements, boundaries, and arrows. Use surrounding prose to explain the system's purpose, important interactions, and decisions or constraints that the diagram cannot convey. Link each detailed view from the relevant overview. [C4 notation and review guidance](https://c4model.com/diagrams/notation)
- Check the Mermaid syntax against the version used by the project. For crowded diagrams, reorder declarations or use `UpdateLayoutConfig` and `UpdateRelStyle` after inspecting the rendering. Use Markdown links for navigation.

## Publish and verify in the target project

1. Update the existing architecture guide or create `docs/architecture.md` if the project has no convention. Link the context and container views from the wiki homepage. Put a focused component view in its section guide or a source file's `@realdocs:file` overview.
2. Add new guide paths to top-level `pages` or `sections.<id>.pages` in `realdocs.json`, or to the project's repeated `--page` arguments. Preserve existing inputs. Use links relative to the Markdown or source file that contains them. Include the linked Markdown and JS/TS files in the documentation inputs so RealDocs can resolve headings and exports.
3. When a component maps to a documented JS/TS export, reuse its `@realdocs:docId` or add a stable unique ID. Put `{{ diagram.link('checkout', 'orders.checkout') }}` on its own line inside the Mermaid fence to generate a link beneath the diagram. Replace the alias and ID with the project's values. Keep component labels at the architecture level. Use the generated file map or `diagram.dependencies` as a companion view of code relationships.
4. Mark the content that explains each element with `@realdocs:c4 <path>`, where the path joins the parents' aliases (`dataris.controlPlane.scheduler`). Use the form that fits the content, and repeat a marker to attach it to several elements:
   - `<!-- @realdocs:c4 path -->` in the annotation block at the top of a guide, for a page that is about one element (its title and opening show in Docs).
   - `<!-- @realdocs:c4 path -->` on the first non-blank line after a heading, for one section (several markers may stack there). Prefer this for most guides.
   - `%% @realdocs:c4 path` inside a top-level mermaid fence, before the diagram type line, to show a diagram in the element's Diagrams tab.
   - `@realdocs:c4 path` in a `@realdocs:file` comment, to show a source file overview in the Code tab.
   - `@realdocs:c4 path` in an export's JSDoc, to show that export in the Code tab.
   Section and diagram markers also work in `@realdocs:file` overviews. A marker placed in a list, a nested fence, or mid-paragraph is an error. Update a marker's path when you rename or move the element.
5. Run the project's RealDocs check and HTML build with the same inputs. For a configured project, use `npx realdocs check --strict --c4` and `npx realdocs build --strict --c4 --format html --out dist/realdocs-html`. `--c4` validates aliases and markers, and the build writes `c4.html`. Without a config, supply the same `--page` and any `--entry` arguments to both commands. Markdown-only projects can use `--page docs/architecture.md` on its own. If the installed CLI predates `realdocs.json` support, use its explicit inputs or the project's existing docs script.
6. Open the generated HTML wiki, including `c4.html`: zoom into each element that shows a badge, select elements to read their tabs, follow the guide and code links, and confirm the Mermaid blocks render as diagrams. Review the boundaries, arrow directions, labels, and legibility. `check --strict` validates documentation inputs and references. The HTML renderer parses Mermaid when the page opens, so a successful build can still leave a diagram as source code. Report any rendering you could not verify.

## Example of zooming in

In this example, customers submit orders through a Node.js API, which records orders in PostgreSQL. In a real project, use names, technologies, and calls confirmed by the project's source and configuration.

```mermaid
C4Context
title System context for the Order system
Person(customer, "Customer", "Places orders")
System(orders, "Order system", "Accepts and records orders")
Rel(customer, orders, "Submits orders")
```

**Diagram key.** The person is the customer. The system box represents the product they use. The arrow shows who submits the order.

```mermaid
C4Container
title Containers for the Order system
Person(customer, "Customer", "Places orders")
System_Boundary(orders, "Order system") {
  Container(api, "Order API", "Node.js", "Accepts order submissions")
  ContainerDb(store, "Orders database", "PostgreSQL", "Stores submitted orders")
}
Rel(customer, api, "Submits orders", "HTTPS")
Rel(api, store, "Records orders", "SQL")
```

**Diagram key.** The dashed outline encloses the Order system. The application box and database cylinder represent its containers. Arrows point from the caller to the target.

```mermaid
C4Component
title Components in the Order API
Person(customer, "Customer", "Places orders")
Container_Boundary(api, "Order API") {
  Component(checkout, "Checkout handler", "TypeScript", "Validates order submissions")
  Component(repository, "Order repository", "TypeScript", "Persists accepted orders")
}
ContainerDb(store, "Orders database", "PostgreSQL", "Stores submitted orders")
Rel(customer, checkout, "Submits orders", "HTTPS")
Rel(checkout, repository, "Passes accepted orders")
Rel(repository, store, "Inserts order records", "SQL")
```

**Diagram key.** The dashed outline encloses the API's components. The database cylinder is a peer container. Arrows point from callers to the components or datastore they use.
