<img src="assets/icon.svg" width="64" height="64" alt="">

# RealDocs

RealDocs generates linked Markdown or HTML documentation from JavaScript and TypeScript entry points. Exports and signatures come from the TypeScript compiler. Descriptions, examples, and deprecation notes come from the JSDoc already in the source.

## Quick start

Use Node.js 22 or later. Install RealDocs in the project you want to document.

```sh
npm install --save-dev realdocs
npx realdocs build --entry src/index.ts --out dist/realdocs --timings
```

For a one-off run, use the same command with an explicit package version.

```sh
npx realdocs@0.1.0 build --entry src/index.ts --out dist/realdocs
```

Open `dist/realdocs/index.md` in a Markdown viewer. Each entry point gets a page with its top-level exports, including re-exports. Links between documented exports resolve against the generated pages.

The annotation examples below use the current source checkout. See [Development](#development) to try them with the local CLI.

Add a leading JSDoc comment such as `/** @realdocs:file Handles shipment pricing and transit estimates. */` to place an overview under the generated page title.

The [fulfillment example](https://github.com/danbaghilovici/realdocs/tree/main/examples/fulfillment) includes a mixed JS/TS checkout workflow, linked guides, and edits to try in watch mode.

## Project configuration

Run `npx realdocs init` to discover source entries and Markdown guides and save them in `realdocs.json`. Edit the config to group files into sections, then run `npx realdocs build` or `npx realdocs check`. [Configuration reference](docs/configuration.md)

## Standalone Markdown pages

Repeat `--page` to include Markdown files on the wiki home. Use `--page` on its own for a wiki made entirely from Markdown.

```sh
npx realdocs build --entry src/index.ts --page README.md --page docs/architecture.md
```

In a selected Markdown page or a source file's `@realdocs:file` overview, write links relative to that source file. RealDocs updates links to selected pages, headings, and exports for the output format. From `docs/architecture.md`, `[Prepare a shipment](../src/index.ts#prepareShipment)` links to the `prepareShipment` export on the generated API page. Heading fragments use lowercase slugs such as `#failure-and-retry`.

`check --strict` reports links to Markdown or JS/TS files missing from the input list and fragments with no matching heading or export. `watch` follows the Markdown files supplied with `--page`.

## Tags

Add one `@realdocs:tag` per line in an `@realdocs:file` comment or in the JSDoc for an exported symbol.

```ts
/**
 * @realdocs:file Tracks warehouse stock and order reservations.
 * @realdocs:tag inventory
 * @realdocs:tag order-flow
 */
```

For a standalone Markdown page, put `<!-- @realdocs:tag architecture -->` at the top and include the file with `--page`. Tag names are case-insensitive, and spaces become hyphens. Tagged items link to a **Tags** index in both formats.

## Code-linked diagrams

Give an exported symbol a stable `@realdocs:docId`. Use that ID in Mermaid blocks in an `@realdocs:file` overview or an included Markdown page.

````md
```mermaid
flowchart LR
  Shipment["{{ symbol('fulfillment.prepare').name }}"]
  {{ diagram.link('Shipment', 'fulfillment.prepare') }}
```
````

RealDocs resolves the label from the current export name and puts the documentation link below the diagram. Keep the ID when moving or renaming the export. To generate a graph from repeatable `@realdocs:docUses` declarations, put `{{ diagram.dependencies('fulfillment.prepare') }}` in its own paragraph. `check` reports duplicate IDs, unknown dependency targets, and invalid diagram references.

## HTML output

Pass `--format html` to `build` or `watch` to generate linked HTML pages. Open `index.html` in a browser. Pages with Mermaid diagrams use a local renderer packaged in the output directory.

```sh
npx realdocs build --entry src/index.ts --format html --out dist/realdocs-html
```

Use separate output directories to keep both formats. The default format is Markdown.

## File map

Add `--graph` to `build` or `watch` to embed a **File map** section on the wiki home. HTML provides an offline, interactive graph with search, zone and relationship filters, and incoming and outgoing links for the selected file. Markdown provides a Mermaid graph and a file list grouped by zone.

The map follows the compiler's local files from the configured entry points and includes Markdown files selected with `--page`. It shows explicit imports, type-only imports and re-exports, ordinary re-exports, resolved documentation links, and `@realdocs:docUses` relationships. A file links to its wiki page when it was supplied as an entry or page.

Files appear in their containing folder's zone by default. Add `@realdocs:zone Order operations` to the `@realdocs:file` comment, or `<!-- @realdocs:zone Guides -->` at the top of a Markdown page, to group files from different folders.

```sh
npm --prefix examples/fulfillment run docs -- build --format html --out dist/wiki-html
```

## Commands

| Command | Behavior |
| --- | --- |
| `init` | Discover source entries and Markdown guides and write `realdocs.json`. Pass `--print` to preview the config. |
| `build` | Generate the wiki and remove pages for entry points that were dropped. |
| `check` | Report source errors, stale JSDoc `@param` names, and unresolved `{@link}` references. |
| `diff --base <ref>` | Report which documentation pages may be affected by changes since a Git revision. |
| `watch` | Build once, then regenerate on saved changes using TypeScript's incremental compiler. |

Repeat `--entry` for each public entry point. Paths on the command line are relative to the working directory. RealDocs reads `tsconfig.json` or `jsconfig.json` from that directory when present. Use `--project` to select a config in another directory. Entry files must be inside the selected config's directory. The compiler starts with those entries and configured declaration files, then follows imports.

`check` validates syntax, static module references, and JSDoc for documented exports. Use your project's TypeScript checker for full type checking. If the selected config file is deleted while watching, restart `watch` after restoring it.

The current source checkout defaults to `dist/realdocs`. Use `--out` to choose a dedicated output directory. RealDocs checks output ownership before replacing generated pages and retains the last successful wiki when a source error prevents a build. Use `--strict` to fail on documentation warnings, or `--timings` to report build phase timings.

## Documentation impact

Use `diff` before reviewing a change. It compares the Git revision you name with the working tree, including staged changes and untracked files that Git sees. Inputs come from `realdocs.json` or the usual `--entry` and `--page` flags.

```sh
npx realdocs diff --base origin/main
npx realdocs diff --base HEAD --format html --json
```

The report lists affected pages and the changed files that led to them. It follows imports, code links, Markdown links, and Mermaid symbol references in the current source. Links and imports removed by the change may lose their dependency edges. A selected input that was deleted still appears in the report alongside its validation error. The JSON report goes to stdout and diagnostics go to stderr. The command writes no wiki files.

## Versioned builds

Check out the source commit you want to document, then build with a version label.

```sh
npx realdocs build --version 1.2.0 --format html
```

The default directory is `dist/realdocs-releases/1.2.0`. The checkout must have clean tracked files and the documentation inputs must be tracked by Git. The output includes `release.json` with the source commit, symbol routes, and SHA-256 fingerprints for inputs and outputs. A GitHub `origin` gives tracked symbols source links pinned to the commit. Identical rebuilds can reuse the same directory. Choose a new version or empty directory to write different output.

## Development

From a source checkout, run `npm ci` and `npm test` to compile the CLI and exercise it against temporary JS/TS projects. Run `npm link` after building to try the local checkout as the `realdocs` command.
