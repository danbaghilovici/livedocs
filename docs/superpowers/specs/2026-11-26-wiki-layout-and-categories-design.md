# Wiki layout, categories, and canonical paths

Status: draft for approval · 2026-11-26

## Why

The HTML wiki for a real project (dataris-spec: 15 code sections, ~95 Markdown guides) renders as one
flat homepage list in which ADRs, ADR summaries, HLDs, runbooks, templates, and infra READMEs are
mixed together. Pages have no persistent navigation; a page's only way back is a `Home · Section`
text line. Readers cannot see what kinds of documents exist or where one sits relative to others.

We want:

1. A proper documentation layout on every HTML page: header, sidebar, breadcrumbs, footer, built on
   a CSS framework (Bootstrap).
2. Authors to place each page in a navigation hierarchy with annotations — a **category** (the top
   sidebar group, such as "Architecture Decisions") and an optional multi-level **path** inside it —
   independent of the folder the source file sits in. The hierarchy is also the page's URL.

## Goals

- Every HTML page shares one shell: header, collapsible sidebar tree, breadcrumbs, content, footer.
- Markdown pages and code entry pages can declare `category` and `path`; the output URL, sidebar
  position, and breadcrumbs all follow from them.
- Paths can be arbitrarily deep (`g/s/x/f/c`).
- Most files need no annotation: section-level and folder-level defaults in `realdocs.json` place
  them, and in-file annotations handle exceptions.
- Existing source-relative links keep working: links are rewritten to wherever the target lands.
- Untagged projects keep building, with today's URLs (except the homepage, which now renders
  `README.md`; see `home`).
- The wiki stays fully offline (no CDN).

## Non-goals

- Full-text search. (Later option: Pagefind, which indexes any folder of static HTML after the build.)
- Redirect stubs at old URLs when a page moves.
- A custom theme. The wiki uses Bootstrap's stock components and colour modes, dark by default with a
  header switcher to light (changed 2026-11-26 at the user's request; the first build used a custom
  dark palette). The choice is saved in `localStorage` (`realdocs-theme`) and applied before paint;
  pages with diagrams or a file map reload after a switch so they redraw in the new colours.
- Per-symbol (per-export) placement. Placement is per file; a code page is one entry file.
- `realdocs init` suggesting categories (possible follow-up).
- On-page table of contents.

## Anti-goals

- Requiring every file to carry a tag before the wiki looks organized.
- URL collisions resolved silently (one page overwriting another).
- Breaking `--format md` output or existing configs.

## Approaches considered

| Approach | Trade-off | Verdict |
| --- | --- | --- |
| **A. Bootstrap 5 from npm, bundled into `assets/`** like Mermaid and Cytoscape; a navigation tree computed once and consumed by both renderers | Adds ~230 KB CSS + ~80 KB JS per wiki; keeps offline output; Bootstrap gives collapse, offcanvas, breadcrumb, navbar for free | **Chosen** |
| B. Bootstrap from a CDN | Smallest output, but breaks the offline guarantee and needs network for every reader | Rejected |
| C. Hand-written CSS, no framework | No new dependency, full control, but more code to own and not what was asked for | Rejected |
| D. Hand the content to an external static site generator (Hugo, Pelican, MkDocs, VitePress): RealDocs writes a content tree with front matter and runs the generator | Gets themes, search, a light/dark toggle, and live reload. But placement, link rewriting and diagnostics still have to live in RealDocs; it adds a Go or Python toolchain to an npm-only install; the generator's Markdown engine must agree with RealDocs on heading anchors, or links break with no warning; Mermaid, the file map, and release fingerprints must be ported. Pelican is blog-oriented, with single-level categories. | Rejected for now (discussed 2026-11-26) |

Annotation shape (decided in conversation): two tags — `category` plus optional `path` — rather than
a single full `path` tag, so the common case ("this is an ADR") is one line, and hierarchy is added
only where it helps.

URL behavior (decided in conversation): placement changes the **URL**, not only navigation.

## Annotations

### Markdown pages

Leading HTML comments, alongside the existing `tag` and `zone` annotations (`src/pages.ts`
`readPageAnnotations`). The `livedocs:` namespace alias is accepted as for the other annotations.

```md
<!-- @realdocs:category Architecture Decisions -->
<!-- @realdocs:path storage/category-c/0021-jsonb-store -->
# ADR 0021: Storage Category C — Abstract JSONB Canonical Store + Lens Layer
```

### Code entry files

Inside the leading `@realdocs:file` block (`src/typescript.ts` `fileOverview`). A file without
overview text still needs the `@realdocs:file` line to carry them.

```ts
/**
 * @realdocs:file Boots the control-plane HTTP server and mounts the admin API.
 * @realdocs:category Applications
 * @realdocs:path control-plane/bootstrap
 */
```

### Semantics

- `category` — free text, single line, nonempty. Its display label is the text as written; its URL
  slug is derived from it (`Architecture Decisions` → `architecture-decisions`).
- `path` — `/`-separated segments, any depth. All segments but the last are **sub-groups**; the last
  is the **page name**. Each segment is slugified the same way. Without `path`, the page sits
  directly under its category with its source file name (`0021-storage-category-c-jsonb-canonical-store`).
- An in-file `path` is the page's full location **inside its category**. It starts at the category
  root and ignores any `group` the file would inherit from its section or rule. An in-file `category`
  without `path` also drops the inherited group (the page sits at the new category's root).
- A page whose path ends in `index` becomes the content of that group's index page (e.g.
  `docs/adr/README.md` with `@realdocs:path index` becomes the Architecture Decisions landing page).
- Without an explicit `path`, a page whose source file is named `README.md` or `index.md` becomes the
  index page of the group it lands in. So `docs/adr/README.md` placed by a `docs/adr/*.md` rule is the
  Architecture Decisions landing page with no tag.
- At most one `category` and one `path` per file; duplicates are errors.

### Slug and label rules

- Slug: NFC, lowercase, every run of characters outside letters/digits/`.`/`_`/`-` becomes `-`,
  trimmed of `-`. An empty slug is an error.
- Sub-group label: the segment as written if it contains uppercase or spaces; otherwise the slug with
  `-` → space and the first letter capitalized (`category-c` → "Category c"). A `groups` map in
  config (below) overrides any group label.
- Reserved top-level slugs, rejected as categories: `assets`, `pages`, `modules`, `sections`, `tags`,
  `index`, `file-map`.

## Configuration (`realdocs.json`)

New optional fields. Existing configs are unchanged in meaning.

```json
{
  "home": "README.md",
  "categories": ["Architecture Decisions", "High-Level Designs", "Runbooks", "Applications", "Libraries"],
  "groups": { "architecture-decisions/storage": "Storage layer" },
  "rules": [
    { "files": "docs/adr/summaries/*.md", "category": "Architecture Decisions", "group": "summaries" },
    { "files": "docs/adr/*.md",           "category": "Architecture Decisions" },
    { "files": "docs/hld/**/*.md",        "category": "High-Level Designs" },
    { "files": "docs/runbooks/*.md",      "category": "Runbooks" }
  ],
  "sections": {
    "control-plane": { "title": "Control Plane", "category": "Applications", "entries": ["..."] },
    "uql":           { "title": "UQL",           "category": "Libraries",    "entries": ["..."] }
  }
}
```

| Field | Meaning |
| --- | --- |
| `home` | Markdown page rendered as the homepage. Defaults to root `README.md` when it is an input; otherwise a generated page listing the categories. The home page is written only as `index.html` (no `pages/README.html`), and links to it resolve to `index.html`. This applies to existing configs too: today's flat directory homepage is replaced. |
| `categories` | Sidebar order of categories (by label). Unlisted categories follow alphabetically. |
| `groups` | Label overrides keyed by slug path (`category-slug/sub/group`). |
| `rules` | Ordered folder defaults. `files` is a glob relative to the config directory; the **first** matching rule applies. `group` is an optional sub-group path prefix (no page name). Folders matched by `**` become sub-groups: with `docs/hld/**/*.md`, `docs/hld/data-service/README.md` lands in group `data-service` (and, being a README, is that group's index). Folders before the first wildcard are dropped. |
| `sections.<id>.category` | Places every entry and page of the section. |
| `sections.<id>.group` | Sub-group path under the category. Defaults to the section id. |

### Precedence (most specific wins, per field)

1. In-file `category` / `path`.
2. The file's section (`category`, `group`) — for files listed in a section.
3. The first matching `rules` entry.
4. Unplaced: today's URL (`pages/…`, `modules/…`) and an **Other pages** / **Code reference**
   sidebar group.

If only `path` comes from the file, the category comes from the next layer down. If a file is in
several sections, the first section in config order places it.

### Included configs (`sections.<id>.config`)

In the combined wiki, placement for files an included config contributes is, in order: in-file
annotations; the root section's `category`/`group` (when the root section has a category); the root
config's `rules`; the included config's `rules` (resolved from its directory). The included config's
`sections.*.category`, `categories`, `groups`, and `home` apply only to its own standalone wiki. A root
section with `config` and no `category` leaves its files to the rules, and otherwise uses today's
`sections/<id>/` landing page.

## URLs

| Source | Placement | Output |
| --- | --- | --- |
| `docs/adr/0021-….md` | `category: Architecture Decisions`, `path: storage/category-c/0021-jsonb-store` | `architecture-decisions/storage/category-c/0021-jsonb-store.html` |
| `docs/adr/0025-workspaces.md` | rule → `Architecture Decisions` | `architecture-decisions/0025-workspaces.html` |
| `docs/adr/summaries/0025-workspaces.summary.md` | rule with `group: summaries` | `architecture-decisions/summaries/0025-workspaces.summary.html` |
| `apps/control-plane/src/main.ts` | section `control-plane` → `Applications` | `applications/control-plane/main.ts.html` |
| `docs/improvements.md` | none | `pages/docs/improvements.html` (unchanged) |

- Code pages keep their source extension in the name, as today (`main.ts.html`).
- Every group gets an index page: `<category>/index.html`, `<category>/<sub>/index.html`, … listing
  its sub-groups and pages. A categorized section's landing page **is** its group index (with its
  guides, entries, and section file map). Uncategorized sections keep `sections/<id>/index.html`.
- `--format md` uses the same paths with `.md`.
- Two inputs resolving to the same output path is an **error** naming both files. (dataris has
  several `docs/hld/*/README.md`; placing them in one group without `path` collides.)
- Link rewriting (`src/pages.ts` registry) maps source path → new output path, so authored relative
  links, `#heading` fragments, and GitHub line fragments keep resolving.

## HTML shell

```
┌────────────────────────────────────────────────────────────────────┐
│ ☰  dataris-spec                          Tags · File map · Source ↗ │  header (navbar)
├──────────────────────┬─────────────────────────────────────────────┤
│ Home                 │ Home › Architecture Decisions › Storage ›   │  breadcrumbs
│ ▾ Architecture Dec.  │        Category C › ADR 0021                 │
│   ▾ Storage          │                                             │
│     ▾ Category C     │ # ADR 0021: Storage Category C …            │
│       • ADR 0021  ◀  │ Tags: storage, data                          │
│     • ADR 0020       │                                             │
│   ▸ Summaries        │ …page content…                              │
│ ▸ High-Level Designs │                                             │
│ ▸ Runbooks           │                                             │
│ ▸ Applications       │                                             │
│ ▸ Libraries          │                                             │
│ ▸ Other pages        │                                             │
├──────────────────────┴─────────────────────────────────────────────┤
│ dataris-spec · v1.4.0 (a29f9a2) · Generated by RealDocs 0.4.0       │  footer
└────────────────────────────────────────────────────────────────────┘
```

- **Bootstrap 5.3.9** (exact version, npm dependency) CSS and bundle JS copied into `assets/` with its
  license, like Mermaid. Bootstrap's default theme, unmodified: navbar, `nav-pills` sidebar with
  `collapse` groups, `breadcrumb`, `offcanvas-lg`, `table`, and utility classes. The only extra CSS
  positions the sticky sidebar and turns the group chevron. Mermaid uses its `default` theme; the file
  map's `--wiki-*` tokens alias Bootstrap's variables.
- **Header**: project title linking home; links to Tags (when tags exist), File map (with `--graph`),
  and the source repository (when `sourceUrl` is set). On narrow screens a ☰ button opens the sidebar
  as an offcanvas panel.
- **Sidebar**: a **Home** link (`index.html`), then the full navigation tree: configured/alphabetical
  categories, then Code reference (uncategorized sections), then Other pages. There is no built-in
  "Overview" group.
  The current page's branch is expanded and the page highlighted
  (`aria-current="page"`); other branches collapsed. Groups toggle with Bootstrap's collapse; without
  JavaScript the current branch is still open and every group label links to its landing page.
- **Breadcrumbs**: Home › category › each sub-group › page; every crumb links to a real page.
  Uncategorized pages: Home › section (as today) › page, or Home › Other pages › page.
- **Footer**: project name; release version and short commit when a release is known; "Generated by
  RealDocs <version>". No build timestamp (keeps output reproducible).
- **Homepage**: the `home` page's content inside the shell. The site-wide file map moves to its own
  page `file-map.html`; section/group index pages keep their embedded maps.
- Tags page, group index pages, code pages, and guide pages all use the shell.
- Existing content styles (code, tables, Mermaid figures, C4 color fixes) are kept, scoped to the
  content area.

## Markdown output (`--format md`)

Same URLs and grouping. `index.md` renders the home page content followed by the navigation tree as
nested lists. Each page gets a breadcrumb line. No header/sidebar/footer.

## Release manifest and impact

`release.json` (`schemaVersion: 1`) and `realdocs impact` report each symbol's page. They use the
placed output path (e.g. `applications/control-plane/main.ts.html#…`) instead of always
`modules/…`. The field shape is unchanged, so the schema version stays 1.

## File map

A file with no `zone` uses its category label as its zone, so the file map groups match the sidebar.
An explicit `zone` still wins.

## Diagnostics (`realdocs check`, `build`)

Errors: output path collisions; empty or multi-line `category`; empty slug; reserved category slug;
duplicate `category`/`path` in one file; invalid `rules` entries; unknown config fields types.
Warnings: a `groups` key that matches no group; a `categories` entry that no page uses.

## Documentation and examples

- README: document the annotations, config fields, precedence, and URL behavior.
- `.agents/skills/realdocs-bootstrap/SKILL.md`: guide agents to set categories via rules/sections
  first and in-file tags for exceptions.
- `examples/fulfillment`: add categories (e.g. "Decisions" for `docs/decisions/`, "Guides",
  section categories) so the example shows the feature.
- Acceptance check: build dataris-spec with a draft config (categories for ADRs, ADR summaries, HLDs,
  runbooks, Applications, Frontends, Libraries) and confirm no collisions, links resolve, and the
  sidebar reads as in the sketch. The dataris-spec repo itself is not modified as part of this work.

## Keeping a generator export possible

Placement and the navigation tree live in their own module, independent of HTML rendering, so a
later `--format hugo` or MkDocs export can reuse them (Hugo's `content/<section>/_index.md` maps
directly onto categories, sub-groups, and group index pages).

## Left to the builder

- Module layout (suggested: a new `src/navigation.ts` that computes placements and the tree once;
  `markdown.ts` and `html.ts` consume it).
- Glob matching implementation (Node ≥ 22; `path.matchesGlob` or a small matcher).
- Whether the sidebar tree is inlined per page or loaded from a shared file (inline preferred so it
  works without JS).
- Exact CSS variable mapping and spacing.
- Test structure (extend `test/cli.test.mjs`).

## Calls made without explicit confirmation

- In-file `path` starts at the category root, so inherited groups don't stack onto it.
- `README.md` / `index.md` automatically become their group's index page.
- `**` in a rule glob mirrors subfolders as sub-groups.
- The README homepage also applies to existing configs, and `pages/README.html` is no longer written.
- Included configs: only their `rules` carry into the combined wiki.
- No built-in "Overview" group; the sidebar starts with a Home link.

- No redirects, no search, no light theme in this version.
- Config field names: `home`, `categories`, `groups`, `rules`, `sections.<id>.category`,
  `sections.<id>.group`.
- `path` ending in `index` replaces a group's generated landing content.
- Category doubles as default file-map zone.
- First matching rule wins; first section wins for files in several sections.
- File map moves off the homepage to `file-map.html`.
