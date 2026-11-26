import assert from 'node:assert/strict';
import { execFileSync, spawn, spawnSync } from 'node:child_process';
import { once } from 'node:events';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, posix } from 'node:path';
import { test } from 'node:test';
import { setTimeout as delay } from 'node:timers/promises';
import { fileURLToPath } from 'node:url';

const cli = fileURLToPath(new URL('../dist/cli.js', import.meta.url));

function fixture(t, files) {
  const cwd = mkdtempSync(join(tmpdir(), 'realdocs-test-'));
  t.after(() => rmSync(cwd, { recursive: true, force: true }));
  const write = (file, contents) => {
    mkdirSync(dirname(join(cwd, file)), { recursive: true });
    writeFileSync(join(cwd, file), contents);
  };
  write('package.json', '{"type":"module"}');
  for (const [file, contents] of Object.entries(files)) write(file, contents);

  return {
    cwd,
    write,
    read: file => readFileSync(join(cwd, file), 'utf8'),
    run: (...args) => execFileSync(process.execPath, [cli, ...args], { cwd, encoding: 'utf8', stdio: 'pipe' }),
    result: (...args) => spawnSync(process.execPath, [cli, ...args], { cwd, encoding: 'utf8' }),
    withPreload: (...args) => spawnSync(process.execPath, ['--require', './preload.cjs', cli, ...args], { cwd, encoding: 'utf8' }),
  };
}

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
const encode = value => encodeURIComponent(value).replaceAll('(', '%28').replaceAll(')', '%29');
const readModel = (project, ...args) => {
  rmSync(join(project.cwd, 'wiki'), { recursive: true, force: true });
  const result = spawnSync(process.execPath, [cli, 'build', '--c4', '--format', 'html', '--out', 'wiki', ...args], { cwd: project.cwd, encoding: 'utf8' });
  assert.equal(result.status, 0, result.stderr);
  const data = /<script type="application\/json" id="c4-data">([\s\S]*?)<\/script>/.exec(project.read('wiki/c4.html'));
  return { result, model: JSON.parse(data[1]) };
};
const pages = ['--page', 'docs/architecture.md', '--page', 'docs/api.md', '--page', 'docs/web.md'];

test('derives levels, paths, and home levels from C4 views', t => {
  const { model } = readModel(c4Project(t), ...pages);
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
  const { model } = readModel(c4Project(t), ...pages);
  // web appears outside the api boundary and api outside the web boundary.
  assert.equal(model.elements.find(e => e.alias === 'web').path, 'shop.web');
  assert.equal(model.elements.find(e => e.alias === 'api').path, 'shop.api');
});

test('merges a level built from several views when each has one boundary', t => {
  const { model } = readModel(c4Project(t), ...pages);
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
  const { result, model } = readModel(project, '--page', 'docs/a.md');
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

test('treats a grouping boundary reused inside two systems as transparent', t => {
  const project = fixture(t, { 'docs/a.md': '# A\n\n' + fence(`C4Context
System(shop, "Shop", "Sells")
System(bank, "Bank", "Banks")`) + '\n' + fence(`C4Container
System_Boundary(shop, "Shop") {
  Boundary(data, "Data tier") {
    ContainerDb(orders, "Orders", "PostgreSQL", "Orders")
  }
}`) + '\n' + fence(`C4Container
System_Boundary(bank, "Bank") {
  Boundary(data, "Data tier") {
    ContainerDb(ledger, "Ledger", "PostgreSQL", "Ledger")
  }
}`) });
  const { result, model } = readModel(project, '--page', 'docs/a.md');
  assert.doesNotMatch(result.stderr, /declared inside both/);
  assert.equal(result.status, 0);
  assert.equal(model.elements.find(e => e.alias === 'orders').path, 'shop.orders');
});

test('keeps elements of a grouping boundary outside the merged element boundary', t => {
  const project = fixture(t, { 'docs/a.md': '# A\n\n' + fence(`C4Context
System(shop, "Shop", "Sells")`) + '\n' + fence(`C4Container
Enterprise_Boundary(ext, "External") {
  System_Ext(bank, "Bank", "Banks")
}
System_Boundary(shop, "Shop") {
  Container(api, "API", "Node.js", "Orders")
}`) + '\n' + fence(`C4Container
System_Boundary(shop, "Shop") {
  Container(web, "Web", "React", "UI")
}`) });
  const { model } = readModel(project, '--page', 'docs/a.md');
  const merged = model.levels.find(l => l.key === 'shop').merged;
  assert.match(merged, /\nSystem_Ext\(bank,[^\n]*\nSystem_Boundary\(shop, "Shop"\) \{\n  Container\(api,/);
  assert.doesNotMatch(merged, /  System_Ext\(bank/);
});

test('warns about shared labels across views of one element boundary', t => {
  const project = fixture(t, { 'docs/a.md': '# A\n\n' + fence(`C4Context
System(shop, "Shop", "Sells")`) + '\n' + fence(`C4Container
System_Boundary(shop, "Shop") {
  ContainerDb(platform, "Platform DB", "PostgreSQL", "Registry")
}`) + '\n' + fence(`C4Container
System_Boundary(shop, "Shop") {
  ContainerDb(platformDb, "Platform DB", "PostgreSQL", "Operations")
}`) });
  const result = project.result('check', '--c4', '--page', 'docs/a.md');
  assert.match(result.stderr, /warning: C4 elements platform and platformDb in shop share the label "Platform DB"\./);
});

test('reports an element nested inside itself', t => {
  const project = fixture(t, { 'docs/a.md': '# A\n\n' + fence(`C4Container
System_Boundary(x, "X") {
  System(x, "X", "Self")
}`) });
  // A build stops on errors and writes no c4.html, so assert through check's diagnostics.
  const result = project.result('check', '--c4', '--page', 'docs/a.md');
  assert.equal(result.status, 1);
  assert.match(result.stderr, /docs\/a\.md:\d+:\d+: error: C4 element x is nested inside itself\./);
  assert.doesNotMatch(result.stderr, /TypeError|at .*\.js:\d+/);
});

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
  const { model } = readModel(marked(t), ...markedArgs);
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
  assert.match(section.html, /^<h2>Order API notes<\/h2>\n[\s\S]*<h3>Retries<\/h3>\n<p>Retry details\.<\/p>\n*$/);
  assert.equal(section.href, 'pages/docs/architecture.html#order-api-notes');
  assert.equal(model.items[3].html.trim(), '<p>We use Node.js.</p>');
  assert.match(model.items[2].mermaid, /^sequenceDiagram\n/);
  assert.equal(model.items[4].html.trim(), '<p>Order API entry point.</p>');
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
  assert.match(result.stderr, /docs\/notes\.md:5:1: error: Place <!-- @realdocs:c4 … --> at the top of the page or on the first line after a heading\./);
  assert.match(result.stderr, /docs\/notes\.md:8:\d+: error: Invalid @realdocs:c4 path "not a path"\. Use aliases separated by dots, such as shop\.api\./);
  assert.match(result.stderr, /docs\/notes\.md:12:1: error: Place %% @realdocs:c4 … before the diagram type line\./);
});

const shopPage = `# Architecture\n\n${fence(context)}\n${fence(serving)}`;
const shopProject = (t, files = {}) => fixture(t, { 'docs/arch.md': shopPage, ...files });
const shopArgs = ['--page', 'docs/arch.md'];

test('section and diagram markers work inside a @realdocs:file overview', t => {
  const project = shopProject(t, {
    'src/b.ts': `/**
 * @realdocs:file Overview first.
 *
 * ## Part
 * <!-- @realdocs:c4 shop -->
 *
 * Part text.
 *
 * ${'```mermaid'}
 * %% @realdocs:c4 shop.api
 * flowchart LR
 *   A --> B
 * ${'```'}
 * @livedocs:c4 shop
 */
export function b(): void {}
`,
  });
  const { result, model } = readModel(project, '--entry', 'src/b.ts', ...shopArgs);
  assert.equal(result.status, 0, result.stderr);
  assert.deepEqual(model.items.map(i => [i.kind, i.path, i.title]), [
    ['file', 'shop', 'src/b.ts'], ['section', 'shop', 'Part'], ['diagram', 'shop.api', 'Part'],
  ]);
  assert.equal(model.items[0].html.trim(), '<p>Overview first.</p>');
  assert.match(model.items[1].html, /Part text\./);
  assert.match(model.items[2].mermaid, /^flowchart LR\n {2}A --> B$/);
  project.run('build', '--entry', 'src/b.ts', ...shopArgs, '--format', 'html', '--out', 'wiki');
  const html = project.read('wiki/modules/src/b.ts.html');
  assert.match(html, /Part text\./);
  assert.doesNotMatch(html, /realdocs:c4|livedocs:c4/);
});

test('a multi-line marker comment is reported and never leaks into the page', t => {
  const project = shopProject(t, { 'docs/notes.md': '# Notes\n<!--\n@realdocs:c4 shop\n-->\n\nText.\n' });
  // The error stops the build before c4.html is written, so the check run is the observable output.
  const result = project.result('check', '--c4', ...shopArgs, '--page', 'docs/notes.md');
  assert.equal(result.status, 1);
  assert.match(result.stderr, /docs\/notes\.md:2:1: error: Place <!-- @realdocs:c4 … --> at the top/);
  assert.deepEqual(result.stderr.split('\n').filter(line => /\berror:/.test(line)),
    [result.stderr.split('\n').find(line => /\berror:/.test(line))]);
  assert.equal(result.stderr.match(/error:/g).length, 1);
});

test('a marked symbol re-exported from several modules makes one item', t => {
  const project = shopProject(t, {
    'src/a.ts': '/**\n * Does a.\n * @realdocs:c4 shop\n */\nexport function a(): void {}\n',
    'src/index.ts': "export { a } from './a.js';\n",
  });
  const { result, model } = readModel(project, '--entry', 'src/index.ts', '--entry', 'src/a.ts', ...shopArgs);
  assert.equal(result.status, 0, result.stderr);
  assert.deepEqual(model.items.map(i => [i.kind, i.path, i.title]), [['symbol', 'shop', 'a']]);
});

test('C4 diagnostics point at the original line after diagram directives expand', t => {
  const project = fixture(t, {
    'src/a.ts': '/**\n * Does a.\n * @realdocs:docId x\n */\nexport function a(): void {}\n',
    'docs/other.md': `# Other\n\n${fence(context.replace('"Shop"', '"Store"'))}`,
    'docs/deps.md': `# Deps

{{ diagram.dependencies("x") }}

${fence(context)}
## After
<!-- @realdocs:c4 nope.shop -->
`,
  });
  const result = project.result('check', '--c4', '--entry', 'src/a.ts', '--page', 'docs/other.md', '--page', 'docs/deps.md');
  assert.equal(result.status, 1);
  assert.match(result.stderr, /docs\/deps\.md:15:1: error: Unknown C4 element path nope\.shop\./);
  assert.match(result.stderr, /docs\/deps\.md:9:1: warning: C4 element shop is labeled "Shop" here and "Store" in docs\/other\.md\./);
});

test('a marker in a nested mermaid fence is reported and stripped', t => {
  const project = shopProject(t, { 'docs/notes.md': '# Notes\n\n> ```mermaid\n> %% @realdocs:c4 shop\n> flowchart LR\n> ```\n' });
  const result = project.result('check', ...shopArgs, '--page', 'docs/notes.md');
  assert.equal(result.status, 1);
  assert.match(result.stderr, /docs\/notes\.md:4:3: error: Place %% @realdocs:c4 … before the diagram type line\./);
});

test('a section marker can be repeated to attach one section to several elements', t => {
  const project = shopProject(t, { 'docs/notes.md': '# Notes\n\n## Shared\n<!-- @realdocs:c4 shop -->\n\n<!-- @realdocs:c4 shop.api -->\n\nShared text.\n' });
  const { result, model } = readModel(project, ...shopArgs, '--page', 'docs/notes.md');
  assert.equal(result.status, 0, result.stderr);
  assert.deepEqual(model.items.map(i => [i.kind, i.path, i.title]), [['section', 'shop', 'Shared'], ['section', 'shop.api', 'Shared']]);
  assert.match(model.items[1].html, /^<h2>Shared<\/h2>\n[\s\S]*Shared text\.<\/p>\n$/);
  project.run('build', ...shopArgs, '--page', 'docs/notes.md', '--format', 'html', '--out', 'wiki');
  assert.doesNotMatch(project.read('wiki/pages/docs/notes.html'), /realdocs:c4/);
});

test('prose that mentions the marker is not a marker, and misplaced columns are exact', t => {
  const project = shopProject(t, { 'docs/notes.md': '# Notes\n\n<p>Use @realdocs:c4 to attach content.</p>\n\nText.\n  <!-- @realdocs:c4 shop -->\n' });
  const result = project.result('check', ...shopArgs, '--page', 'docs/notes.md');
  assert.equal(result.status, 1);
  assert.doesNotMatch(result.stderr, /docs\/notes\.md:3:/);
  assert.match(result.stderr, /docs\/notes\.md:6:3: error: Place <!-- @realdocs:c4 … -->/);
});

test('a %% marker with extra words is an invalid path', t => {
  const project = shopProject(t, {
    'docs/notes.md': `# Notes\n\n${'```mermaid'}\n%% @realdocs:c4 shop api\nflowchart LR\n  A --> B\n${'```'}\n`,
  });
  const result = project.result('check', ...shopArgs, '--page', 'docs/notes.md');
  assert.equal(result.status, 1);
  assert.match(result.stderr, /docs\/notes\.md:4:1: error: Invalid @realdocs:c4 path "shop api"\. Use aliases separated by dots, such as shop\.api\./);
});

test('single-line symbol and overview marks still make items and never reach the wiki', t => {
  const project = shopProject(t, {
    'src/a.ts': '/** Does a. @realdocs:c4 shop */\nexport function a(): void {}\n',
    'src/c.ts': '/** @realdocs:file Overview c. @realdocs:c4 shop.api */\nexport function c(): void {}\n',
  });
  const args = ['--entry', 'src/a.ts', '--entry', 'src/c.ts', ...shopArgs];
  const { result, model } = readModel(project, ...args);
  assert.equal(result.status, 0, result.stderr);
  assert.deepEqual(model.items.map(i => [i.kind, i.path, i.title]), [['symbol', 'shop', 'a'], ['file', 'shop.api', 'src/c.ts']]);
  assert.equal(model.items[1].html.trim(), '<p>Overview c.</p>');
  for (const format of ['markdown', 'html']) {
    project.run('build', ...args, '--format', format, '--out', `wiki-${format}`);
    const ext = format === 'html' ? 'html' : 'md';
    for (const page of ['src/a.ts', 'src/c.ts']) assert.doesNotMatch(project.read(`wiki-${format}/modules/${page}.${ext}`), /realdocs:c4/);
  }
});

test('a multi-line marker comment inside a blockquote is reported and stripped', t => {
  const project = shopProject(t, { 'docs/notes.md': '# Notes\n\n> <!--\n> @realdocs:c4 shop\n> -->\n' });
  const result = project.result('check', ...shopArgs, '--page', 'docs/notes.md');
  assert.equal(result.status, 1);
  assert.match(result.stderr, /docs\/notes\.md:3:3: error: Place <!-- @realdocs:c4 … -->/);
});

test('writes c4.html with the model, assets, and a homepage link only with --c4', t => {
  const project = marked(t);
  project.run('build', ...markedArgs, '--format', 'html', '--out', 'plain');
  assert.equal(existsSync(join(project.cwd, 'plain/c4.html')), false);
  assert.doesNotMatch(project.read('plain/index.html'), /c4\.html/);

  const { model } = readModel(project, ...markedArgs);
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
  project.write('docs/xss.md', '# Xss\n\n' + fence(context.replace('"Charges cards"', '"</script><script>alert(2)</script>"')));
  const { model } = readModel(project, ...markedArgs, '--page', 'docs/xss.md');
  const page = project.read('wiki/c4.html');
  assert.equal(page.match(/<\/script>/g).length, page.match(/<script/g).length);
  assert.ok(JSON.stringify(model).includes('alert(2)'));
});

for (const [folder, label] of [['C#', 'hash'], ['100% done', 'percent'], ['q" onmouseover="alert(1)', 'quote']]) {
  test(`rebased item links match the wiki's own links (${label} folder)`, t => {
    const project = fixture(t, {
      [`docs/${folder}/a.md`]: `# A\n\n${fence(context)}\n## Notes\n<!-- @realdocs:c4 shop -->\n\n[other](other.md) [frag](#notes) [query](?x=1) [both](other.md#a/../b) [up](../top.md#t)\n`,
      [`docs/${folder}/other.md`]: '# Other\n',
      'docs/top.md': '# Top\n',
    });
    const args = ['--page', `docs/${folder}/a.md`, '--page', `docs/${folder}/other.md`, '--page', 'docs/top.md'];
    const { model } = readModel(project, ...args);
    const item = model.items.find(i => i.kind === 'section');
    const hrefs = [...item.html.matchAll(/ href="([^"]*)"/g)].map(m => m[1]);
    assert.doesNotMatch(item.html, /onmouseover=/);
    // The wiki's own page, rendered in place, links to the same targets relative to itself.
    const origin = item.origin;
    const own = [...project.read(`wiki/${origin}`).matchAll(/ href="([^"]*)"/g)].map(m => m[1])
      .filter(h => /other|top|\?x|#notes/.test(h) && !h.includes('#a/'));
    const encodedDir = origin.split('/').slice(0, -1).map(encode).join('/');
    const expected = own.map(h => h.startsWith('#') || h.startsWith('?') ? `${origin.split('/').map(encode).join('/')}${h}`
      : posix.normalize(`${encodedDir}/${h}`));
    // A suffix after the first # is never normalized.
    assert.ok(hrefs.includes(`${encodedDir}/other.md#a/../b`), hrefs.join('\n'));
    assert.deepEqual(hrefs.filter(h => /other|top|\?x|#notes/.test(h) && !h.includes('#a/')), expected);
    for (const h of hrefs.filter(h => /\.html([?#]|$)/.test(h))) {
      const file = decodeURIComponent(h.split(/[?#]/)[0]);
      assert.ok(existsSync(join(project.cwd, 'wiki', file)), `${h} resolves to a file`);
    }
  });
}

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

test('the fulfillment example builds a strict C4 page with marked content', t => {
  const out = mkdtempSync(join(tmpdir(), 'realdocs-c4-example-'));
  t.after(() => rmSync(out, { recursive: true, force: true }));
  const example = fileURLToPath(new URL('../examples/fulfillment/', import.meta.url));
  execFileSync(process.execPath, [cli, 'build', '--strict', '--c4', '--format', 'html', '--out', out], { cwd: example, encoding: 'utf8' });
  const model = JSON.parse(readFileSync(join(out, 'c4.html'), 'utf8').match(/id="c4-data">(.*?)<\/script>/s)[1]);
  assert.deepEqual(model.levels.map(l => l.key).sort(), ['', 'fulfillment', 'runtime']);
  assert.ok(model.items.some(i => i.path === 'fulfillment' && i.kind === 'section'));
  assert.ok(model.items.some(i => i.path === 'fulfillment.runtime' && i.kind === 'diagram'));
  assert.ok(model.items.some(i => i.path === 'fulfillment.runtime.coordinator' && i.kind === 'symbol'));
});
