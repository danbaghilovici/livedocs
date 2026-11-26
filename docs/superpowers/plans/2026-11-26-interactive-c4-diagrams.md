# Interactive C4 Page Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add `--c4`, which builds a standalone, drill-down C4 architecture page (`c4.html`) into the HTML wiki from the C4 Mermaid blocks authors already write, plus `@realdocs:c4 <path>` markers that attach guides, diagrams, and code to each element.

**Architecture:** A new build-time step, `compileC4`, runs after `compileDiagrams` in the shared preparation path, so `check` and `build` report the same diagnostics. It parses C4 fences into views, derives levels and dotted paths, collects markers into panel items, strips marker comments from the rendered pages, and validates everything. `renderHtmlWiki` writes `c4.html` with the model embedded as JSON. A client script (`assets/c4.js`, ported from the prototype) renders each level with the wiki's Mermaid runtime.

**Tech Stack:** TypeScript 6 (NodeNext ESM), markdown-it 15, Mermaid 12.3 (browser), `node:test`.

**Spec:** `docs/superpowers/specs/2026-11-26-interactive-c4-diagrams-design.md`. The reference client is `docs/superpowers/specs/2026-11-26-interactive-c4-prototype.html`.

## Global Constraints

- Projects that pass no `--c4` and contain no `@realdocs:c4` marker get byte-identical output and identical diagnostics, including under `check --strict`.
- `--c4` is accepted by `build`, `check`, and `watch` only. `build`/`watch` with `--c4` require `--format html`. `check --c4` does not.
- The marker forms are exactly: `<!-- @realdocs:c4 <path> -->` (page annotation block, or the first non-blank line after a heading), `%% @realdocs:c4 <path>` (inside a top-level mermaid fence, before the diagram type line), and `@realdocs:c4 <path>` in a `@realdocs:file` comment or an export's JSDoc. The `livedocs:` namespace alias is accepted wherever `realdocs:` is, as for existing annotations.
- Paths match `/^[a-zA-Z][a-zA-Z0-9._-]*$/` (the `@realdocs:docId` rule).
- Tabs are fixed: `overview`, `diagrams`, `docs`, `code`.
- `c4.html` sits at the wiki root and reuses `assets/mermaid.min.js`. The new assets are `assets/c4.js` and `assets/c4.css`.
- Node.js ≥ 22. No new runtime dependencies.
- Scope is RealDocs only. Do not edit dataris-spec.

## Review Focus

1. **A marker comment in HTML output.** HTML output escapes raw HTML, so an unstripped `<!-- @realdocs:c4 … -->` would show up as visible text on a wiki page. Pinned in Task 3: `markers never appear in either wiki format`.
2. **Peers that reference each other.** Two containers that each appear in the other's component view must not make navigation loop. Paths come from declarations, never from the order the reader visits views. Pinned in Task 2: `peer references do not change paths`.
3. **CRLF and indented `@realdocs:file` overviews.** Fences in JSDoc overviews arrive already de-indented, and pages arrive normalized to `\n`. The parser must not assume column 0 or a trailing newline. Pinned in Task 1: `parses an indented fence body and a missing closing fence`.
4. **Labels with commas, quotes, and `$` keyword arguments.** `Container(api, "Orders, Returns", "Node.js", $tags="v1")` must parse to the label `Orders, Returns` and ignore `$tags`. Pinned in Task 1.
5. **`</script>` inside embedded content.** Marked Markdown or Mermaid source containing `</script>` must not break out of the JSON block. Pinned in Task 4: `escapes embedded data`.

---

## File Structure

| File | Responsibility |
| --- | --- |
| `src/c4-views.ts` (new) | Parse one Mermaid C4 fence body into a `C4View` (elements, boundaries, relationships, layout lines, marker lines). Pure; no I/O. |
| `src/c4.ts` (new) | `compileC4`: find fences and markers in pages and overviews, build levels, paths, and items, strip markers, and emit diagnostics. |
| `src/c4-page.ts` (new) | `renderC4Page`: turn the model into `c4.html` (embedded JSON) and register `assets/c4.js` and `assets/c4.css`. |
| `assets/c4.js`, `assets/c4.css` (new) | Browser client, ported from the prototype. |
| `src/model.ts` | New `C4*` types, `c4Marks` on `MarkdownContent` and `DocumentedSymbol`, and `c4` on `Documentation`. |
| `src/pages.ts` | `readPageAnnotations` accepts `c4`. |
| `src/typescript.ts` | `fileOverview` and `describeExports` collect `c4` annotations. |
| `src/cli.ts` | `--c4` flag, its rules, and wiring of `compileC4`. |
| `src/html.ts` | Call `renderC4Page`, and export the Markdown-to-HTML renderer. |
| `src/markdown.ts` | Add the "Architecture" link to the homepage. |
| `package.json` | Add `assets/c4.js` and `assets/c4.css` to `files`. |
| `test/c4.test.mjs` (new) | All C4 tests (parser unit tests against `dist/c4-views.js`, plus CLI tests). |
| `README.md`, `.agents/skills/*`, `.agents/realdocs-instructions.md`, `examples/fulfillment/**` | Documentation and example. |

## Shared types (added to `src/model.ts` in Task 1, extended in Task 2)

```ts
export interface C4Mark { path: string; line: number; column: number }

export interface C4Element {
  alias: string;
  kind: string;            // macro name, e.g. 'Container', 'ContainerDb', 'System_Ext'
  label: string;
  technology?: string;
  description?: string;
  line: number;            // 0-based line within the fence body
}
export interface C4Boundary { alias: string; kind: string; label: string; parent?: string; line: number } // parent = enclosing boundary alias in this view
export interface C4Relationship { from: string; to: string; label: string; technology?: string }

export interface C4View {
  type: 'C4Context' | 'C4Container' | 'C4Component';
  title: string;
  elements: (C4Element & { boundary?: string })[]; // boundary = innermost enclosing boundary alias in this view
  boundaries: C4Boundary[];
  relationships: C4Relationship[];
  layout?: string;         // the UpdateLayoutConfig line, verbatim
  source: string;          // fence body with marker lines removed
  marks: C4Mark[];         // %% markers before the type line (line relative to the body)
  misplacedMarks: C4Mark[];// %% markers after the type line
}
```

Task 2 adds the model types that the page consumes:

```ts
export interface C4PlacedView { title: string; type: C4View['type']; origin: string; href: string; source: string; relationships: C4Relationship[] }
export interface C4Level { key: string; path: string; label: string; type: C4View['type']; views: C4PlacedView[]; merged?: string }
export interface C4ModelElement {
  alias: string; path: string; kind: string; label: string; technology?: string; description?: string;
  home: string; hasLevel: boolean; appearsIn: { title: string; origin: string }[];
}
export type C4Tab = 'diagrams' | 'docs' | 'code';
export interface C4Item {
  path: string; tab: C4Tab; kind: 'page' | 'section' | 'diagram' | 'file' | 'symbol';
  title: string; source: string; href: string;      // source = project path; href = wiki path from root (+ '#anchor')
  markdown?: string; mermaid?: string;               // docs and file items carry markdown; diagram items carry mermaid
  signature?: string; summary?: string;              // symbol items
  exports?: { name: string; href: string }[];        // file items
  origin: string;                                    // wiki output file of the source, used to rebase relative links
}
export interface C4Model { publish: boolean; root: string; levels: C4Level[]; elements: C4ModelElement[]; items: C4Item[] }
```

`Documentation` gains `c4?: C4Model`. `MarkdownContent` and `DocumentedSymbol` gain `c4Marks?: C4Mark[]`.

---

### Task 1: Parse C4 fences

**Files:**
- Create: `src/c4-views.ts`
- Modify: `src/model.ts` (add `C4Mark`, `C4Element`, `C4Boundary`, `C4Relationship`, and `C4View`, as above)
- Test: `test/c4.test.mjs` (new; imports `../dist/c4-views.js`)

**Interfaces:**
- Produces: `parseC4View(body: string): C4View | undefined`. It returns `undefined` when the first non-blank, non-`%%` line is not `C4Context`, `C4Container`, or `C4Component`. It also produces `markerPattern = /^\s*%%\s*@(?:realdocs|livedocs):c4(?:\s+(\S*))?\s*$/` (exported for Task 3).

- [ ] **Step 1: Write the failing tests** in `test/c4.test.mjs`. Start the file with the imports, the `cli` constant, and the `fixture(t, files)` helper from `test/cli.test.mjs:1-31`. Copy them, because the helper is not exported.

```js
import { parseC4View } from '../dist/c4-views.js';

test('parses elements, boundaries, relationships, and layout from a C4 view', () => {
  const view = parseC4View(`%% @realdocs:c4 shop.api
C4Container
title Containers of the shop
Person(customer, "Customer", "Buys things")
System_Boundary(shop, "Shop") {
  Container(api, "Orders, Returns", "Node.js", "Takes orders", $tags="v1")
  ContainerDb(store, "Orders database", "PostgreSQL", "Stores orders")
}
Rel(customer, api, "Places orders", "HTTPS")
Rel(api, store, "Writes")
UpdateRelStyle(api, store, $offsetY="-20")
UpdateLayoutConfig($c4ShapeInRow="3", $c4BoundaryInRow="1")`);
  assert.equal(view.type, 'C4Container');
  assert.equal(view.title, 'Containers of the shop');
  assert.deepEqual(view.elements.map(e => [e.alias, e.kind, e.label, e.technology, e.description, e.boundary]), [
    ['customer', 'Person', 'Customer', undefined, 'Buys things', undefined],
    ['api', 'Container', 'Orders, Returns', 'Node.js', 'Takes orders', 'shop'],
    ['store', 'ContainerDb', 'Orders database', 'PostgreSQL', 'Stores orders', 'shop'],
  ]);
  assert.deepEqual(view.boundaries, [{ alias: 'shop', kind: 'System_Boundary', label: 'Shop', parent: undefined, line: 4 }]);
  assert.deepEqual(view.relationships, [
    { from: 'customer', to: 'api', label: 'Places orders', technology: 'HTTPS' },
    { from: 'api', to: 'store', label: 'Writes', technology: undefined },
  ]);
  assert.equal(view.layout, 'UpdateLayoutConfig($c4ShapeInRow="3", $c4BoundaryInRow="1")');
  assert.deepEqual(view.marks, [{ path: 'shop.api', line: 0, column: 1 }]);
  assert.doesNotMatch(view.source, /@realdocs:c4/);
});

test('records nested boundaries and misplaced markers', () => {
  const view = parseC4View(`C4Component
%% @realdocs:c4 shop.api
Enterprise_Boundary(acme, "Acme") {
  System_Boundary(shop, "Shop") {
    Container_Boundary(api, "API") {
      Component(cart, "Cart", "TS", "Holds items")
    }
  }
}`);
  assert.deepEqual(view.boundaries.map(b => [b.alias, b.parent]), [['acme', undefined], ['shop', 'acme'], ['api', 'shop']]);
  assert.equal(view.elements[0].boundary, 'api');
  assert.deepEqual(view.marks, []);
  assert.deepEqual(view.misplacedMarks, [{ path: 'shop.api', line: 1, column: 1 }]);
});

test('parses an indented fence body and a missing closing fence', () => {
  const view = parseC4View('  C4Context\n  System(a, "A")\n  Rel(a, a, "Loops")');
  assert.equal(view.elements[0].alias, 'a');
  assert.equal(view.relationships.length, 1);
});

test('ignores non-C4 diagrams', () => {
  assert.equal(parseC4View('%% note\nflowchart LR\n  A --> B'), undefined);
  assert.equal(parseC4View('C4Dynamic\nRel(a, b, "x")'), undefined);
});
```

- [ ] **Step 2: Run the tests and confirm they fail**

Run: `npm run build && node --test test/c4.test.mjs`
Expected: FAIL with `Cannot find module '…/dist/c4-views.js'`

- [ ] **Step 3: Implement `parseC4View(body: string): C4View | undefined` in `src/c4-views.ts`**

The approach is the prototype's `parse`/`splitArgs`, done line by line with a boundary stack:
- **Arguments.** Split on commas outside double quotes and strip the quotes. Drop any argument that starts with `$`.
- **Technology and description.** For the `Container*` and `Component*` macros, technology is argument 3 and description is argument 4. For the other macros, description is argument 3. Empty strings become `undefined`.
- **Element macros.** Match `/^(Person|System|SystemDb|SystemQueue|Container|ContainerDb|ContainerQueue|Component|ComponentDb|ComponentQueue)(_Ext)?$/`.
- **Boundaries.** Recognize `System_Boundary`, `Container_Boundary`, `Enterprise_Boundary`, and `Boundary`, each followed by `{`. A line of just `}` pops the stack.
- **Relationships.** `Rel`, `BiRel`, and `Rel_*` produce relationships.
- **Comments.** `%%` lines are comments, except those matching `markerPattern`.
- **Line numbers.** All are 0-based within `body`, and the column is 1-based.

- [ ] **Step 4: Run the tests and confirm they pass**

Run: `npm run build && node --test test/c4.test.mjs`
Expected: 4 tests pass.

- [ ] **Step 5: Commit**

```bash
git add src/c4-views.ts src/model.ts test/c4.test.mjs
git commit -m "Parse Mermaid C4 views"
```

---

### Task 2: Build the C4 model and add `--c4` to the CLI

**Files:**
- Create: `src/c4.ts`
- Modify: `src/model.ts` (add `C4PlacedView`, `C4Level`, `C4ModelElement`, `C4Model`, and `Documentation.c4`), `src/cli.ts:21-46` (help), `src/cli.ts:56-71` (`RunOptions`, `prepareDocumentation`), `src/cli.ts:103-180` (option parsing)
- Test: `test/c4.test.mjs`

**Interfaces:**
- Consumes: `parseC4View` (Task 1).
- Produces:
  - `compileC4(documentation: Documentation, extension: PageExtension, enabled: boolean): Documentation`. In this task it collects views and builds `levels` and `elements` (`items: []`). It sets `documentation.c4` when `enabled` (with `publish: true`) or when any marker exists (`publish: false`). Otherwise it returns the input unchanged.
  - `RunOptions.c4: boolean`.

The tests read the model through `check --c4` diagnostics, and through a debug hook: when the environment variable `REALDOCS_C4_DUMP` is set, `check` writes `JSON.stringify(documentation.c4)` to that path. Task 4 replaces the hook with assertions on the `c4.html` data, so delete it in Task 4.

- [ ] **Step 1: Write the failing tests**

```js
const context = `C4Context
title Context
Person(customer, "Customer", "Buys")
System(shop, "Shop", "Sells")
System_Ext(payments, "Payments", "Charges cards")
Rel(customer, shop, "Buys from")`;
const serving = `C4Container
title Containers of the shop: serving
Person(customer, "Customer", "Buys")
System_Boundary(shop, "Shop") {
  Container(web, "Web app", "React", "Storefront")
  Container(api, "Order API", "Node.js", "Takes orders")
}
Rel(customer, web, "Uses")
Rel(web, api, "Calls", "HTTPS")`;
const billing = `C4Container
title Containers of the shop: billing
System_Boundary(shop, "Shop") {
  Container(api, "Order API", "Node.js", "Charges orders")
  ContainerDb(ledger, "Ledger", "PostgreSQL", "Payments")
}
System_Ext(payments, "Payments", "Card processor")
Rel(api, payments, "Charges", "HTTPS")`;
const apiComponents = `C4Component
title Components of the Order API
Container(web, "Web app", "React", "Calls the API")
Container_Boundary(api, "Order API") {
  Component(checkout, "Checkout", "TS", "Validates orders")
}
Rel(web, checkout, "Submits", "HTTPS")`;
const webComponents = `C4Component
title Components of the Web app
Container(api, "Order API", "Node.js", "Serves the web app")
Container_Boundary(web, "Web app") {
  Component(cart, "Cart", "React", "Holds items")
}
Rel(cart, api, "Submits", "HTTPS")`;
const fence = body => '```mermaid\n' + body + '\n```\n';
const c4Project = t => fixture(t, {
  'docs/architecture.md': `# Architecture\n\n${fence(context)}\n## Containers\n\n${fence(serving)}\n${fence(billing)}`,
  'docs/api.md': `# Order API\n\n${fence(apiComponents)}`,
  'docs/web.md': `# Web app\n\n${fence(webComponents)}`,
});
const dumpModel = (project, ...args) => {
  const out = join(project.cwd, 'model.json');
  const result = spawnSync(process.execPath, [cli, 'check', '--c4', '--format', 'html', ...args], { cwd: project.cwd, encoding: 'utf8', env: { ...process.env, REALDOCS_C4_DUMP: out } });
  return { result, model: JSON.parse(readFileSync(out, 'utf8')) };
};
const pages = ['--page', 'docs/architecture.md', '--page', 'docs/api.md', '--page', 'docs/web.md'];

test('derives levels, paths, and home levels from C4 views', t => {
  const { model } = dumpModel(c4Project(t), ...pages);
  const paths = Object.fromEntries(model.elements.map(e => [e.alias, e.path]));
  assert.deepEqual(paths, { customer: 'customer', shop: 'shop', payments: 'payments', web: 'shop.web', api: 'shop.api', ledger: 'shop.ledger', checkout: 'shop.api.checkout', cart: 'shop.web.cart' });
  assert.deepEqual(model.levels.map(l => [l.key, l.path, l.type, l.views.length]), [
    ['', '', 'C4Context', 1], ['shop', 'shop', 'C4Container', 2], ['api', 'shop.api', 'C4Component', 1], ['web', 'shop.web', 'C4Component', 1],
  ]);
  const api = model.elements.find(e => e.alias === 'api');
  assert.equal(api.description, 'Takes orders'); // the first view of its home level wins over 'Serves the web app'
  assert.equal(api.home, 'shop');
  assert.equal(api.hasLevel, true);
  assert.deepEqual(api.appearsIn.map(v => v.title), ['Containers of the shop: serving', 'Containers of the shop: billing', 'Components of the Order API', 'Components of the Web app']);
  assert.equal(model.elements.find(e => e.alias === 'payments').description, 'Charges cards');
});

test('peer references do not change paths', t => {
  const { model } = dumpModel(c4Project(t), ...pages);
  // web appears outside the api boundary and api outside the web boundary.
  assert.equal(model.elements.find(e => e.alias === 'web').path, 'shop.web');
  assert.equal(model.elements.find(e => e.alias === 'api').path, 'shop.api');
});

test('merges a level built from several views when each has one boundary', t => {
  const { model } = dumpModel(c4Project(t), ...pages);
  const merged = model.levels.find(l => l.key === 'shop').merged;
  assert.match(merged, /^C4Container\ntitle Containers of the shop \(all views merged\)\n/);
  assert.equal(merged.match(/Container\(api,/g).length, 1);
  assert.match(merged, /ContainerDb\(ledger,/);
  assert.match(merged, /Rel\(api, payments, "Charges", "HTTPS"\)/);
  assert.equal(model.levels.find(l => l.key === '').merged, undefined);
});

test('reports alias conflicts only when --c4 or a marker is present', t => {
  const project = fixture(t, { 'docs/a.md': '# A\n\n' + fence(`C4Container
System_Boundary(shop, "Shop") {
  ContainerDb(platform, "Platform DB", "PostgreSQL", "Registry")
  ContainerDb(platformDb, "Platform DB", "PostgreSQL", "Operations")
  Container(api, "Order API", "Node.js", "Orders")
  Container(other, "Other", "Go", "Other work")
}`) + '\n' + fence(`C4Component
Container_Boundary(api, "Orders API") {
  Component(x, "X", "TS", "x")
}
System_Boundary(other, "Other") {
  Container(x, "X again", "TS", "x")
}`) });
  assert.equal(project.result('check', '--strict', '--page', 'docs/a.md').status, 0);
  const result = project.result('check', '--c4', '--page', 'docs/a.md');
  assert.equal(result.status, 1);
  assert.match(result.stderr, /docs\/a\.md:\d+:\d+: warning: C4 elements platform and platformDb in shop share the label "Platform DB"\. Use one alias for one element\./);
  assert.match(result.stderr, /warning: C4 element api is labeled "Orders API" here and "Order API" in docs\/a\.md\./);
  assert.match(result.stderr, /error: C4 element x is declared inside both api and other\./);
});

test('treats grouping boundaries as transparent and warns about elements missing from the context view', t => {
  const project = fixture(t, { 'docs/a.md': '# A\n\n' + fence(`C4Context
Enterprise_Boundary(acme, "Acme") {
  System(shop, "Shop", "Sells")
}`) + '\n' + fence(`C4Container
System_Boundary(shop, "Shop") {
  Container(api, "API", "Node.js", "Orders")
}
System_Ext(bank, "Bank", "Moves money")
Rel(api, bank, "Pays")`) });
  const { result, model } = dumpModel(project, '--page', 'docs/a.md');
  assert.equal(model.elements.find(e => e.alias === 'shop').path, 'shop');
  assert.equal(model.elements.find(e => e.alias === 'bank').home, 'shop');
  assert.match(result.stderr, /warning: C4 element bank is not shown in any C4Context view\./);
});

test('validates --c4 options', t => {
  const project = c4Project(t);
  assert.match(project.result('build', '--c4', ...pages).stderr, /--c4 requires --format html\./);
  assert.match(project.result('diff', '--base', 'HEAD', '--c4', ...pages).stderr, /--c4 is only supported by realdocs build, check, and watch\./);
  assert.match(project.run('check', '--c4', ...pages), /Checked/);
  const empty = fixture(t, { 'docs/a.md': '# A\n' });
  assert.match(empty.result('build', '--c4', '--format', 'html', '--page', 'docs/a.md').stderr,
    /error: --c4 found no C4Context, C4Container, or C4Component diagrams in the wiki inputs\. Add one to a selected guide or @realdocs:file overview\./);
});
```

- [ ] **Step 2: Run the tests and confirm they fail**

Run: `npm run build && node --test test/c4.test.mjs`
Expected: the new tests fail (`Unknown option '--c4'`).

- [ ] **Step 3: Add the `--c4` CLI option in `src/cli.ts`**
- Add `c4: { type: 'boolean' }` to `parseArgs`, and the help line `  --c4              Build the interactive C4 architecture page (c4.html; HTML only).`
- **Errors, in this order after the `--version` check:** `--c4 is only supported by realdocs build, check, and watch.`, then for `build` or `watch` with Markdown output, `--c4 requires --format html.`
- **RunOptions:** add `c4: values.c4 ?? false`.
- **Loading `includePages`:** also load it when `values.c4` is set, so headings and links are resolved.
- **Preparation:** `prepareDocumentation` becomes `compileC4(compileDiagrams(inputs, ext), ext, options.c4)`.
- **Debug hook:** at the start of `document()`, before `validate`, when `options.check && process.env.REALDOCS_C4_DUMP`, write the model to that path. This is temporary; Task 4 removes it.

- [ ] **Step 4: Implement `compileC4` in `src/c4.ts`**
- **Collect views.** For each page (`documentation.pages`) and module overview, parse with `new MarkdownIt({ html: true })`, the same as `diagrams.ts`. For every top-level fence (`token.level === 0`) whose info is `mermaid`, call `parseC4View(token.content)`.
- **Record each view's origin:** the project path, the wiki href (`wikiPath(name, 'pages' | 'modules', extension)`), the source line (`(content.sourceLine ?? 1) + token.map[0] + 1`, the first body line), and the title (the view's `title`, else the nearest preceding heading text, else the page title or module name). Keep them in document order: pages first in input order, then modules.
- **The no-views error.** When `enabled` and no views are found, push `{ level: 'error', message: '--c4 found no C4Context, C4Container, or C4Component diagrams in the wiki inputs. Add one to a selected guide or @realdocs:file overview.' }`.
- **Skip the model** when it is neither enabled nor marked. "Marked" means some `c4Marks` exist (Task 3) or some text matches `/@(?:realdocs|livedocs):c4\b/`.
- **Build the model with this algorithm** (spec, "The C4 model"):

```
declared   = set of every element alias in every view
elementB   = boundary b where declared.has(b.alias)          // element boundary; the others are grouping
enclosing(e in view) = nearest ancestor of e.boundary (walking C4Boundary.parent) that is an element boundary
parent(a)  = enclosing(...) from any declaration of a that has one;
             two declarations whose enclosing values differ → error "C4 element a is declared inside both X and Y."
path(a)    = parent ? path(parent) + '.' + a : a        (guard against cycles with a visited set; a cycle is the same error)
levels     = '' (root: every C4Context view), plus one level per element-boundary alias B, holding every view
             that has B as an element boundary. Order: root, then by the first view that opens the level.
             With no C4Context views, the root is the first level whose alias has no parent.
home(a)    = parent ? parent : (some C4Context view declares a ? '' : key of the first level, in document order, whose views draw a)
label/technology/description = from the first declaration in a view of home(a), else the first declaration
hasLevel(a) = levels has a
appearsIn(a) = every view that declares a (title, origin), in document order
merged     = only when a level has ≥2 views and every view's element boundaries are exactly [key]. Build it as the prototype's
             `levelSource`: first view's type; `title ` + first title up to ':' + ' (all views merged)'; outside element
             lines deduplicated by alias; `<kind>(<key>, "<label>") {`, inside lines deduplicated by alias, `}`;
             relationship lines deduplicated by from→to, first wins; the first view's layout line. Drop UpdateRelStyle.
```

- **Warnings**, each at the source location of the later declaration:
  - Same label for different aliases inside the same element boundary: `C4 elements ${a} and ${b} in ${boundary} share the label "${label}". Use one alias for one element.`
  - Same alias with different labels. Compare element declarations and the labels of element boundaries with that alias: `C4 element ${alias} is labeled "${label}" here and "${otherLabel}" in ${otherOrigin}.`
  - An element with no parent that no C4Context view declares, only when at least one C4Context view exists: `C4 element ${alias} is not shown in any C4Context view.`

- [ ] **Step 5: Run the tests and confirm they pass**

Run: `npm run build && node --test test/c4.test.mjs`
Expected: all tests in the file pass.

- [ ] **Step 6: Run the full suite** to confirm existing output did not change.

Run: `npm test`
Expected: every test passes.

- [ ] **Step 7: Commit**

```bash
git add src/c4.ts src/model.ts src/cli.ts test/c4.test.mjs
git commit -m "Build the C4 model and add --c4"
```

---

### Task 3: Collect, validate, and strip `@realdocs:c4` markers

**Files:**
- Modify: `src/pages.ts:54-71` (`readPageAnnotations`), `src/typescript.ts:254-283` (`fileOverview`), `src/typescript.ts:395-420` (symbols), `src/c4.ts`
- Test: `test/c4.test.mjs`

**Interfaces:**
- Consumes: `markerPattern` (Task 1) and `compileC4` (Task 2).
- Produces: `C4Model.items` (`C4Item[]`), and `c4Marks` on `MarkdownContent` and `DocumentedSymbol`. Pages and overviews come back from `compileC4` with section markers and `%%` marker lines replaced by empty lines. Replacing with empty lines keeps heading line numbers valid.

- [ ] **Step 1: Write the failing tests**

```js
const marked = t => fixture(t, {
  'docs/architecture.md': `<!-- @realdocs:tag architecture -->
<!-- @realdocs:c4 shop -->
# Architecture

${fence(context)}
## Containers

${fence(serving)}
## Order API notes
<!-- @realdocs:c4 shop.api -->

The API owns [checkout](../src/api.ts#checkout).

### Retries

Retry details.

## Unrelated

${'```mermaid'}
%% @realdocs:c4 shop.api
sequenceDiagram
  Web->>API: POST /orders
${'```'}
`,
  'docs/adr.md': '<!-- @realdocs:c4 shop.api -->\n# ADR 1: Use Node\n\nWe use Node.js.\n\n## Context\n\nLong text.\n',
  'docs/api.md': `# Order API\n\n${fence(apiComponents)}`,
  'src/api.ts': `/**
 * @realdocs:file Order API entry point.
 *
 * Second paragraph.
 * @realdocs:c4 shop.api
 */
/**
 * Validates an order.
 *
 * More detail.
 * @realdocs:c4 shop.api.checkout
 */
export function checkout(order: string): boolean { return !!order; }
`,
});
const markedArgs = ['--entry', 'src/api.ts', '--page', 'docs/architecture.md', '--page', 'docs/adr.md', '--page', 'docs/api.md'];

test('turns each marker form into a panel item', t => {
  const { model } = dumpModel(marked(t), ...markedArgs);
  const items = model.items.map(i => [i.path, i.tab, i.kind, i.title]);
  assert.deepEqual(items, [
    ['shop', 'docs', 'page', 'Architecture'],
    ['shop.api', 'docs', 'section', 'Order API notes'],
    ['shop.api', 'diagrams', 'diagram', 'Unrelated'],
    ['shop.api', 'docs', 'page', 'ADR 1: Use Node'],
    ['shop.api', 'code', 'file', 'src/api.ts'],
    ['shop.api.checkout', 'code', 'symbol', 'checkout'],
  ]);
  const section = model.items[1];
  assert.match(section.markdown, /^## Order API notes\n[\s\S]*### Retries\n\nRetry details\.\n*$/);
  assert.equal(section.href, 'pages/docs/architecture.html#order-api-notes');
  assert.equal(model.items[3].markdown.trim(), 'We use Node.js.');
  assert.match(model.items[2].mermaid, /^sequenceDiagram\n/);
  assert.equal(model.items[4].markdown.trim(), 'Order API entry point.');
  assert.deepEqual(model.items[4].exports, [{ name: 'checkout', href: 'modules/src/api.ts.html#symbol-checkout' }]);
  assert.equal(model.items[5].signature, 'export function checkout(order: string): boolean');
  assert.equal(model.items[5].summary, 'Validates an order.');
});

test('markers never appear in either wiki format', t => {
  const project = marked(t);
  for (const format of ['markdown', 'html']) {
    project.run('build', ...markedArgs, '--format', format, '--out', `wiki-${format}`);
    const ext = format === 'html' ? 'html' : 'md';
    for (const page of ['pages/docs/architecture', 'pages/docs/adr', 'modules/src/api.ts']) {
      assert.doesNotMatch(project.read(`wiki-${format}/${page}.${ext}`), /realdocs:c4/);
    }
  }
  assert.match(project.read('wiki-html/tags.html'), /Architecture/); // the tag after the marker still applies
});

test('reports unknown, invalid, and misplaced markers', t => {
  const project = c4Project(t);
  project.write('docs/notes.md', `<!-- @realdocs:c4 shop.checkout -->
# Notes

Text.
<!-- @realdocs:c4 shop.web -->

## Bad
<!-- @realdocs:c4 not a path -->

${'```mermaid'}
flowchart LR
%% @realdocs:c4 shop.web
  A --> B
${'```'}
`);
  project.write('docs/api.md', `# Order API\n\n${fence(apiComponents)}`);
  const result = project.result('check', ...pages, '--page', 'docs/notes.md');
  assert.equal(result.status, 1);
  assert.match(result.stderr, /docs\/notes\.md:1:\d+: error: Unknown C4 element path shop\.checkout\. Did you mean shop\.api\.checkout\?/);
  assert.match(result.stderr, /docs\/notes\.md:5:\d+: error: Place <!-- @realdocs:c4 … --> at the top of the page or on the first line after a heading\./);
  assert.match(result.stderr, /docs\/notes\.md:8:\d+: error: Invalid @realdocs:c4 path "not a path"\. Use aliases separated by dots, such as shop\.api\./);
  assert.match(result.stderr, /docs\/notes\.md:12:\d+: error: Place %% @realdocs:c4 … before the diagram type line\./);
});
```

`--c4` is deliberately absent from the last test. A marker alone turns the model on.

- [ ] **Step 2: Run the tests and confirm they fail**

Run: `npm run build && node --test test/c4.test.mjs`
Expected: the three new tests fail.

- [ ] **Step 3: Capture page and code markers**
- **Markdown pages.** In `readPageAnnotations`, widen the annotation regex to `(tag|zone|c4)`. Push `{ path: value, line: index + 1, column: 1 }` onto `c4Marks`. The value is validated in `compileC4`.
- **File overviews.** In `fileOverview`, set `c4Marks` from the annotations named `c4`, using `sourceLocation` of the tag node.
- **Exported symbols.** In `describeExports`, set `c4Marks` from the annotations named `c4`, using `locate(node)`.
- Leave every field `undefined` when it is empty, so existing outputs stay identical.

- [ ] **Step 4: Collect items and strip markers in `compileC4`**
- **Order.** Collect page items first, in page input order, walking each page top to bottom. Then collect module items in module order: the file mark, then each symbol's marks.
- **Page marks (whole Markdown page).**
  - Content: the Markdown after a leading level-1 heading, up to the next heading.
  - Title: `page.title`. Href: `wikiPath(page.name, 'pages', ext)`.
- **Section marks.** These are `html_block` tokens matching `/^<!--\s*@(?:realdocs|livedocs):c4(?:\s+(.*?))?\s*-->\s*$/`, with the previous token a `heading_close` at level 0 and only blank lines between.
  - Content: from the heading line to the line before the next heading of the same or higher level. Section items hold the heading itself, as the test shows.
  - Title: the heading text. Href: the page href + `#` + the heading id from `content.headings` (omit the fragment when there are no headings).
  - Any other `html_block` or `html_inline` with that marker text is misplaced: `Place <!-- @realdocs:c4 … --> at the top of the page or on the first line after a heading.`
- **Diagram marks.** These are the `marks` on any top-level mermaid fence. `parseC4View` covers C4 fences. For other fences, scan the body lines before the first non-blank, non-`%%` line for `markerPattern`, and treat later matches as misplaced: `Place %% @realdocs:c4 … before the diagram type line.`
  - Title: the view title or `title` line, else the nearest preceding heading, else the page title. `mermaid` holds the fence body without marker lines.
- **File marks.**
  - Title: `module.name`. Markdown: the overview's first paragraph.
  - `exports`: every documented symbol of the module as `{ name, href: wikiPath(module.name, 'modules', ext) + '#' + symbolAnchor(symbol) }`.
- **Symbol marks.** Title: `symbol.name`. `signature`: `symbol.signatures[0]`. `summary`: the text of `symbol.description` up to the first blank line. Href: the module path + `#` + `symbolAnchor(symbol)`.
- **`origin`** is the source's wiki output path.
- **Path checks**, in order:
  - The path must match the docId rule, else `Invalid @realdocs:c4 path ${JSON.stringify(path)}. Use aliases separated by dots, such as shop.api.`
  - The path must equal some element's path, else `Unknown C4 element path ${path}.`, with ` Did you mean ${p}?` appended when the last segment is a known alias whose path is `p`.
  - Items whose path fails a check are dropped.
- **Stripping.** Replace every accepted or misplaced section marker line and every `%%` marker line with `''`. Do this in pages and overviews, in the returned `Documentation`.

- [ ] **Step 5: Run the tests and confirm they pass**

Run: `npm run build && node --test test/c4.test.mjs`
Expected: all tests in the file pass.

- [ ] **Step 6: Run the full suite**

Run: `npm test`
Expected: every test passes.

- [ ] **Step 7: Commit**

```bash
git add src/pages.ts src/typescript.ts src/c4.ts test/c4.test.mjs
git commit -m "Collect, validate, and strip @realdocs:c4 markers"
```

---

### Task 4: Write `c4.html` into the HTML wiki

**Files:**
- Create: `src/c4-page.ts`, a stub `assets/c4.js` (an IIFE that reads `#c4-data`, for now), `assets/c4.css`
- Modify: `src/html.ts` (export `renderMarkdownHtml(markdown: string): string` using the module's existing markdown-it instance and anchor rule, and call `renderC4Page`), `src/markdown.ts:187-193` (homepage link), `src/cli.ts` (remove the `REALDOCS_C4_DUMP` hook), `package.json` (`files`)
- Test: `test/c4.test.mjs`

**Interfaces:**
- Consumes: `Documentation.c4` (Tasks 2–3).
- Produces: `renderC4Page(documentation: Documentation, renderMarkdown: (markdown: string) => string): Map<string, string>`. It returns `c4.html`, `assets/c4.js`, and `assets/c4.css`. The embedded data is `C4Model` with each item's `markdown` replaced by `html`, plus `title` (`documentation.navigation?.title ?? 'Project documentation'`), inside `<script type="application/json" id="c4-data">`.

- [ ] **Step 1: Write the failing tests.** Switch the earlier `dumpModel` tests to read the model from `c4.html`. Add `readModel(project, ...args)`, which runs `build --c4 --format html --out wiki` with `spawnSync` and returns `{ result, model }` like `dumpModel`, with the model parsed from `#c4-data`. Delete `dumpModel`. The alias-conflict test keeps calling `check` directly. Then add:

```js
test('writes c4.html with the model, assets, and a homepage link only with --c4', t => {
  const project = marked(t);
  project.run('build', ...markedArgs, '--format', 'html', '--out', 'plain');
  assert.equal(existsSync(join(project.cwd, 'plain/c4.html')), false);
  assert.doesNotMatch(project.read('plain/index.html'), /c4\.html/);

  const model = readModel(project, ...markedArgs);
  assert.match(project.read('wiki/index.html'), /<a href="c4\.html">Architecture<\/a>/);
  const page = project.read('wiki/c4.html');
  assert.match(page, /src="assets\/mermaid\.min\.js"/);
  assert.match(page, /src="assets\/c4\.js"/);
  assert.ok(existsSync(join(project.cwd, 'wiki/assets/c4.css')));
  const section = model.items.find(i => i.kind === 'section');
  assert.match(section.html, /<a href="modules\/src\/api\.ts\.html#symbol-checkout">checkout<\/a>/); // rebased from pages/docs/
  assert.equal(section.markdown, undefined);
});

test('escapes embedded data', t => {
  const project = marked(t);
  project.write('docs/adr.md', '<!-- @realdocs:c4 shop.api -->\n# ADR\n\nUse `</script><script>alert(1)</script>`.\n');
  project.run('build', ...markedArgs, '--c4', '--format', 'html', '--out', 'wiki');
  const page = project.read('wiki/c4.html');
  assert.equal(page.match(/<\/script>/g).length, page.match(/<script/g).length);
});

test('lists c4.html in a versioned build', t => {
  const project = fixture(t, { '.gitignore': 'dist/\n', 'docs/a.md': '# A\n\n' + fence(context) });
  const git = (...args) => execFileSync('git', args, { cwd: project.cwd, encoding: 'utf8', stdio: 'pipe' });
  git('init', '-q');
  git('add', '.');
  git('-c', 'user.name=RealDocs Test', '-c', 'user.email=realdocs@example.invalid', '-c', 'commit.gpgsign=false', 'commit', '-qm', 'Source');
  project.run('build', '--version', '1.0.0', '--c4', '--format', 'html', '--page', 'docs/a.md');
  const release = JSON.parse(project.read('dist/realdocs-releases/1.0.0/release.json'));
  assert.match(release.files['c4.html'], /^[a-f0-9]{64}$/);
  assert.match(release.files['assets/c4.js'], /^[a-f0-9]{64}$/);
});
```

- [ ] **Step 2: Run the tests and confirm they fail**

Run: `npm run build && node --test test/c4.test.mjs`
Expected: they fail because `wiki/c4.html` is missing.

- [ ] **Step 3: Implement `renderC4Page` in `src/c4-page.ts`, and connect it in `src/html.ts`**
- **The page shell.** Follow `htmlPage` in `html.ts` and the prototype's markup: the `<header>` with the title, the breadcrumb `nav`, the level chip, and the variants; the `.stage > .canvas`; `aside.panel`; the footer hint; and `dialog#enlarge`. Load the `style` constant from `html.ts` (export it), `assets/c4.css`, `assets/mermaid.min.js`, `assets/render-mermaid.js`'s Mermaid configuration (factor the `mermaid.initialize` options into an exported constant so `c4.js` can share it), and `assets/c4.js`.
- **Item HTML.** Render each item's Markdown with `renderMarkdown`. Then rewrite every relative `href`/`src`: one without a scheme, not starting with `/`, becomes `posix.normalize(posix.join(posix.dirname(item.origin), url))`, and one starting with `#` becomes `item.origin + url`.
- **Escaping the JSON.** Use `JSON.stringify(data).replaceAll('<', '\\u003c')`, as `graph.ts` does.
- **Wiring in `renderHtmlWiki`.** When `documentation.c4?.publish`, add the files and set `needsMermaid = true`.
- **Homepage link.** In `renderWiki`, push `[Architecture](c4.html)` into the homepage link row when `extension === 'html' && documentation.c4?.publish`.
- **Packaging.** Add `"assets/c4.js"` and `"assets/c4.css"` to `package.json` `files`.

- [ ] **Step 4: Run the tests and confirm they pass**

Run: `npm run build && node --test test/c4.test.mjs`
Expected: all tests pass.

- [ ] **Step 5: Run the full suite**

Run: `npm test`
Expected: every test passes.

- [ ] **Step 6: Commit**

```bash
git add src/c4-page.ts src/html.ts src/markdown.ts src/cli.ts assets/c4.js assets/c4.css package.json test/c4.test.mjs
git commit -m "Write the C4 page into the HTML wiki"
```

---

### Task 5: Port the drill-down client

**Files:**
- Modify: `assets/c4.js`, `assets/c4.css` (port from `docs/superpowers/specs/2026-11-26-interactive-c4-prototype.html`)
- Create: `test/c4-browser.mjs`, a manual check script and not part of `npm test`. It is a Chrome DevTools Protocol driver like the brainstorming checks: launch a Chromium binary given as `argv[2]`, open `c4.html` as `argv[3]`, and evaluate assertions.

**Interfaces:**
- Consumes: the `#c4-data` JSON (Task 4).
- Produces: browser globals for the check script: `window.__c4 = { ready: Promise<void>, state, zoomIn(alias), zoomOut(depth?), select(alias) }`.

- [ ] **Step 1: Port the prototype script.**
- **Replace the sample data.** Remove the hard-coded `sources`, `markers`, and the in-browser `parse`. Read the JSON instead. Each level uses `views[i].source`, or `merged` for "All merged".
- **Keep the prototype's behavior:**
  - The default variant is the first view.
  - Navigation uses `stackFor(alias)`, built from the dotted path.
  - Badges are **+** for descendants and **↗** for peers.
  - Peers get a sideways slide. Any level change closes the panel.
  - The deep-link hash records the level, selection, and tab: `level`, `select`, `tab`.
  - Wheel thresholds, keyboard handling (Enter/Space, `+`, Escape, Backspace), the Enlarge dialog, and the Copy button.
- **New behavior:**
  - The Diagrams tab renders `item.mermaid`.
  - Docs and Code items render `item.html`, a signature block, or an export list.
  - Mermaid fences inside `item.html` (`pre > code.language-mermaid`) render when the tab opens.
  - Overview Calls and Called by come from the element's `home` level. The prototype already does this.
  - "Appears in" shows `element.appearsIn`.

- [ ] **Step 2: Write `test/c4-browser.mjs`** with these assertions against the fulfillment example (Task 6 builds it into `examples/fulfillment/dist/wiki-html`):

```js
// start at #level=fulfillment,runtime and zoom back and forth between peers; the breadcrumb never grows
// select an element → panel open; zoomIn → panel closed
// #level=fulfillment&select=runtime&tab=docs restores that state
// every .c4-shape has role=button, tabindex=0 and an aria-label
// no element in document.body matches /Syntax error/ after visiting every level
```

- [ ] **Step 3: Run the browser check**

Run: `node test/c4-browser.mjs "$(ls -d ~/.cache/ms-playwright/chromium_headless_shell-*/chrome-headless-shell-linux64/chrome-headless-shell | tail -1)" "file://$PWD/examples/fulfillment/dist/wiki-html/c4.html"`
Expected: every line prints `ok`. Open the page in a desktop browser, and check that the zoom-in and zoom-out animations play and that the panel overlays the canvas at 375 px wide.

- [ ] **Step 4: Commit**

```bash
git add assets/c4.js assets/c4.css test/c4-browser.mjs
git commit -m "Port the drill-down C4 client"
```

---

### Task 6: Documentation, skills, and the fulfillment example

**Files:**
- Modify: `README.md`, `.agents/skills/realdocs-c4/SKILL.md`, `.agents/skills/realdocs-bootstrap/SKILL.md`, `.agents/realdocs-instructions.md`, `examples/fulfillment/README.md`, `examples/fulfillment/docs/architecture.md`, `examples/fulfillment/docs/integrations.md`, `examples/fulfillment/src/fulfillment.ts`
- Test: `test/c4.test.mjs`

**Interfaces:**
- Consumes: everything above.

- [ ] **Step 1: Write the failing test**

```js
test('the fulfillment example builds a strict C4 page with marked content', t => {
  const out = mkdtempSync(join(tmpdir(), 'realdocs-c4-example-'));
  t.after(() => rmSync(out, { recursive: true, force: true }));
  const example = fileURLToPath(new URL('../examples/fulfillment/', import.meta.url));
  execFileSync(process.execPath, [cli, 'build', '--strict', '--c4', '--format', 'html', '--out', out], { cwd: example, encoding: 'utf8' });
  const model = JSON.parse(readFileSync(join(out, 'c4.html'), 'utf8').match(/id="c4-data">(.*?)<\/script>/s)[1]);
  assert.deepEqual(model.levels.map(l => l.key), ['', 'fulfillment', 'runtime']);
  assert.ok(model.items.some(i => i.path === 'fulfillment' && i.kind === 'section'));
  assert.ok(model.items.some(i => i.path === 'fulfillment.runtime' && i.kind === 'diagram'));
  assert.ok(model.items.some(i => i.path === 'fulfillment.runtime.coordinator' && i.kind === 'symbol'));
});
```

- [ ] **Step 2: Run the test and confirm it fails**

Run: `npm run build && node --test test/c4.test.mjs`
Expected: it fails because the example has no markers yet.

- [ ] **Step 3: Add markers to the fulfillment example**
- `examples/fulfillment/docs/architecture.md`: put `<!-- @realdocs:c4 fulfillment -->` under `## Preparing a shipment`.
- `examples/fulfillment/docs/integrations.md`: add `%% @realdocs:c4 fulfillment.runtime` to the sequence diagram.
- `examples/fulfillment/src/fulfillment.ts`: add `@realdocs:c4 fulfillment.runtime.coordinator` to the JSDoc of `prepareShipment`.
- `examples/fulfillment/README.md`, "Generate HTML": add the `--c4` build and point readers to `c4.html`.

- [ ] **Step 4: Run the tests and confirm they pass**

Run: `npm run build && node --test test/c4.test.mjs`
Expected: all tests pass. Then run Task 5 Step 3 against this build.

- [ ] **Step 5: Update the docs and skills**
- **README.** Add an "Interactive C4 page" section after "Homepage and Mermaid C4 diagrams". It covers `--c4`, the HTML requirement, `check --c4` in CI, descriptive and globally consistent aliases, levels via `System_Boundary(alias)` and `Container_Boundary(alias)`, dotted paths, the five marker forms as a table, and the panel tabs. Add `--c4` to the commands section, and link to the example.
- **`realdocs-c4` skill.**
  - Require descriptive camelCase aliases that stay the same across views.
  - Explain that a component view's `Container_Boundary(alias)` becomes that container's zoom level.
  - Explain the marker forms and when to use each.
  - Add `check --strict --c4` and the `--c4` HTML build to the verification steps.
- **`realdocs-bootstrap` skill and `.agents/realdocs-instructions.md`.** Mention updating `@realdocs:c4` markers when an element is renamed or moved.

- [ ] **Step 6: Run the full suite**

Run: `npm test`
Expected: every test passes. The `install-skill` test compares installed skills with the bundled files, so it still passes.

- [ ] **Step 7: Commit**

```bash
git add README.md .agents examples/fulfillment test/c4.test.mjs
git commit -m "Document the C4 page and mark up the fulfillment example"
```

---

## Not covered by automated tests (verify by hand in Task 5)

- `watch --c4` regenerates `c4.html` on save. The option passes through `RunOptions` unchanged. Run `watch --c4 --format html --page docs/architecture.md`, edit the guide, and reload the page.
- Check against a scratch copy of dataris-spec with renamed aliases and one component view. Don't commit to dataris-spec.
