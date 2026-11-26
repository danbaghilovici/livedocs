import assert from 'node:assert/strict';
import { execFileSync, spawn, spawnSync } from 'node:child_process';
import { once } from 'node:events';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
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
  const { result, model } = dumpModel(project, '--page', 'docs/a.md');
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
  const { model } = dumpModel(project, '--page', 'docs/a.md');
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
  const { result, model } = dumpModel(project, '--page', 'docs/a.md');
  assert.match(result.stderr, /docs\/a\.md:\d+:\d+: error: C4 element x is nested inside itself\./);
  assert.equal(model.elements.find(e => e.alias === 'x').path, 'x');
});
