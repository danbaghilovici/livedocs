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
npx realdocs@0.2.0 build --entry src/index.ts --out dist/realdocs
```

Open `dist/realdocs/index.md` in a Markdown viewer. Each entry point gets a page with its top-level exports, including re-exports. Links between documented exports resolve against the generated pages.

The annotation examples below use the current source checkout. See [Development](#development) to try them with the local CLI.

Add a leading JSDoc comment such as `/** @realdocs:file Handles shipment pricing and transit estimates. */` to place an overview under the generated page title.

The [fulfillment example](https://github.com/danbaghilovici/realdocs/tree/main/examples/fulfillment) includes a mixed JS/TS checkout workflow, linked guides, and edits to try in watch mode.

## Project configuration

Use `realdocs.json` to give a project a shared documentation homepage, group code and Markdown guides into sections, and place pages in a navigation hierarchy. Each section can use its own TypeScript configuration. [Categories and paths](#categories-and-paths)

### Generate a starter config

Run `npx realdocs init` from the directory you want to document. It uses TypeScript configs and project references, package metadata, and entries such as `main.ts` and `index.ts` to suggest sections. It can also use `nest-cli.json` when present. A section can cover an app, a shared library, or a set of guides. Edit the generated config to match how readers should navigate the project.

`init` also discovers Markdown files. It assigns guides inside a discovered section to that section and lists unassigned guides under the top-level `pages` field. For example, a root `ARCHITECTURE.md` appears as a guide. Use `npx realdocs init --print` to preview discovery without writing a file. Once the config exists, edit it directly.

Discovery skips dependencies, build output, and test code: folders named `test`, `tests`, `__tests__`, `e2e`, `fixtures`, `__fixtures__`, and `__mocks__`. It also leaves out agent instruction files (`AGENTS.md`, `AGENTS.override.md`, `CLAUDE.md`, and `GEMINI.md`). It cannot tell vendored code or third-party templates from your own, so remove those from the generated config.

After generating or editing the config, use the usual commands.

```sh
npx realdocs check --strict
npx realdocs build --format html --graph
```

Subsequent builds use the saved list of entries and pages. Add new files to the config when you want them to appear in the wiki.

With a config present, `--page` adds a root guide for that run. Use `--entry` or `--project` to run with explicit inputs. `watch` uses explicit `--entry` or `--page` inputs. [CLI usage](#commands)

### Example `realdocs.json`

Paths are relative to the directory containing `realdocs.json`.

```json
{
  "sourceUrl": "https://github.com/acme/fulfillment/blob/main",
  "pages": ["README.md", "ARCHITECTURE.md"],
  "sections": {
    "orders": {
      "title": "Orders API",
      "project": "services/orders/tsconfig.json",
      "entries": ["services/orders/src/main.ts", "services/orders/src/orders.ts"],
      "pages": ["services/orders/docs/operations.md"]
    },
    "contracts": {
      "title": "Shared contracts",
      "project": "packages/contracts/tsconfig.json",
      "entries": ["packages/contracts/src/index.ts"]
    }
  }
}
```

| Field | Purpose |
| --- | --- |
| `sourceUrl` | Optional URL of the config directory in a source browser, such as `https://github.com/<owner>/<repo>/blob/<branch>`. Links to existing project files outside the wiki point there instead of being reported. [Links](#links) |
| `home` | Optional Markdown page rendered as the homepage. Defaults to the root `README.md` when it is an input. The page is added to the inputs. |
| Top-level `pages` | Markdown guides included in the wiki. |
| `categories` | Optional sidebar order of categories, by label. Unlisted categories follow alphabetically. [Categories and paths](#categories-and-paths) |
| `groups` | Optional label overrides for groups, keyed by URL path, such as `{"architecture-decisions/storage": "Storage layer"}`. |
| `rules` | Optional ordered folder defaults, such as `{"files": "docs/adr/*.md", "category": "Architecture Decisions"}`. The first matching rule places a file. `group` adds a sub-group. |
| `sections` | Named groups of source files and guides. Each key identifies a section in the wiki. Use lowercase letters, digits, hyphens, and underscores, starting with a letter or digit. |
| `sections.<id>.title` | Optional display name. The section ID is the default. |
| `sections.<id>.config` | Optional path to another RealDocs config. Includes that project's inputs in the section. |
| `sections.<id>.project` | Optional path to a compiler config for this section. It supplies compiler settings and path aliases. If omitted, RealDocs uses the root `tsconfig.json` or `jsconfig.json` when available. |
| `sections.<id>.entries` | JavaScript or TypeScript files selected for documentation. |
| `sections.<id>.pages` | Markdown guides linked from the section's landing page. |
| `sections.<id>.category` | Optional category for every entry and guide in the section. |
| `sections.<id>.group` | Optional sub-group path under the category. Defaults to the section ID. |

### Repo-wide and standalone app wikis

Run `npx realdocs init` in each app folder and curate its `realdocs.json`. In the repo-root `realdocs.json`, reference those files from named sections and add any shared guides.

```json
{
  "pages": ["ARCHITECTURE.md"],
  "sections": {
    "orders": { "title": "Orders API", "config": "apps/orders/realdocs.json" },
    "billing": { "title": "Billing API", "config": "apps/billing/realdocs.json" }
  }
}
```

The repo-wide wiki groups each app's guides and source entries under its named section. App entries, guides, and compiler paths are resolved from the app config's directory. Each app's own wiki uses the sections defined in its config. A section with `config` can also set `title`. Keep `entries`, `pages`, and `project` in the app config.

Run these commands from the repo root to build the combined HTML wiki and the standalone Orders wiki.

```sh
npx realdocs build --format html
(cd apps/orders && npx realdocs build --format html)
```

The homepages are `dist/realdocs/index.html` and `apps/orders/dist/realdocs/index.html`, respectively. Run `npx realdocs check --strict` from the same directory as the wiki you want to validate.

The combined examples config references the standalone fulfillment config. The fulfillment guide shows how to build both wikis. [Combined config](examples/realdocs.json) · [App config](examples/fulfillment/realdocs.json) · [Build commands](examples/fulfillment/README.md#generate-html)

### Homepage and Mermaid C4 diagrams

The homepage renders the root `README.md`, or the page named by `home`. Without one, RealDocs generates a homepage from the project name and the navigation tree. The project name comes from `package.json` or the directory name. `--graph` adds a site-wide file map page and a map on each section landing page. A section map covers its selected files and their source dependencies. Every other selected Markdown guide has its own page. Shared source pages have one URL so multiple sections can link to them.

Put Mermaid `C4Context` and `C4Container` diagrams in a guide linked from the homepage. Put focused `C4Component` diagrams in a section guide or a source file overview. The diagrams describe the runtime architecture. The file map shows code relationships derived from the source. [Code-linked diagrams](#code-linked-diagrams) · [Mermaid C4 syntax](https://mermaid.js.org/syntax/c4.html)

## RealDocs skills for agents

From the root of the project you want to document, install the bundled skills with a version of RealDocs that supports `install-skill`.

```sh
npx realdocs install-skill
```

This installs `realdocs-bootstrap` and `realdocs-c4` in `.agents/skills/`, where Codex discovers project skills. For Claude Code, run `npx realdocs install-skill --skills-dir .claude/skills`. Use `--skills-dir` for other agent-specific locations. Commit the installed files to share them with the team. [Codex skills](https://learn.chatgpt.com/docs/build-skills) · [Claude Code skills](https://code.claude.com/docs/en/skills)

### Generate the first wiki

Open the project in your agent and ask, “Use `realdocs-bootstrap` to generate our first RealDocs wiki with JSDoc for the main APIs and Mermaid C4 context and container diagrams.” The skill guides the agent through reviewing existing material, choosing wiki inputs, documenting the current architecture, and verifying the HTML output. For a focused diagram change, ask the agent to use `realdocs-c4`. If your agent uses plain repository instructions, point it at the appropriate installed `SKILL.md`. [First-run skill](https://github.com/danbaghilovici/realdocs/blob/main/.agents/skills/realdocs-bootstrap/SKILL.md) · [C4 diagram skill](https://github.com/danbaghilovici/realdocs/blob/main/.agents/skills/realdocs-c4/SKILL.md)

### Keep documentation current

Add the maintenance rule to the file your agent reads on every task. Run the command for your agent from the project root.

```sh
# Codex and other agents that read AGENTS.md
npx realdocs install-skill --instructions-file AGENTS.md

# Claude Code
npx realdocs install-skill --skills-dir .claude/skills --instructions-file CLAUDE.md
```

The installer creates the instruction file or appends a single maintenance block to its existing content. Rerunning the command preserves an existing block, including local edits. Commit the instruction file with the skills. The rule asks agents to review documentation for every code change and update any affected JSDoc, guides, and diagrams in the same change. If an update has no documentation impact, the agent reports why. [Maintenance rule](https://github.com/danbaghilovici/realdocs/blob/main/.agents/realdocs-instructions.md)

Run the installer again after upgrading RealDocs to add any missing skills. If an installed copy differs from the bundled version, compare it with the corresponding file under `node_modules/realdocs/.agents/skills/` and merge any changes you want. With an older CLI, you can copy the skill folders into your agent's skills directory and append the maintenance rule by hand. Keep the agent instruction files out of the wiki's `pages` list.

## Standalone Markdown pages

Repeat `--page` to include Markdown files in the wiki. A root `README.md` becomes the homepage. Use `--page` on its own for a wiki made entirely from Markdown.

```sh
npx realdocs build --entry src/index.ts --page README.md --page docs/architecture.md
```

`watch` follows the Markdown files supplied with `--page`.

### Links

In a selected Markdown page or a source file's `@realdocs:file` overview, write links relative to that source file. RealDocs updates links to selected pages, headings, and exports for the output format. From `docs/architecture.md`, `[Prepare a shipment](../src/index.ts#prepareShipment)` links to the `prepareShipment` export on the generated API page.

Fragments resolve the way GitHub resolves them, so a link that works on GitHub works in the wiki.

- **Headings** use GitHub's slugs: lowercase, punctuation removed, and each space replaced by a hyphen. `## 8. Failure — and retry` is `#8-failure--and-retry`.
- **Explicit anchors** are empty `<a id="deploy-phases"></a>` or `<a name="deploy-phases"></a>` elements. Both formats keep them. HTML output renders only this form and escapes any other raw HTML.
- **Line fragments** such as `#L42`, `#L42-L60`, or `#L42C3-L60C8` land on the nearest heading or export at or above that line, or on the top of the page.

`check` reports each link that the wiki cannot follow, with its source line:

- A link to a file that does not exist.
- A link to an existing Markdown or JS/TS file that is not a wiki input. Add the file to the inputs, or set [`sourceUrl`](#example-realdocsjson) to link it to its source instead. With `sourceUrl`, links to other project files and folders, such as scripts or SQL migrations, point to their source too. A [versioned build](#versioned-builds) with a GitHub `origin` links tracked files at its commit.
- A fragment with no matching heading, anchor, or export.

`check --strict` fails on any of them.

## Categories and paths

Place each guide and entry file in a navigation hierarchy that does not have to follow your folders. The hierarchy sets the sidebar, the breadcrumbs, and the page URL.

A **category** is a top-level sidebar group, such as Architecture Decisions. An optional **path** places the page inside it. Every segment except the last is a sub-group, at any depth. The last segment is the page name.

```md
<!-- @realdocs:category Architecture Decisions -->
<!-- @realdocs:path storage/category-c/0021-jsonb-store -->
# ADR 0021: Storage Category C
```

In a JS or TS entry file, put the same tags in the leading `@realdocs:file` comment.

```ts
/**
 * @realdocs:file Boots the control-plane HTTP server.
 * @realdocs:category Applications
 * @realdocs:path control-plane/bootstrap
 */
```

Most files need no tags. RealDocs places a file using the first of these that applies:

1. Its own `category` and `path`. An in-file `path` starts at the category root.
2. The first section that lists the file and has a `category`. The file goes in the section's `group`, which defaults to the section ID.
3. The first `rules` entry whose `files` glob matches. Folders matched after the first wildcard become sub-groups, so `docs/hld/**/*.md` puts `docs/hld/data-service/README.md` in a `data-service` group.

| Source | Placement | Output |
| --- | --- | --- |
| `docs/adr/0021-store.md` | `category: Architecture Decisions`, `path: storage/0021-jsonb` | `architecture-decisions/storage/0021-jsonb.html` |
| `docs/adr/0025-workspaces.md` | rule `docs/adr/*.md` → Architecture Decisions | `architecture-decisions/0025-workspaces.html` |
| `apps/control-plane/src/main.ts` | section `control-plane` → Applications | `applications/control-plane/main.ts.html` |
| `docs/notes.md` | none | `pages/docs/notes.html` |

URLs use lowercase slugs of the labels: `Architecture Decisions` becomes `architecture-decisions`. A `README.md` or `index.md`, or a page whose path ends in `index`, becomes its group's landing page. Every group has a landing page that lists its sub-groups and pages, so each breadcrumb links somewhere. Unplaced pages keep their source-mirroring URLs and appear under **Other pages**. Sections without a category appear under **Code reference**.

Links between source files keep working when pages move, because RealDocs rewrites them to the new URLs. `check` reports two inputs that resolve to the same URL, categories that use a reserved name (`assets`, `pages`, `modules`, `sections`, `tags`, `index`, or `file-map`), and unused `groups` or `categories` entries. In a repo-wide wiki, an included app config contributes only its `rules`. Its section categories, `categories`, `groups`, and `home` apply to its own wiki.

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

Pass `--format html` to `build` or `watch` to generate linked HTML pages. Open `index.html` in a browser. Every page has a header, a sidebar with the navigation tree, breadcrumbs, and a footer, styled with a bundled copy of Bootstrap. Pages open in Bootstrap's dark theme; the ☀ button in the header switches to light and the browser remembers the choice. On narrow screens the ☰ button opens the sidebar. Pages with Mermaid diagrams use a local renderer packaged in the output directory. The output works offline.

```sh
npx realdocs build --entry src/index.ts --format html --out dist/realdocs-html
```

Use separate output directories to keep both formats. The default format is Markdown.

## File map

Add `--graph` to `build` or `watch` to add a **File map** page, `file-map.html` or `file-map.md`, linked from the homepage. HTML provides an offline, interactive graph with search, zone and relationship filters, and incoming and outgoing links for the selected file. Markdown provides a Mermaid graph and a file list grouped by zone.

The map follows the compiler's local files from the configured entry points and includes Markdown files selected with `--page`. It shows explicit imports, type-only imports and re-exports, ordinary re-exports, resolved documentation links, and `@realdocs:docUses` relationships. A file links to its wiki page when it was supplied as an entry or page.

Files appear in their category's zone, or else their containing folder's zone. Add `@realdocs:zone Order operations` to the `@realdocs:file` comment, or `<!-- @realdocs:zone Guides -->` at the top of a Markdown page, to group files from different folders.

```sh
(cd examples/fulfillment && node ../../dist/cli.js build --strict --graph --format html --out dist/wiki-html)
```

## Commands

| Command | Behavior |
| --- | --- |
| `init` | Discover source entries and Markdown guides and write `realdocs.json`. Pass `--print` to preview the config. |
| `install-skill` | Install the bundled agent skills. Pass `--instructions-file` to add the maintenance rule. |
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

The default directory is `dist/realdocs-releases/1.2.0`. The checkout must have clean tracked files and the documentation inputs must be tracked by Git. The output includes `release.json` with the source commit, symbol routes, and SHA-256 fingerprints for inputs and outputs. A GitHub `origin` gives tracked symbols, and links to tracked files outside the wiki, source links pinned to the commit. Identical rebuilds can reuse the same directory. Choose a new version or empty directory to write different output.

## Development

From a source checkout, run `npm ci` and `npm test` to compile the CLI and exercise it against temporary JS/TS projects. Run `npm link` after building to try the local checkout as the `realdocs` command.
