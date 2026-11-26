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
