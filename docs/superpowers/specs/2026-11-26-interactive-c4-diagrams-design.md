# Interactive C4 architecture page

Status: design, approved approach. Date: 2026-11-26.

## Intent

Developers who keep a project's documentation in sync need to understand its architecture quickly.
Today the C4 views are separate static Mermaid diagrams scattered across guides and `@realdocs:file`
overviews, and the detail about each box lives in prose elsewhere. In dataris-spec, the context view
and two hand-split container views sit at the top of `ARCHITECTURE.md`, and the per-container module
tables are hundreds of lines further down. The file map (`--graph`) shows code relationships and is
hard to follow for architecture questions.

This feature adds a separate, standalone HTML page that presents the project's C4 views as one
navigable model:

- Zooming moves between C4 levels: the system context, a system's containers, a container's components.
- Clicking an element opens a side panel with tabs that show everything documented about it.
- Authors decide what each element shows by marking content with `@realdocs:c4 <path>`.

Visuals over text files: a reader should be able to start from the context view and reach the
guide section, the decision record, the diagram, or the code for any box in a few clicks.

## Goals

- A new `--c4` option on `build` and `watch` that writes `c4.html` into the HTML wiki output, and
  on `check` to validate the C4 model without building.
- The levels come from the C4 Mermaid blocks authors already write. No new diagram syntax.
- Drill-down navigation with a breadcrumb, and a side panel with fixed tabs: Overview, Diagrams, Docs, Code.
- `@realdocs:c4` markers on whole Markdown files, single sections, single Mermaid diagrams, source file
  overviews, and exported symbols.
- `check` validates markers and the consistency of the C4 model, so drift between diagrams and the
  content attached to them is reported.

## Non-goals

- Continuous, map-style zoom. Drill-down was chosen; continuous zoom may be revisited later.
- Author-defined tabs. Tabs are fixed for now.
- A custom layout engine. Mermaid lays out every level.
- A Markdown-format version of the page.
- Changes to the file map or to how ordinary Mermaid blocks render on wiki pages.
- Treating `C4Dynamic` and `C4Deployment` as zoom levels. They can be marked as diagrams instead.
- `diff` impact reporting for `c4.html` (left for a later change).

## Anti-goals

- Existing builds must not change. Projects that do not pass `--c4` and have no `@realdocs:c4`
  markers see no new pages, links, warnings, or `check --strict` failures.
- The page must not draw a different architecture from the one authors wrote. Each level is the
  authored Mermaid source (or a merge of authored sources), not a reinterpretation.
- No server. The page works when opened from disk, like the rest of the HTML wiki.
- Navigation must never loop or grow without bound (see Navigation).

## Approaches considered

1. **Build-time model, Mermaid in the browser (chosen).** RealDocs parses the C4 blocks and markers
   at build time, validates them, renders marked Markdown with the wiki's renderer, and embeds the
   model as JSON in `c4.html`. A client script renders each level with the Mermaid runtime the wiki
   already ships and adds click, zoom, and panel behavior. `check` can validate everything, and the
   page needs no server.
2. **Scan the wiki in the browser.** The page would fetch generated pages and find diagrams at
   runtime. Rejected: `check` could not validate markers, and the page could not stand alone.
3. **Pre-render SVG at build time.** Rejected: it needs a headless browser in the CLI, and the
   interactive layer would still need the same client script.

Within approach 1, the page lives **inside the wiki output** (chosen) rather than as a single
self-contained file. It shares `assets/mermaid.min.js`, stays small, and its "Open in wiki" links
resolve. A self-contained file would weigh about 5.5 MB because of the inlined Mermaid runtime.

A throwaway prototype validated approach 1 against dataris-spec's real diagrams:
[`2026-11-26-interactive-c4-prototype.html`](2026-11-26-interactive-c4-prototype.html) (open it
after `npm ci`, since it loads Mermaid from `node_modules`). Its two component views are
illustrative, and its marked content is hand-placed. Port its client script as the starting point for
`assets/c4.js`, and replace its hard-coded `sources` and `markers` with the embedded data. Mermaid 12
renders every C4 element as `<g class="node c4-shape …" id="<renderId>-<alias>">`, so clicks map
reliably to aliases. Boundaries have no id.

## The C4 model

### Inputs

Every top-level ```` ```mermaid ```` fence in the wiki inputs (selected Markdown pages and
`@realdocs:file` overviews) whose first non-comment line is `C4Context`, `C4Container`, or
`C4Component`. Read the fences after `compileDiagrams` has resolved `{{ symbol(...) }}` and
`{{ diagram.link(...) }}` directives, so labels match what the wiki shows.

### Elements and aliases

- An element is any element macro: `Person`, `Person_Ext`, `System`, `System_Ext`, `SystemDb`,
  `SystemQueue` (and `_Ext` variants), `Container`, `ContainerDb`, `ContainerQueue` (and `_Ext`),
  `Component`, `ComponentDb`, `ComponentQueue` (and `_Ext`).
- **An alias is a global identity.** The same alias in two views is the same element. Authors use
  descriptive camelCase aliases (`controlPlane`, not `cp`); the `realdocs-c4` skill says so.
- Label, technology, and description come from the element's **home level** (below). When other
  views describe it differently, the home level wins.

### Levels

- A boundary (`System_Boundary`, `Container_Boundary`, `Enterprise_Boundary`, `Boundary`) whose
  alias matches an element is an **element boundary**: it opens that element's level.
  `System_Boundary(dataris, …)` is the inside of `System(dataris, …)`, and
  `Container_Boundary(controlPlane, …)` is the inside of `Container(controlPlane, …)`. *(my call)*
- A boundary whose alias matches no element is a **grouping boundary**. It is drawn as Mermaid draws
  it, but it is transparent to levels and paths. An `Enterprise_Boundary` around the systems in a
  context view leaves that view at the root, and those systems' paths do not include the enterprise
  alias. *(my call)*
- An element's parent is the nearest element boundary that encloses it in the view that declares it.
  Elements enclosed only by grouping boundaries, or by none, have no parent in that view. A view's
  level is that of its outermost element boundary. A view with several sibling element boundaries
  (two systems' containers side by side) contributes to each of those levels and is listed as a view
  of each. A `C4Container` or `C4Component` view with no element boundary contributes to no level.
  It is still parsed, so its relationships appear in Calls and Called by and its elements count as
  references. *(my call)*
- Nesting works: `Container_Boundary(controlPlane)` inside `System_Boundary(dataris)` in the same
  view gives its components the parent `controlPlane`, whose own path is `dataris.controlPlane`. The
  view contributes to both the `dataris` and the `controlPlane` levels. *(my call)*
- The root level is the union of all `C4Context` views. If a project has none, the root is the
  outermost level that exists, and the breadcrumb starts there.
- Several views with the same boundary form one level (dataris-spec splits its containers into
  "serving requests" and "provisioning"). The level opens on the first authored view and offers the
  others, plus an **All merged** view, as toggles. The merge is the union of elements (deduplicated
  by alias), one boundary block, and relationships deduplicated by `from→to` (first label wins).
  `UpdateRelStyle` offsets are dropped from merged views because they were tuned for a single view;
  the first view's `UpdateLayoutConfig` is kept. Authored single views render exactly as written.

### Paths

Each element has one **dotted path**: its parent's path plus its alias. Top-level elements (people,
external systems, the system in scope) have their alias as the path.

```
dataris                                  the system
dataris.controlPlane                     a container in it
dataris.dataService.storageCategoryC     a component in that container
hostDockerEngine                         an external system
```

An element drawn outside the boundary of a view (a peer container shown in a component view, a
person shown in a container view) is a **reference** to an element defined elsewhere. It does not
get a new path. An alias that appears *inside* two different element boundaries is an error.

**Home level.** An element's home level is the level of its parent (the root for elements with no
parent). The home level supplies the element's label, technology, description, and the Calls and
Called by lists in the panel. An element that is never enclosed by an element boundary and never
appears in a context view, such as an external system drawn only in a container view, is treated
as top level. Its path is its alias, and its home level is the first level that draws it in
document order. It can carry markers and gets a ↗ badge if it has a level of its own. `check`
warns that it should also appear in a context view. *(my call)*

## Markers

`@realdocs:c4 <path>` attaches content to an element. One path per marker; repeat the marker to
attach the same content to several elements. Paths use the same identifier rules as `@realdocs:docId`.

| Scope | Syntax | Tab |
| --- | --- | --- |
| Whole Markdown page | `<!-- @realdocs:c4 dataris.controlPlane -->` in the annotation block at the top, alongside `@realdocs:tag` and `@realdocs:zone` | Docs |
| One Markdown section | The same comment on the first non-blank line after a heading. The section runs to the next heading of the same or higher level. | Docs |
| One Mermaid diagram | `%% @realdocs:c4 dataris.dataService` as a line inside a top-level mermaid fence, before the diagram type line. Mermaid treats it as a comment, so GitHub still renders the block. | Diagrams |
| Source file | `@realdocs:c4 dataris.controlPlane` in the `@realdocs:file` comment | Code |
| Exported symbol | `@realdocs:c4 dataris.controlPlane` in the symbol's JSDoc | Code |

Section and diagram markers work in `@realdocs:file` overviews as well as Markdown pages.
A marker placed anywhere else (inside a list, a nested fence, mid-paragraph) is an error.

The marker comment is removed from the rendered wiki page the same way `@realdocs:tag` annotations
are, and the `%%` line is removed from the rendered Mermaid source *(builder's call: removing it is
optional, since Mermaid ignores it)*.

## The page

### Output and CLI

- `build --c4` and `watch --c4` write `c4.html` at the wiki root. It loads `assets/mermaid.min.js`
  (the existing copy) and a new `assets/c4.js` and `assets/c4.css`, and embeds the model as
  `<script type="application/json" id="c4-data">`, like the file map does.
- `--c4` requires `--format html`. With Markdown output the CLI fails with
  "--c4 requires --format html." *(my call: the page is HTML-only and Markdown wikis have no Mermaid runtime.)*
- With `--c4`, the homepage link row (next to Tags and File map) gets an **Architecture** link to
  `c4.html`. *(my call)*
- If `--c4` finds no C4 views, the build fails with an error that explains what the page needs.
  *(my call: a silently empty page would be confusing.)*
- `realdocs.json` gets no new field in this change. *(my call; a `"c4": true` option can follow if teams want it.)*
- `--c4` works with `--version` builds; `c4.html` and its assets are listed in `release.json` like
  other outputs.

### Data embedded in the page

For each level: its key (the boundary alias, or empty for the root), its views (Mermaid source,
title, origin file and heading for the "Appears in" list), and the merged source when there is more
than one view. For each element: alias, path, kind, label, technology, description, whether it has a
level of its own, and its marked items. Marked items carry their tab, title, source path, the
rendered HTML (Docs, Code) or Mermaid source (Diagrams), and the wiki URL of the original location.

Marked Markdown is rendered at build time with the same markdown-it configuration and link
resolution as the HTML wiki, with relative links rebased so they resolve from `c4.html`.
Mermaid blocks inside marked Docs content render in the browser when their tab opens.

### What each marked item shows

- **Section** (Docs): the whole section, rendered.
- **Whole page** (Docs): the page title and its opening content up to the first heading, then
  "Open in wiki". *(my call: whole ADRs inline would make the panel unwieldy.)*
- **Diagram** (Diagrams): the rendered diagram, an **Enlarge** button that opens it in a dialog, and
  "Open in wiki".
- **Source file** (Code): the file name, the first paragraph of its overview, and the list of its
  documented exports linking to the API page.
- **Symbol** (Code): the export name, its first signature, and the first paragraph of its description,
  linking to the API page.

### Layout and behavior

The prototype's behavior is the reference. In summary:

- **Badges and peers.** An element has its own level when a view has an element boundary with its
  alias. It gets **+** when its path extends the current breadcrumb, and **↗** otherwise.
- **Header**: page title (the wiki title), a breadcrumb of the current level's path
  (`Context › Dataris › Data Service`), a level chip (`Level 2 · Containers`), and view toggles when a
  level has several views.
- **Canvas**: the current level's diagram, fitted to the available space.
- **Panel** (right, about 30rem, overlays the canvas on narrow screens):
  - Header: label, kind and technology, the element's marker (`@realdocs:c4 dataris.controlPlane`)
    with a Copy button, and a zoom button when the element has its own level.
  - Tabs: Overview always; Diagrams, Docs, and Code only when they have items, each with a count.
  - Overview: description, technology, a count of marked items (or a hint that shows the marker to
    add when there are none), **Calls** and **Called by** from the element's home level (each
    entry selects that element when it is on screen), and **Appears in**, which lists the views
    that draw the element, with their source location.
  - Each item: title, source path, content, "Open in wiki ↗".
- **Elements with their own level** carry a badge: **+** for zooming deeper, **↗** for a peer whose
  level is elsewhere in the hierarchy.

### Navigation

- **Click** selects an element and opens the panel. Clicking empty canvas closes it.
- **Zoom in**: double-click a **+** element, scroll up over it, press `+` while it has focus, or use
  the panel's "Zoom in to components" button. The canvas scales toward the element and the next
  level fades in.
- **Go to a peer's level**: the same gestures on a **↗** element, or the panel's "Go to Control Plane
  components" button. The transition slides sideways instead of zooming.
- **Zoom out**: scroll down, press Backspace, or use the breadcrumb.
- **Navigation follows paths, not history.** Entering an element's level always sets the breadcrumb
  to that element's path. Moving between two peers that reference each other cannot grow the
  breadcrumb (this was a bug in the first prototype).
- **Any level change closes the panel.**
- **Deep links**: the URL fragment records the level, the selected element, and the open tab
  (`#level=dataris,dataService&select=lifecycle&tab=diagrams`). Opening such a URL restores that state.
- **Keyboard**: elements are focusable buttons with accessible names that say whether they can be
  zoomed into. Enter or Space selects, Escape closes the panel. The tabs follow the ARIA tabs pattern.
- **Theme**: the wiki's colors and the C4 palette from `render-mermaid.js`.

## Validation (`check`, and `build` with `--c4`)

The model is checked whenever `--c4` is passed or any `@realdocs:c4` marker exists, so projects
that use neither see no change. `check --c4` is accepted and does not require `--format html`,
because `check` renders nothing. CI can therefore run `check --strict --c4` to catch alias and
marker problems without building. The model and markers are built in the shared preparation step
(next to `compileDiagrams`) so `check` and `build` report the same diagnostics. Only `c4.html`
rendering is HTML-specific. *(my call)*

Errors:
- A marker path that resolves to no element. When the last segment matches an element under a
  different parent, the message suggests the correct path.
- A malformed or misplaced marker.
- An alias declared inside two different boundaries.

Warnings:
- Two aliases with the same label inside the same boundary, which is probably one element under two
  names (dataris-spec has `platform` and `platformDb`).
- The same alias with different labels in different views.
- A top-level element that appears in no context view.

## Documentation and skills

- README: a new "Interactive C4 page" section covering `--c4`, alias rules, levels, markers, and an
  example. Add `--c4` to the CLI help and the commands table.
- `realdocs-c4` skill: require descriptive, globally consistent camelCase aliases. Explain that a
  `Container_Boundary(alias, …)` component view becomes that container's zoom level. Explain the five
  marker forms and when to use each, and add `--c4` to its verification steps.
- `realdocs-bootstrap` skill and the maintenance rule: mention markers where they discuss diagrams.
- Fulfillment example: give its C4 views consistent descriptive aliases, add a few markers (a guide
  section, a diagram, a source file), and build it with `--c4` in the README instructions.

## Testing

Follow the existing style in `test/cli.test.mjs` (temporary projects, CLI runs, assertions on output):

- The levels, paths, merge, and home-level descriptions for a fixture with a context view, two
  container views with the same boundary, and a component view.
- Each marker form resolves to the right element and tab. Unknown paths produce errors and
  path suggestions, misplaced markers produce errors, and both warnings fire.
- Without `--c4` or markers, output and diagnostics are byte-identical to before.
- `--c4` with Markdown output fails with the documented message, and `--c4` with no C4 views fails.
- The homepage link appears only with `--c4`.

The browser behavior has no automated test today. The builder should verify the page in a
browser against the fulfillment example, and against a scratch copy of dataris-spec with renamed
aliases and a component view, before calling it done.

**Scope:** this work changes RealDocs only. Migrating dataris-spec (descriptive aliases, component
views, markers) is a separate follow-up task that uses the updated `realdocs-c4` skill.

## Left to the builder

- Module structure (for example `src/c4.ts` for the model and markers, the client script as a new
  asset next to `file-map.js`).
- Exact JSON shape of the embedded data.
- How marker comments are stripped from rendered pages.
- Animation timing and easing, within the behavior above.
- Whether nested boundaries within one view produce a warning.
