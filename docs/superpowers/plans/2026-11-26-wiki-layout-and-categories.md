# Wiki Layout, Categories, and Canonical Paths Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give every HTML wiki page a Bootstrap shell (header, sidebar tree, breadcrumbs, footer) and let authors place Markdown pages and code entry files in a category/path hierarchy that also sets their URL.

**Architecture:** A new `src/navigation.ts` computes, once per build, a `SiteMap`: the output route of every input (from in-file annotations, section settings, and folder rules in `realdocs.json`) plus the navigation tree. Every place that today calls `wikiPath(...)` for a page or module asks `pageFile(documentation, name, kind, extension)` instead. `renderWiki` (Markdown) renders home, group index pages, and breadcrumbs from the tree; a new `src/shell.ts` wraps HTML pages in the Bootstrap layout.

**Tech Stack:** TypeScript (ESM, Node ≥ 22), markdown-it, micromark, `node:test`, Bootstrap 5.3.9 (bundled, offline).

**Spec:** `docs/superpowers/specs/2026-11-26-wiki-layout-and-categories-design.md`

## Global Constraints

- Node ≥ 22; ESM; strict TypeScript as configured in `tsconfig.json`. Build with `npm run build`; tests with `npm test` (builds, then `node --test`).
- New dependency `"bootstrap": "5.3.9"` — exact version, like the other dependencies. No CDN URLs anywhere in generated output.
- Annotation names: `@realdocs:category`, `@realdocs:path` (the `@livedocs:` alias is accepted, as for `tag`/`zone`).
- Config field names: `home`, `categories`, `groups`, `rules` (`files`, `category`, `group`), `sections.<id>.category`, `sections.<id>.group`.
- Reserved category slugs: `assets`, `pages`, `modules`, `sections`, `tags`, `index`, `file-map`.
- Slug: NFC, lowercase, every run of characters outside `\p{L}\p{N}._-` becomes `-`, trimmed of `-`.
- Output stays reproducible: no timestamps in generated files.
- Keep the `--wiki-*` CSS custom properties: `assets/file-map.js` and the Mermaid runner read them.
- Work on a feature branch (e.g. `t3/wiki-layout-categories`), never on `main`.

## Review Focus

1. **Relative links across different depths** — an uncategorized page (`pages/docs/x.html`) linking to a deeply placed one (`a/b/c/d.html`) and back must produce working relative hrefs. Pinned in Task 3's placement test.
2. **Category labels differing only in case or spacing** (`Runbooks` vs `runbooks `) must merge into one category, not two folders or a collision. Pinned in Task 3.
3. **Rule globs written with `./`** (`./docs/adr/*.md`) must match like `docs/adr/*.md`. Pinned in Task 3.
4. **HTML-special characters in titles and labels** (`A & <B>`) must be escaped in the sidebar, breadcrumbs, and `<title>`. Pinned in Task 5.
5. **A page moving between builds** (category edited) must not leave its old output file behind. Pinned in Task 4.

---

## File Structure

| File | Responsibility |
| --- | --- |
| `src/model.ts` (modify) | New types: placement fields on `MarkdownContent` and `DocumentationSection`; `PlacementRule`, `Navigation`, `Route`, `NavGroup`, `NavPage`, `NavItem`, `SiteMap`. |
| `src/config.ts` (modify) | Parse and validate `home`, `categories`, `groups`, `rules`, section `category`/`group`. |
| `src/pages.ts` (modify) | Read `category`/`path` page annotations; read pages before building the link registry; call `placeDocumentation`; resolve outputs through `pageFile`. |
| `src/typescript.ts` (modify) | Read `category`/`path` inside the `@realdocs:file` block. |
| `src/navigation.ts` (create) | Slugs, labels, glob matching, placement, collisions, navigation tree. No rendering. |
| `src/markdown.ts` (modify) | `pageFile`; `renderWiki` renders from `SiteMap` (home, group pages, crumbs, file-map page); new `PageContext` renderer signature. |
| `src/shell.ts` (create) | HTML layout: header, sidebar, breadcrumbs, footer, styles. |
| `src/html.ts` (modify) | Use `shell.ts`; bundle Bootstrap assets. |
| `src/graph.ts`, `src/diagrams.ts`, `src/release.ts`, `src/impact.ts` (modify) | Use `pageFile`; graph zone falls back to category label. |
| `src/cli.ts` (modify) | Pass placement settings into `Documentation.navigation`; place when `includePages` is not used. |
| `test/fixture.mjs` (create) | Shared `fixture()` helper extracted from `test/cli.test.mjs`. |
| `test/navigation.test.mjs` (create) | Tests for this feature. |
| `README.md`, `.agents/skills/realdocs-bootstrap/SKILL.md`, `examples/fulfillment/**` (modify) | Docs and example. |

## Shared types (Task 1 adds these to `src/model.ts`; later tasks consume them)

```ts
// added to MarkdownContent
category?: string;
path?: string;
annotationErrors?: { message: string; line: number }[];

// added to DocumentationSection
category?: string;
group?: string;

export interface PlacementRule { pattern: string; category: string; group?: string } // pattern is site-relative, normalized
export interface Navigation {
  title: string; pages: string[]; sections: DocumentationSection[];
  home?: string; categories: string[]; groups: Record<string, string>; rules: PlacementRule[]; sourceUrl?: string;
}
export interface Route { file: string; category?: string }           // category = category label
export interface NavPage { kind: 'page'; label: string; file: string; source: string; code: boolean }
export interface NavGroup {
  kind: 'group'; label: string; key: string; file: string;
  index?: string;   // source name of the authored page that is this group's index
  section?: string; // section id when the group is a section landing
  children: NavItem[];
}
export type NavItem = NavGroup | NavPage;
export interface SiteMap { home: string; homeSource?: string; routes: Record<string, Route>; tree: NavGroup[] }

// Documentation: `navigation?: Navigation` (replaces the inline type) and new `site?: SiteMap`
```

---

### Task 1: Shared test fixture, model types, and config fields

**Files:**
- Create: `test/fixture.mjs`, `test/navigation.test.mjs`
- Modify: `test/cli.test.mjs:1-31` (import the fixture instead of defining it), `src/model.ts`, `src/config.ts`, `src/cli.ts:219-222`

**Interfaces:**
- Produces: `fixture(t, files)` exported from `test/fixture.mjs` (same behavior as today's helper). Types above. `Site` gains `home?: string; categories: string[]; groups: Record<string, string>; rules: PlacementRule[]; sourceUrl?: string`. `DocumentationSection` gains `category`/`group`. `cli.ts` sets `code.navigation = { title, pages, sections, home, categories, groups, rules, sourceUrl }`.

- [ ] **Step 1: Move `fixture` into `test/fixture.mjs`** (export it with its imports and the `cli` path) and import it in `test/cli.test.mjs`. Run `npm test`; expected: all existing tests pass.

- [ ] **Step 2: Write the failing test** in `test/navigation.test.mjs`

```js
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { fixture } from './fixture.mjs';

test('reads placement settings from realdocs.json and rejects invalid ones', t => {
  const project = fixture(t, {
    'README.md': '# Home\n',
    'docs/adr/0001-a.md': '# ADR 1\n',
    'realdocs.json': JSON.stringify({
      pages: ['docs/adr/0001-a.md'], home: 'README.md', categories: ['Decisions'],
      groups: { decisions: 'Architecture decisions' },
      rules: [{ files: 'docs/adr/*.md', category: 'Decisions' }],
      sections: { app: { title: 'App', category: 'Applications', group: 'apps/main', pages: ['docs/adr/0001-a.md'] } },
    }),
  });
  assert.match(project.run('check'), /and 2 Markdown page\(s\)/); // home is added as an input
  for (const [config, message] of [
    [{ pages: ['README.md'], rules: [{ files: 'docs/*.md' }] }, /rules\[0\]\.category must be a nonempty single-line string/],
    [{ pages: ['README.md'], rules: [{ files: '../x/*.md', category: 'X' }] }, /rules\[0\]\.files must be inside the config directory/],
    [{ pages: ['README.md'], rules: { files: 'x' } }, /rules must be an array/],
    [{ pages: ['README.md'], categories: 'Decisions' }, /categories must be an array of nonempty single-line strings/],
    [{ pages: ['README.md'], groups: { decisions: '' } }, /groups\.decisions must be a nonempty single-line string/],
    [{ pages: ['README.md'], sections: { a: { pages: ['README.md'], category: 5 } } }, /sections\.a\.category must be a nonempty single-line string/],
    [{ pages: ['README.md'], sections: { a: { pages: ['README.md'], group: '' } } }, /sections\.a\.group must be a nonempty single-line string/],
  ]) {
    project.write('realdocs.json', JSON.stringify(config));
    const result = project.result('check');
    assert.equal(result.status, 1);
    assert.match(result.stderr, message);
  }
});
```

- [ ] **Step 3: Run it to verify it fails.** Run: `npm run build && node --test test/navigation.test.mjs`. Expected: FAIL (no validation; the first `check` counts 1 page).

- [ ] **Step 4: Implement in `src/config.ts`.**
  - `readConfig` parses, per config: `home` (Markdown path via `inputPath`, added to that config's `pages`), `categories`, `groups`, `rules`, and `sections.<id>.category` / `.group` (allowed alongside `config`). Field labels in messages follow the existing `${label}: …` style.
  - A rule's `files` is checked like a path (not absolute, no `..` after normalizing) and stored as `pattern = posix.normalize(posix.join(<config dir relative to site root>, files))`, which also strips `./`.
  - `ConfigNavigation` carries `rules`. The root config's rules come first, then each included config's rules in section order. Only the root config's `home`, `categories`, `groups`, and section `category`/`group` reach `Site`. An included config's section categories are dropped when flattened.
  - Add the types to `src/model.ts` and set `code.navigation` in `src/cli.ts`.

- [ ] **Step 5: Run the tests.** Run: `npm test`. Expected: all pass.

- [ ] **Step 6: Commit**

```bash
git add test/fixture.mjs test/navigation.test.mjs test/cli.test.mjs src/model.ts src/config.ts src/cli.ts
git commit -m "Parse placement settings in realdocs.json"
```

---

### Task 2: `category` and `path` annotations

**Files:**
- Modify: `src/pages.ts:54-72` (`readPageAnnotations`), `src/pages.ts` `includePages` (report errors), `src/typescript.ts:255-283` (`fileOverview`), `src/typescript.ts:~396` (report errors where the entry overview is built)
- Test: `test/navigation.test.mjs`

**Interfaces:**
- Consumes: `MarkdownContent.category/path/annotationErrors` (Task 1).
- Produces: pages and module overviews carry `category` and `path` (trimmed strings). Problems become `error` diagnostics at `{ file, line, column: 1 }`, where `line` is the annotation's source line.

- [ ] **Step 1: Write the failing test**

```js
test('reads category and path annotations and reports invalid ones at their source', t => {
  const project = fixture(t, {
    'docs/ok.md': '<!-- @livedocs:category Decisions -->\n<!-- @realdocs:path a/b -->\n# OK\n',
    'docs/a.md': '<!-- @realdocs:category Decisions -->\n<!-- @realdocs:category Other -->\n# A\n',
    'docs/b.md': '<!-- @realdocs:category -->\n# B\n',
    'src/index.ts': '/**\n * @realdocs:file Entry.\n * @realdocs:path a/b\n * @realdocs:path c\n */\nexport const x = 1;\n',
  });
  const args = ['--entry', 'src/index.ts', '--page', 'docs/ok.md', '--page', 'docs/a.md', '--page', 'docs/b.md'];
  const result = project.result('check', ...args);
  assert.equal(result.status, 1);
  assert.match(result.stderr, /docs\/a\.md:2:1: error: A file can have only one @realdocs:category\./);
  assert.match(result.stderr, /docs\/b\.md:1:1: error: @realdocs:category needs a value\./);
  assert.match(result.stderr, /src\/index\.ts:4:1: error: A file can have only one @realdocs:path\./);
  assert.doesNotMatch(result.stderr, /docs\/ok\.md/);
});
```

- [ ] **Step 2: Run it to verify it fails.** Run: `npm run build && node --test test/navigation.test.mjs`. Expected: FAIL (the annotations are ignored).

- [ ] **Step 3: Implement.**
  - `readPageAnnotations`: extend the annotation regex to `(tag|zone|category|path)` and record each annotation's line.
  - `fileOverview`: read `category` and `path` from `annotations`. Use the tag's line in the source file for errors.
  - Errors, with exact wording: `A file can have only one @realdocs:category.` / `…@realdocs:path.`, `@realdocs:category needs a value.` / `@realdocs:path needs a value.`, and `@realdocs:category must be a single line.` when the JSDoc value contains a newline.
  - `includePages` turns a page's `annotationErrors` into diagnostics; the entry-module extraction in `typescript.ts` does the same for the overview.

- [ ] **Step 4: Run the tests.** Run: `npm test`. Expected: all pass.

- [ ] **Step 5: Commit**

```bash
git add src/pages.ts src/typescript.ts test/navigation.test.mjs
git commit -m "Read @realdocs:category and @realdocs:path annotations"
```

---

### Task 3: Placement engine and routes

**Files:**
- Create: `src/navigation.ts`
- Modify: `src/markdown.ts` (add `pageFile`; use it for `modules`/`pages` file paths inside `renderWiki`), `src/pages.ts` (`includePages`: read pages first, then `placeDocumentation`, then build the registry with `pageFile`), `src/cli.ts:68-71` (`prepareDocumentation` calls `placeDocumentation` when `includePages` is absent), `src/graph.ts:35` and its zone fallback, `src/diagrams.ts:174,206,209`, `src/release.ts:72`, `src/impact.ts:71`
- Test: `test/navigation.test.mjs`

**Interfaces:**
- Consumes: `Navigation`, the `MarkdownContent` placement fields, `wikiPath`.
- Produces:
  - `slugify(text: string): string`
  - `segmentLabel(segment: string): string`
  - `globToRegExp(pattern: string): RegExp` — supports `*`, `**`, `?`
  - `staticPrefix(pattern: string): string` — the folders before the first segment that contains a wildcard, joined with `/`
  - `reservedSlugs: readonly string[]`
  - `placeDocumentation(documentation: Documentation, extension: PageExtension): Documentation` — returns a copy with `site` set and diagnostics appended
  - all of the above exported from `src/navigation.ts`, plus `pageFile(documentation: Documentation, name: string, kind: 'modules' | 'pages', extension: PageExtension): string` in `src/markdown.ts` (returns `site.routes[name].file`, else `wikiPath(name, kind, extension)`)

- [ ] **Step 1: Write the failing unit test**

```js
import { globToRegExp, segmentLabel, slugify, staticPrefix } from '../dist/navigation.js';

test('slugs, labels, and globs follow the placement rules', () => {
  assert.equal(slugify('Architecture Decisions'), 'architecture-decisions');
  assert.equal(slugify('  Ünïcode — Stuff!! '), 'ünïcode-stuff');
  assert.equal(slugify('0025-workspaces.summary'), '0025-workspaces.summary');
  assert.equal(slugify('!!!'), '');
  assert.equal(segmentLabel('category-c'), 'Category c');
  assert.equal(segmentLabel('Storage Layer'), 'Storage Layer');
  assert.ok(globToRegExp('docs/hld/**/*.md').test('docs/hld/data-service/README.md'));
  assert.ok(globToRegExp('docs/hld/**/*.md').test('docs/hld/0010-x.md'));
  assert.ok(!globToRegExp('docs/adr/*.md').test('docs/adr/summaries/x.md'));
  assert.ok(globToRegExp('docs/?.md').test('docs/a.md'));
  assert.equal(staticPrefix('docs/hld/**/*.md'), 'docs/hld');
  assert.equal(staticPrefix('*.md'), '');
});
```

- [ ] **Step 2: Write the failing placement test**

```js
import { existsSync } from 'node:fs';
import { join } from 'node:path';

test('places pages and entries by annotation, section, and rule, and rewrites links', t => {
  const project = fixture(t, {
    'README.md': '# Shop\n\nSee [ADR 21](docs/adr/0021-store.md#context).\n',
    'docs/adr/README.md': '# Decisions index\n',
    'docs/adr/0021-store.md': '<!-- @realdocs:path storage/category-c/0021-jsonb -->\n# ADR 21\n\n## Context\n\n[Runbook](../runbooks/deploy.md) [Notes](../notes.md)\n',
    'docs/adr/0025-workspaces.md': '# ADR 25\n',
    'docs/hld/data-service/README.md': '# Data service HLD\n',
    'docs/hld/tenant/README.md': '# Tenant HLD\n',
    'docs/runbooks/deploy.md': '# Deploy\n\n[Back](../adr/0021-store.md)\n',
    'docs/extra.md': '<!-- @realdocs:category  runbooks  -->\n# Extra\n',
    'docs/notes.md': '# Notes\n\n[ADR](adr/0021-store.md)\n',
    'src/main.ts': '/** @realdocs:file Boot. */\nexport const boot = () => 1;\n',
    'src/tools.ts': '/**\n * @realdocs:file Tools.\n * @realdocs:category Utilities\n */\nexport const tool = 1;\n',
    'realdocs.json': JSON.stringify({
      pages: ['README.md', 'docs/adr/README.md', 'docs/adr/0021-store.md', 'docs/adr/0025-workspaces.md',
        'docs/hld/data-service/README.md', 'docs/hld/tenant/README.md', 'docs/runbooks/deploy.md',
        'docs/extra.md', 'docs/notes.md'],
      rules: [
        { files: './docs/adr/*.md', category: 'Architecture Decisions' },
        { files: 'docs/hld/**/*.md', category: 'High-Level Designs' },
        { files: 'docs/runbooks/*.md', category: 'Runbooks' },
      ],
      sections: { app: { title: 'App', category: 'Applications', entries: ['src/main.ts', 'src/tools.ts'] } },
    }),
  });
  project.run('build', '--out', 'wiki');
  const exists = file => existsSync(join(project.cwd, 'wiki', file));
  for (const file of [
    'index.md',
    'architecture-decisions/index.md',
    'architecture-decisions/storage/category-c/0021-jsonb.md',
    'architecture-decisions/0025-workspaces.md',
    'high-level-designs/data-service/index.md',
    'high-level-designs/tenant/index.md',
    'runbooks/deploy.md',
    'runbooks/extra.md',
    'pages/docs/notes.md',
    'applications/app/main.ts.md',
    'utilities/tools.ts.md',
  ]) assert.ok(exists(file), file);
  assert.equal(exists('pages/README.md'), false);
  assert.match(project.read('wiki/index.md'), /\(architecture-decisions\/storage\/category-c\/0021-jsonb\.md#context\)/);
  assert.match(project.read('wiki/runbooks/deploy.md'), /\(\.\.\/architecture-decisions\/storage\/category-c\/0021-jsonb\.md\)/);
  const adr = project.read('wiki/architecture-decisions/storage/category-c/0021-jsonb.md');
  assert.match(adr, /\(\.\.\/\.\.\/\.\.\/runbooks\/deploy\.md\)/);
  assert.match(adr, /\(\.\.\/\.\.\/\.\.\/pages\/docs\/notes\.md\)/);
  assert.match(project.read('wiki/pages/docs/notes.md'), /\(\.\.\/\.\.\/architecture-decisions\/storage\/category-c\/0021-jsonb\.md\)/);
});

test('reports output collisions, reserved categories, and unused labels', t => {
  const project = fixture(t, {
    'docs/a.md': '<!-- @realdocs:category Guides -->\n<!-- @realdocs:path same -->\n# A\n',
    'docs/b.md': '<!-- @realdocs:category guides -->\n<!-- @realdocs:path same -->\n# B\n',
    'docs/c.md': '<!-- @realdocs:category Assets -->\n# C\n',
    'realdocs.json': JSON.stringify({
      pages: ['docs/a.md', 'docs/b.md', 'docs/c.md'],
      categories: ['Missing'], groups: { 'guides/nothing': 'X' },
    }),
  });
  const result = project.result('check');
  assert.equal(result.status, 1);
  assert.match(result.stderr, /docs\/b\.md:\d+:1: error: Pages docs\/a\.md and docs\/b\.md both resolve to guides\/same\.md\./);
  assert.match(result.stderr, /docs\/c\.md:1:1: error: Category "Assets" uses the reserved name assets\./);
  assert.match(result.stderr, /warning: groups key guides\/nothing matches no group\./);
  assert.match(result.stderr, /warning: categories entry Missing is not used by any page\./);
});

test('versioned manifests, impact reports, and the file map use placed routes', t => {
  const project = fixture(t, {
    '.gitignore': 'dist/\n',
    'realdocs.json': JSON.stringify({ pages: ['docs/guide.md'], rules: [{ files: 'docs/*.md', category: 'Guides' }],
      sections: { api: { category: 'API', entries: ['src/index.ts'] } } }),
    'src/index.ts': '/** @realdocs:docId app.hello */\nexport function hello() { return "world"; }',
    'docs/guide.md': '# Guide\n',
  });
  const git = (...args) => execFileSync('git', args, { cwd: project.cwd, encoding: 'utf8', stdio: 'pipe' });
  git('init', '-q');
  git('add', '.');
  git('-c', 'user.name=RealDocs Test', '-c', 'user.email=realdocs@example.invalid', '-c', 'commit.gpgsign=false', 'commit', '-qm', 'Base');
  project.run('build', '--version', '1.0.0');
  const release = JSON.parse(project.read('dist/realdocs-releases/1.0.0/release.json'));
  assert.equal(release.symbols[0].page, 'api/api/index.ts.md#doc-app.hello');
  project.write('docs/guide.md', '# Guide edited\n');
  const impact = JSON.parse(project.run('diff', '--base', 'HEAD', '--json'));
  assert.deepEqual(impact.affected.map(item => item.page), ['guides/guide.md']);
  project.run('build', '--graph', '--format', 'html', '--out', 'site');
  const data = JSON.parse(project.read('site/file-map.html').match(/id="file-map-data">(.*?)<\/script>/s)[1]);
  assert.deepEqual(data.nodes.find(node => node.path === 'docs/guide.md').zone, 'Guides');
});
```

The last test also needs `import { execFileSync } from 'node:child_process';`. Its final three lines depend on Task 4's `file-map` page: write them now, but expect only that block to fail until Task 4 is done.

- [ ] **Step 3: Run them to verify they fail.** Run: `npm run build && node --test test/navigation.test.mjs`. Expected: FAIL (`dist/navigation.js` is missing).

- [ ] **Step 4: Implement `src/navigation.ts`.** The algorithm the signatures don't determine:
  1. **Inputs.** Each page (`page.name`, content = the page) and each module (`module.name`, content = `module.overview`).
  2. **Layers.** `inFile = { category, path }` from the content. `section` = the first section in `navigation.sections` that lists the name and has a `category`. `rule` = the first `navigation.rules` entry whose `globToRegExp(pattern)` matches the name.
  3. **Category.** `inFile.category ?? section?.category ?? rule?.category`. If none, the file is unplaced: its route is `wikiPath(name, kind, extension)`.
  4. **Groups.**
     - If `inFile.path` or `inFile.category` is set: the path's segments except the last (or none).
     - Else, for a section: `slugify` of each segment of `section.group ?? section.id`.
     - Else, for a rule: the segments of `rule.group`, followed by the folders of `posix.dirname(name)` after `staticPrefix(pattern)`.
  5. **Page name.**
     - The last `path` segment, slugified, when an in-file `path` exists.
     - Else `index` when the basename is `README.md` or `index.md` (case-insensitive).
     - Else `slugify(basename)`: pages drop `.md`; modules keep their extension (`main.ts`).
  6. **Route.** `[slugify(category), ...groups, name].join('/') + '.' + extension`.
     - A name of `index` makes the file that group's authored index (`NavGroup.index`).
     - The home source is `navigation.home`, else `README.md` when it is a page. Its route is always `index.<extension>`.
  7. **Diagnostics.**
     - An empty slug is an error.
     - A reserved category slug is an error with the exact message above.
     - Two sources with one route is an error located at the later source (sorted by name), using the exact message above.
     - Unused `groups` keys and `categories` entries are warnings. Located diagnostics point at the annotation line, or line 1 when the placement comes from config.
  8. **Category labels.** Merge categories by slug. The label is the `categories` entry with that slug, else the trimmed label from the alphabetically first source that sets it.
  9. **Tree.**
     - One top-level `NavGroup` per category: config order first, then the rest alphabetically by label.
     - Sub-groups are keyed by slug path. Labels come from a `groups` override, else the section title for section groups, else `segmentLabel` of the segment as written.
     - Then a synthetic `Code reference` group (`key: 'sections'`, file `sections/index.<ext>`). It holds each uncategorized section as a group (`key: 'sections/<id>'`, file `sections/<id>/index.<ext>`, `section: id`) containing that section's unplaced pages and modules, followed by unplaced modules that belong to no section.
     - Then a synthetic `Other pages` group (`key: 'pages'`, file `pages/index.<ext>`) holding unplaced pages that are in no uncategorized section.
     - Omit empty synthetic groups. The home page is not in the tree.
     - Group files are `<key>/index.<ext>`. Within a group, sub-groups come first (natural order by key), then pages in natural order by route file (`Intl.Collator(undefined, { numeric: true })`).
     - Page labels: `page.title`, or the module's basename.
  10. **Routes** record `category` (the label) for placed sources.

- [ ] **Step 5: Wire routes through.**
  - `includePages`: read every page before building the registry; call `placeDocumentation`; then use `pageFile` for the outputs of both modules and pages.
  - `prepareDocumentation` in `cli.ts`: `options.includePages?.(...) ?? placeDocumentation(extractedCode, options.extension)`.
  - Replace every `wikiPath(<module or page name>, …)` call listed under **Files** with `pageFile(documentation, …)`.
  - In `graph.ts`, a node's zone is `node.zone ?? routes[path]?.category ?? <today's dirname fallback>`.

- [ ] **Step 6: Run the tests.** Run: `npm test`.
  - Expected: Task 3's tests pass, except the file-map block, which waits for Task 4.
  - Existing tests that assert `pages/README.*` or homepage lists may fail now. That's expected; Task 4 rewrites them. Note which ones fail.

- [ ] **Step 7: Commit**

```bash
git add src/navigation.ts src/markdown.ts src/pages.ts src/cli.ts src/graph.ts src/diagrams.ts src/release.ts src/impact.ts test/navigation.test.mjs
git commit -m "Place pages and entries by category, path, section, and rule"
```

---

### Task 4: Markdown wiki structure: home, group pages, breadcrumbs, file map page

**Files:**
- Modify: `src/markdown.ts:9-11` (types) and `renderWiki` (`:140-260`), `src/html.ts` (adapt to the new renderer signature only; the shell comes in Task 5), `test/cli.test.mjs` (update assertions on the old homepage, section links, breadcrumbs, and `index.*` file map)
- Test: `test/navigation.test.mjs`

**Interfaces:**
- Consumes: `SiteMap`, `pageFile`.
- Produces in `src/markdown.ts`:
  ```ts
  export interface Crumb { label: string; file: string }
  export interface PageContext {
    file: string; title: string; blocks: readonly PageBlock[];
    crumbs: readonly Crumb[]; // ancestors from Home down; excludes the page itself; empty for the home page
    section?: DocumentationSection;
  }
  export type PageRenderer = (page: PageContext) => string;
  export function crumbsFor(site: SiteMap, file: string, home: string): Crumb[]
  ```
  `renderWiki(documentation, extension, renderPage?, renderGraph?)` keeps its parameters; `renderPage` is now a `PageRenderer`.

- [ ] **Step 1: Write the failing test**

```js
test('renders home, group index pages, breadcrumbs, and a file map page in Markdown', t => {
  const project = fixture(t, {
    'README.md': '# Shop\n\nWelcome.\n',
    'docs/adr/README.md': '# Decisions\n\nHow we decide.\n',
    'docs/adr/0002-b.md': '<!-- @realdocs:path storage/0002-b -->\n# ADR 2\n',
    'docs/adr/0010-c.md': '# ADR 10\n',
    'docs/adr/0009-a.md': '# ADR 9\n',
    'docs/notes.md': '# Notes\n',
    'src/index.ts': '/** @realdocs:file Entry. */\nexport const x = 1;\n',
    'realdocs.json': JSON.stringify({
      pages: ['README.md', 'docs/adr/README.md', 'docs/adr/0002-b.md', 'docs/adr/0010-c.md', 'docs/adr/0009-a.md', 'docs/notes.md'],
      groups: { 'decisions/storage': 'Storage layer' },
      rules: [{ files: 'docs/adr/*.md', category: 'Decisions' }],
      sections: { api: { title: 'API', entries: ['src/index.ts'] } },
    }),
  });
  project.run('build', '--out', 'wiki', '--graph');
  const home = project.read('wiki/index.md');
  assert.match(home, /^# Shop\n\nWelcome\./m);
  assert.match(home, /- \[Decisions\]\(decisions\/index\.md\)\n  - \[Storage layer\]\(decisions\/storage\/index\.md\)/);
  assert.match(home, /- \[Code reference\]\(sections\/index\.md\)/);
  assert.match(home, /- \[Other pages\]\(pages\/index\.md\)\n  - \[Notes\]\(pages\/docs\/notes\.md\)/);
  assert.match(home, /\[File map\]\(file-map\.md\)/);
  assert.doesNotMatch(home, /```mermaid/);
  assert.match(project.read('wiki/file-map.md'), /^## File map\n\n```mermaid/m);

  const decisions = project.read('wiki/decisions/index.md');
  assert.match(decisions, /^# Decisions\n\nHow we decide\./m);
  // sub-groups first, then pages in natural order: 0009 before 0010
  assert.match(decisions, /\[Storage layer\]\(storage\/index\.md\)[\s\S]*\[ADR 9\]\(0009-a\.md\)[\s\S]*\[ADR 10\]\(0010-c\.md\)/);
  assert.match(project.read('wiki/decisions/storage/0002-b.md'),
    /^\[Home\]\(\.\.\/\.\.\/index\.md\) › \[Decisions\]\(\.\.\/index\.md\) › \[Storage layer\]\(index\.md\)$/m);
  assert.match(project.read('wiki/sections/api/index.md'), /\[index\.ts\]\(\.\.\/\.\.\/modules\/src\/index\.ts\.md\)/);
  assert.match(project.read('wiki/sections/api/index.md'), /## File map/);

  // moving a page removes its old output
  project.write('docs/notes.md', '<!-- @realdocs:category Guides -->\n# Notes\n');
  project.run('build', '--out', 'wiki');
  assert.ok(existsSync(join(project.cwd, 'wiki/guides/notes.md')));
  assert.equal(existsSync(join(project.cwd, 'wiki/pages/docs/notes.md')), false);
});

test('generates a home page from the tree when there is no README', t => {
  const project = fixture(t, { 'src/index.ts': 'export const x = 1;\n' });
  project.run('build', '--entry', 'src/index.ts', '--out', 'wiki');
  assert.match(project.read('wiki/index.md'), /^# Project documentation\n[\s\S]*- \[Code reference\]\(sections\/index\.md\)\n  - \[index\.ts\]\(modules\/src\/index\.ts\.md\)/m);
});
```

- [ ] **Step 2: Run it to verify it fails.** Run: `npm run build && node --test test/navigation.test.mjs`. Expected: FAIL.

- [ ] **Step 3: Implement `renderWiki` from `documentation.site`.** Placement makes `site` always present after `prepareDocumentation`.
  - **Home (`index.<ext>`).**
    - Content is the home page's content if there is a home source, else `# <title>`.
    - Markdown home: then a links line (`[Tags](tags.md)` when tags exist, `[File map](file-map.md)` when there is a file graph, joined with ` · `), then the whole tree as a nested list. Each level is indented two spaces, and each item is `- [label](href)`.
    - HTML home: only the generated title and tree when there is no home source.
  - **Group pages (one per `NavGroup`, at `group.file`).**
    - The authored index page's content if `group.index` is set, else `# <label>`.
    - Then a list of direct children.
    - Then `renderGraph(file, section)` when `group.section` is set and a graph renderer is present.
    - The page title is the index page's title or the label.
  - **Guide and code pages.** Rendered at their routes, as today, without the old breadcrumb block. Module pages keep their `# \`name\``, tags, overview, and exports.
  - **`file-map.<ext>`.** When `documentation.fileGraph` is set: title `File map`, blocks = `[renderGraph(file)]`. It is no longer appended to home.
  - **Tags page.** Unchanged, apart from its `[Home]` line now being crumbs.
  - **Crumbs.** `crumbsFor` walks the tree to the first occurrence of `file` and returns `Home` followed by each ancestor group. A group page's crumbs exclude the group itself.
  - `markdownPage` writes a crumb line `[Home](…) › [Group](…)` as the first block when `crumbs` is non-empty, then the blocks as today.
  - Remove the old `sectionsByFile`, `sectionLinks`, `pageLinks`, `moduleLinks`, and `breadcrumbs` code.
  - In `html.ts`, change only the callback to accept a `PageContext`. Keep today's `<main>` output until Task 5, emitting crumbs as a `<p>` line so existing HTML assertions stay meaningful.

- [ ] **Step 4: Update the affected existing tests in `test/cli.test.mjs`.** Change only the assertions that encode behavior the spec replaces:
  - homepage section and guide lists become the tree list or `sections/index`;
  - `pages/README.*` becomes `index.*`;
  - `Home · Section` breadcrumbs become `›` crumbs;
  - the file map on `index.*` moves to `file-map.*`.

  The tests at lines ~241, 287, 314, 449, 619, 856, and 908 are expected to need this. Do not weaken unrelated assertions.

- [ ] **Step 5: Run the tests.** Run: `npm test`. Expected: all pass, including Task 3's file-map block.

- [ ] **Step 6: Commit**

```bash
git add src/markdown.ts src/html.ts test/navigation.test.mjs test/cli.test.mjs
git commit -m "Render home, group pages, and breadcrumbs from the navigation tree"
```

---

### Task 5: Bootstrap HTML shell

**Files:**
- Create: `src/shell.ts`
- Modify: `src/html.ts` (`htmlPage` → `renderShell`; add Bootstrap assets; move the content CSS under `.wiki-content`), `package.json` + `package-lock.json` (`"bootstrap": "5.3.9"`)
- Test: `test/navigation.test.mjs`

**Interfaces:**
- Consumes: `PageContext`, `Crumb`, `SiteMap`, `Documentation.navigation.sourceUrl`, `Documentation.release`.
- Produces in `src/shell.ts`:
  ```ts
  export interface ShellOptions {
    page: PageContext; content: string; head: string;
    documentation: Documentation; hasTags: boolean;
  }
  export function renderShell(options: ShellOptions): string
  export function renderSidebar(site: SiteMap, file: string): string
  ```

- [ ] **Step 1: Install Bootstrap.** Run `npm install --save-exact bootstrap@5.3.9`, then `node -e "console.log(require.resolve('bootstrap/dist/css/bootstrap.min.css'), require.resolve('bootstrap/dist/js/bootstrap.bundle.min.js'))"`. Expected: two paths print. Resolve the license next to `package.json` the way `graph.ts` does for Cytoscape.

- [ ] **Step 2: Write the failing test**

```js
import { readFileSync } from 'node:fs';
const realdocsVersion = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8')).version;

test('wraps every HTML page in the offline Bootstrap shell', t => {
  const project = fixture(t, {
    'README.md': '# Shop\n',
    'docs/adr/0021-x.md': '<!-- @realdocs:path storage/0021-x -->\n<!-- @realdocs:tag data -->\n# A & <B>\n',
    'docs/adr/0022-y.md': '# ADR 22\n',
    'realdocs.json': JSON.stringify({
      sourceUrl: 'https://github.com/acme/shop/blob/main',
      pages: ['README.md', 'docs/adr/0021-x.md', 'docs/adr/0022-y.md'],
      rules: [{ files: 'docs/adr/*.md', category: 'Decisions' }],
    }),
  });
  project.run('build', '--format', 'html', '--out', 'site', '--graph');
  const page = project.read('site/decisions/storage/0021-x.html');
  assert.match(page, /<html lang="en" data-bs-theme="dark">/);
  assert.match(page, /<link rel="stylesheet" href="\.\.\/\.\.\/assets\/bootstrap\.min\.css">/);
  assert.match(page, /<script defer src="\.\.\/\.\.\/assets\/bootstrap\.bundle\.min\.js"><\/script>/);
  assert.doesNotMatch(page, /(?:src|href)="https?:\/\/(?!github\.com\/acme)/);
  assert.match(page, /<title>A &amp; &lt;B&gt; · /);
  // header
  assert.match(page, /<a class="navbar-brand" href="\.\.\/\.\.\/index\.html">/);
  assert.match(page, /href="\.\.\/\.\.\/file-map\.html"/);
  assert.match(page, /href="https:\/\/github\.com\/acme\/shop\/blob\/main"/);
  // breadcrumbs: every crumb links, the page itself is the active item
  assert.match(page, /<nav aria-label="breadcrumb">[\s\S]*href="\.\.\/\.\.\/index\.html">Home<\/a>[\s\S]*href="\.\.\/index\.html">Decisions<\/a>[\s\S]*href="index\.html">Storage<\/a>[\s\S]*aria-current="page">A &amp; &lt;B&gt;</);
  // sidebar: current branch open, current page marked, other branches closed
  assert.match(page, /<details open>\s*<summary><a href="\.\.\/index\.html">Decisions<\/a>/);
  assert.match(page, /<a href="0021-x\.html" aria-current="page">A &amp; &lt;B&gt;<\/a>/);
  // footer
  assert.match(page, new RegExp(`Generated by RealDocs ${realdocsVersion.replaceAll('.', '\\.')}`));
  for (const asset of ['bootstrap.min.css', 'bootstrap.bundle.min.js', 'bootstrap.LICENSE']) {
    assert.ok(existsSync(join(project.cwd, 'site/assets', asset)), asset);
  }
  assert.match(project.read('site/index.html'), /<h1[^>]*>Shop<\/h1>/);
  assert.match(project.read('site/tags.html'), /<nav aria-label="breadcrumb">/);
  assert.match(project.read('site/file-map.html'), /id="file-map-data"/);
});
```

- [ ] **Step 3: Run it to verify it fails.** Run: `npm run build && node --test test/navigation.test.mjs`. Expected: FAIL.

- [ ] **Step 4: Implement `src/shell.ts` and wire it into `html.ts`.**

  **Markup**
  - `<html lang="en" data-bs-theme="dark">`.
  - The `<title>` is `<page title> · <project title>`, or just the project title on the home page.
  - A skip link to `#content`.
  - **Header:** `<header>` with a Bootstrap navbar.
    - `navbar-brand`: the project title, linking home.
    - A `☰` toggler, visible below `lg`, targeting the sidebar offcanvas.
    - Links to Tags (`hasTags`), File map (`fileGraph`), and `Source ↗` (`navigation.sourceUrl ?? release.repository`).
  - **Sidebar:** `<nav class="wiki-sidebar offcanvas-lg offcanvas-start" aria-label="Documentation">`.
    - A Home link, then `renderSidebar`.
    - Groups are `<details>` elements with `open` only on the current page's ancestors (and on the current group page itself), and a `<summary><a href>` label.
    - Pages are list items, with `aria-current="page"` on the current one.
    - Long labels are truncated with CSS ellipsis and carry a `title` attribute.
  - **Main:** `<main id="content" class="wiki-content">` holds the Bootstrap `breadcrumb` (when `crumbs` is non-empty) and the page HTML.
  - **Footer:** `<footer>` with `<project title> · <release.version> (<first 7 chars of release.commit>) · Generated by RealDocs <version>`, omitting the release part when there is no release. The version is read from RealDocs' own `package.json` via `createRequire`.
  - Escape every label, title, and URL with markdown-it's `escapeHtml`.

  **Styles**
  - Keep the existing content CSS, scoped under `.wiki-content`.
  - Map the Bootstrap variables to the `--wiki-*` palette: `--bs-body-bg: var(--wiki-page)`, `--bs-body-color: var(--wiki-ink)`, `--bs-link-color: var(--wiki-accent)`, `--bs-border-color: var(--wiki-line)`, and serif headings.
  - The layout is a two-column grid at `lg` and up, with a sticky, independently scrolling sidebar.
  - Name shell classes with the `wiki-` prefix. `assets/file-map.css` already uses `.sidebar`, `.workspace`, and `.selection`, so check that the file map still renders correctly inside `.wiki-content`.

  **Assets**
  - Bootstrap's CSS and JS go in every HTML build. Record them in `files` alongside the Mermaid and graph assets so `pages` counts stay correct.
  - Remove the `.wiki-index` / `.wiki-directory` CSS and the `directory` branch in `htmlPage`.

- [ ] **Step 5: Run the tests.** Run: `npm test`. Expected: all pass; update existing HTML assertions that relied on `<main class="wiki-index">` only.

- [ ] **Step 6: Visual check.** Build the fulfillment example as HTML and open `examples/fulfillment/dist/realdocs/index.html` with the html_preview/html_render tools:
  - at desktop width;
  - at 390px wide, where the ☰ button must open the sidebar;
  - on a page with a Mermaid diagram;
  - on `file-map.html`.

  Fix any layout breakage before committing.

- [ ] **Step 7: Commit**

```bash
git add src/shell.ts src/html.ts package.json package-lock.json test/navigation.test.mjs test/cli.test.mjs
git commit -m "Wrap HTML pages in a Bootstrap shell with sidebar, breadcrumbs, and footer"
```

---

### Task 6: Documentation, skill, and example

**Files:**
- Modify: `README.md` (Project configuration, Homepage and file map, new "Categories and paths" section, the `--graph` paragraph that says the file map is on the homepage), `.agents/skills/realdocs-bootstrap/SKILL.md`, `examples/fulfillment/realdocs.json`, `examples/fulfillment/docs/decisions/reservation-lifecycle.md`, `examples/realdocs.json` if it needs a category for the combined wiki
- Test: `npm test` plus building the example

- [ ] **Step 1: README.** Document:
  - the two annotations, in Markdown and `@realdocs:file` form;
  - the new config fields (extend the field table);
  - precedence, and that in-file `path` starts at the category root;
  - README/`index.md` group landing pages and `**` mirroring;
  - URL behavior and collisions;
  - the homepage (`home`), `file-map.html`, and the layout.

  Follow the existing README voice: short declarative sentences, with examples drawn from the spec's dataris tables.

- [ ] **Step 2: Skill.** In `realdocs-bootstrap/SKILL.md`, add a step: place guides with `rules` and section `category` first, and use in-file `@realdocs:category`/`@realdocs:path` only for exceptions. Run `realdocs check --strict` to catch collisions.

- [ ] **Step 3: Example.** In `examples/fulfillment/realdocs.json`, add:
  - `rules` putting `docs/decisions/*.md` under "Decisions" and other `docs/*.md` under "Guides";
  - a `category` on each section ("Services", "Integrations", etc., as fits the example).

  Give `reservation-lifecycle.md` an in-file `@realdocs:path` so the example shows a sub-group.

- [ ] **Step 4: Verify.** Run `npm test`, then `(cd examples/fulfillment && node ../../dist/cli.js check --strict && node ../../dist/cli.js build --format html --graph)`. Expected: tests pass; check prints no warnings; the build succeeds.

- [ ] **Step 5: Commit**

```bash
git add README.md .agents/skills/realdocs-bootstrap/SKILL.md examples
git commit -m "Document categories, paths, and the new wiki layout"
```

---

### Task 7: Acceptance build of dataris-spec (no changes to that repo)

**Files:** none in this repo. Scratch copy only.

- [ ] **Step 1: Make a scratch copy.**

```bash
S=<scratchpad>/dataris && mkdir -p "$S" && rsync -a --exclude node_modules --exclude dist --exclude .git /home/danb/Projects/dataris-spec/ "$S/" && ln -s /home/danb/Projects/dataris-spec/node_modules "$S/node_modules"
```

- [ ] **Step 2: Write a draft `realdocs.json` in the copy only.** Add:
  - `categories`: Architecture Decisions, High-Level Designs, Runbooks, Applications, Frontends, Libraries;
  - `rules`, in this order: `docs/adr/summaries/*.md` (group `summaries`), `docs/adr/examples/*.md` (group `examples`), `docs/adr/*.md`, `docs/hld/summaries/*.md` (group `summaries`), `docs/hld/**/*.md`, `docs/runbooks/*.md`;
  - section categories: `Applications` for the apps and runner, `Frontends` for the two client sections, `Libraries` for the `libs/*` sections.

- [ ] **Step 3: Build.** Run from the copy: `node /home/danb/.t3/projects/livedocs/dist/cli.js check` and then `… build --format html --graph`. Expected:
  - no collision errors;
  - no new link warnings compared with the same commands run against the unmodified repo using the `main`-branch CLI (compare the stderr of the two runs);
  - `index.html` renders the README.

- [ ] **Step 4: Look at it.** Render `index.html`, an ADR page, `high-level-designs/index.html`, and a library section page with html_preview/html_render. Confirm the sidebar matches the spec's sketch: categories in the configured order, ADR 0009 before 0010, summaries as a sub-group, the current branch open. Report any differences to the user before finishing.

---

## Self-review notes

- **Spec coverage.**
  - Annotations: Task 2. Config: Task 1. Precedence, slugs, labels, reserved names, collisions, README/`index` handling, `**` mirroring, included-config rules: Task 3.
  - Home, group pages, Markdown crumbs, file-map page: Task 4. HTML shell, offline assets, footer, header links: Task 5.
  - Release, impact, and file-map zone: Task 3. Docs and example: Task 6. Acceptance: Task 7.
  - Non-goals (search, redirects, light theme, per-symbol placement, `init` suggestions, table of contents) have no tasks.
- **Calls this plan makes beyond the spec.** Each is flagged in the step that implements it:
  - The Markdown build also moves the file map to `file-map.md`.
  - `Code reference` and `Other pages` index pages live at `sections/index.*` and `pages/index.*`.
  - Placement uses the first section that lists the file *and has a category*.
  - `home` is added as an input automatically.
