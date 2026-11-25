import assert from 'node:assert/strict';
import { execFileSync, spawn, spawnSync } from 'node:child_process';
import { once } from 'node:events';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs';
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

test('builds a linked wiki from JavaScript JSDoc and TypeScript exports without templates', t => {
  const project = fixture(t, {
    'tsconfig.json': JSON.stringify({
      compilerOptions: { module: 'NodeNext', paths: { '#counts': ['./src/counts.js'] } },
      include: ['src'],
    }),
    'src/counts.js': `
/** The fallback count. */
export const fallback = 0;
/**
 * Convert text to a number. See {@link fallback | the default count}.
 * @param {string} text The input text.
 * @returns {number} The parsed count.
 * @example parseCount("4")
 * @deprecated Use a decimal parser in new code.
 */
export function parseCount(text) { return Number(text); }
/** Internal implementation. */
function internalHelper() {}
`,
    'src/index.ts': `
export { parseCount as parse } from '#counts';
/** A labeled result. */
export interface Result { label: string }
export function label(value: string): string;
export function label(value: number): string;
export function label(value: string | number) { return String(value); }
`,
  });

  project.run('build', '--entry', 'src/index.ts', '--entry', 'src/counts.js');

  const home = project.read('dist/realdocs/index.md');
  assert.match(home, /\]\(modules\/src\/index\.ts\.md\)/);
  const page = project.read('dist/realdocs/modules/src/index.ts.md');
  assert.match(page, /export function parse\(text: string\): number/);
  assert.match(page, /\[the default count\]\(counts\.js\.md#symbol-fallback\)/);
  assert.match(page, /The input text\./);
  assert.match(page, /The parsed count\./);
  assert.match(page, /parseCount\("4"\)/);
  assert.match(page, /Deprecated.*Use a decimal parser/);
  assert.match(page, /export interface Result \{\s+label: string;?\s*\}/);
  assert.match(page, /export function label\(value: string\): string/);
  assert.match(page, /export function label\(value: number\): string/);
  assert.doesNotMatch(page, /label\(value: string \| number\)/);
  assert.doesNotMatch(project.read('dist/realdocs/modules/src/counts.js.md'), /internalHelper|Internal implementation/);
});

test('renders leading @realdocs:file documentation before the exports of each entry point', t => {
  const project = fixture(t, {
    'index.ts': `/**
 * @realdocs:file Overview of the **public API**.
 *
 * Use this entry point for new applications.
 *
 * \`\`\`mermaid
 * ---
 * config:
 *   theme: forest
 * ---
 * flowchart TD
 *   Source --> Wiki
 * \`\`\`
 */
/** Version of the protocol. */
export const version = 1;
`,
    'rates.cjs': `#!/usr/bin/env node
/** @livedocs:file Legacy rate service. */
/** Returns the flat fee. */
module.exports = function flatFee() { return 450; };
/** @realdocs:file This comment occurs after a declaration. */
`,
  });

  project.run('build', '--entry', 'index.ts', '--entry', 'rates.cjs', '--out', 'wiki');

  const api = project.read('wiki/modules/index.ts.md');
  assert.match(api, /^# `index\.ts`\n\nOverview of the \*\*public API\*\*\.\n\nUse this entry point/);
  assert.match(api, /```mermaid\n---\nconfig:\n  theme: forest\n---\nflowchart TD\n  Source --> Wiki\n```/);
  assert.match(api, /## `version`[\s\S]*Version of the protocol\./);
  assert.equal(api.match(/Overview of the/g)?.length, 1);
  assert.doesNotMatch(api, /@realdocs:file/);

  const legacy = project.read('wiki/modules/rates.cjs.md');
  assert.match(legacy, /^# `rates\.cjs`\n\nLegacy rate service\./);
  assert.match(legacy, /## `module\.exports`[\s\S]*Returns the flat fee\./);
  assert.doesNotMatch(legacy, /This comment occurs after a declaration/);
});

test('groups tagged pages and exports in both wiki formats', t => {
  const project = fixture(t, {
    'src/stock.ts': `/**
 * @realdocs:file Stock operations.
 * @realdocs:tag Inventory
 * @realdocs:tag Architecture
 * @realdocs:tag inventory
 */
export const defaultStock = 10;
/**
 * Verify current stock.
 * @realdocs:tag inventory
 * @realdocs:tag Stock Checks
 */
export function inspectStock() { return defaultStock; }
`,
    'docs/guide.md': '<!-- @realdocs:tag inventory -->\n<!-- @livedocs:tag Architecture -->\n\n# Stock guide\n',
  });
  const args = ['--entry', 'src/stock.ts', '--page', 'docs/guide.md', '--strict'];
  project.run('build', ...args, '--out', 'wiki');
  project.run('build', ...args, '--out', 'site', '--format', 'html');

  assert.match(project.read('wiki/index.md'), /\[Tags\]\(tags\.md\)/);
  const tags = project.read('wiki/tags.md');
  assert.match(tags, /id="tag-architecture"/);
  assert.match(tags, /id="tag-inventory"/);
  assert.match(tags, /id="tag-stock-checks"/);
  assert.equal(tags.match(/id="tag-inventory"/g)?.length, 1);
  assert.match(tags, /\(pages\/docs\/guide\.md\)/);
  assert.match(tags, /\(modules\/src\/stock\.ts\.md\)/);
  assert.match(tags, /\(modules\/src\/stock\.ts\.md#symbol-inspectStock\)/);
  assert.doesNotMatch(tags, /#symbol-defaultStock/);

  assert.match(project.read('wiki/modules/src/stock.ts.md'), /\(\.\.\/\.\.\/tags\.md#tag-stock-checks\)/);
  const guide = project.read('site/pages/docs/guide.html');
  assert.match(guide, /href="\.\.\/\.\.\/tags\.html#tag-inventory"/);
  assert.match(guide, /href="\.\.\/\.\.\/tags\.html#tag-architecture"/);
  assert.doesNotMatch(guide, /@(?:realdocs|livedocs):tag/);
  assert.match(project.read('site/tags.html'), /href="modules\/src\/stock\.ts\.html#symbol-inspectStock"/);
});

test('builds a linked HTML wiki with a local Mermaid runtime', t => {
  const project = fixture(t, {
    'src/index.ts': `/**
 * @realdocs:file **Fulfillment** example.
 *
 * \`\`\`mermaid
 * flowchart TD
 *   Order --> Shipment
 * \`\`\`
 */
import { shipment } from './shipping.js';
/** Prepares a {@link shipment}. */
export const prepare = () => shipment;
`,
    'src/shipping.ts': `/**
 * @realdocs:file Shipping reference.
 *
 * <script>window.exampleMarker = 1;</script>
 *
 * [Unsafe page](javascript:example())
 */
/** A shipment record. */
export const shipment = { ready: true };
`,
  });
  const args = ['--entry', 'src/index.ts', '--entry', 'src/shipping.ts', '--out', 'wiki'];
  project.run('build', ...args);
  project.run('build', ...args, '--format', 'html');

  const home = project.read('wiki/index.html');
  assert.match(home, /^<!doctype html>/i);
  assert.match(home, /href="modules\/src\/index\.ts\.html"/);
  assert.doesNotMatch(home, /<script/);
  assert.equal(existsSync(join(project.cwd, 'wiki/index.md')), false);
  assert.equal(existsSync(join(project.cwd, 'wiki/modules/src/index.ts.md')), false);

  const main = project.read('wiki/modules/src/index.ts.html');
  assert.match(main, /<strong>Fulfillment<\/strong>/);
  assert.match(main, /href="\.\.\/\.\.\/index\.html"/);
  assert.match(main, /href="shipping\.ts\.html#symbol-shipment"/);
  assert.match(main, /class="language-mermaid">flowchart TD\n  Order --&gt; Shipment/);
  assert.match(main, /src="\.\.\/\.\.\/assets\/mermaid\.min\.js"/);
  assert.ok(statSync(join(project.cwd, 'wiki/assets/mermaid.min.js')).size > 0);

  const shipping = project.read('wiki/modules/src/shipping.ts.html');
  assert.match(shipping, /id="symbol-shipment"/);
  assert.match(shipping, /&lt;script&gt;window\.exampleMarker/);
  assert.doesNotMatch(shipping, /<script|href="javascript:/);

  project.run('build', ...args, '--format', 'markdown');
  assert.equal(existsSync(join(project.cwd, 'wiki/index.html')), false);
  assert.equal(existsSync(join(project.cwd, 'wiki/assets')), false);
  assert.match(project.read('wiki/index.md'), /modules\/src\/index\.ts\.md/);
});

test('updates diagram labels and links after a symbol is renamed and moved', t => {
  const source = name => `/**
 * Create an invoice.
 * @realdocs:docId billing.create
 * @realdocs:docUses billing.validate
 */
export function ${name}() { return validateInvoice(); }
/** @livedocs:docId billing.validate */
export function validateInvoice() { return true; }
`;
  const diagram = `# Billing workflow

\`\`\`mermaid
flowchart LR
  Create["{{ symbol('billing.create').name }}"] --> Check["{{ symbol('billing.validate').name }}"]
  {{ diagram.link('Create', 'billing.create') }}
\`\`\`

## Declared dependencies

{{ diagram.dependencies("billing.create") }}
`;
  const project = fixture(t, { 'src/billing.ts': source('createInvoice'), 'docs/flow.md': diagram });
  const options = ['--page', 'docs/flow.md', '--out', 'wiki', '--strict'];
  project.run('build', '--entry', 'src/billing.ts', ...options);
  const original = project.read('wiki/pages/docs/flow.md');
  assert.match(original, /Create\["createInvoice"\]/);
  assert.match(original, /s0 --> s1/);
  assert.match(original, /billing\.ts\.md#doc-billing\.create/);

  project.write('src/invoices.ts', source('issueInvoice'));
  rmSync(join(project.cwd, 'src/billing.ts'));
  project.run('build', '--entry', 'src/invoices.ts', ...options, '--format', 'html');
  const moved = project.read('wiki/pages/docs/flow.html');
  assert.match(moved, /Create\[&quot;issueInvoice&quot;\]/);
  assert.match(moved, /invoices\.ts\.html#doc-billing\.create/);
  const invoices = project.read('wiki/modules/src/invoices.ts.html');
  assert.match(invoices, /id="doc-billing\.create"/);
  assert.match(invoices, /id="symbol-issueInvoice"/);
  assert.doesNotMatch(moved, /createInvoice|\{\{\s*(?:symbol|diagram)/);
  assert.equal(project.read('docs/flow.md'), diagram);
});

test('keeps unusual export names inside a single Mermaid label', t => {
  const project = fixture(t, {
    'src/billing.ts': `/** @realdocs:docId billing.special */
const original = 1;
export { original as 'quoted"<item>' };
`,
    'docs/flow.md': `# Diagram

\`\`\`mermaid
flowchart LR
  A["{{ symbol('billing.special').name }}"]
\`\`\`
`,
  });
  project.run('build', '--entry', 'src/billing.ts', '--page', 'docs/flow.md', '--out', 'wiki');
  assert.match(project.read('wiki/pages/docs/flow.md'), /A\["quoted#34;#60;item#62;"\]/);
});

test('check rejects duplicate IDs and reports unresolved diagram references at their source', t => {
  const project = fixture(t, {
    'src/billing.ts': `/**
 * @realdocs:docId billing.create
 * @realdocs:docUses billing.missing
 */
export function createInvoice() {}
/** @realdocs:docId billing.create */
export function otherInvoice() {}
`,
    'docs/flow.md': `# Diagram

\`\`\`mermaid
flowchart LR
  A["{{ symbol('billing.gone').name }}"]
\`\`\`
`,
  });
  const result = project.result('check', '--entry', 'src/billing.ts', '--page', 'docs/flow.md', '--out', 'wiki');
  assert.equal(result.status, 1, result.stderr);
  assert.match(result.stderr, /error: Duplicate @realdocs:docId billing\.create/);
  assert.match(result.stderr, /error: .*billing\.missing/);
  assert.match(result.stderr, /docs\/flow\.md:5:\d+: error: .*billing\.gone/);
  assert.equal(existsSync(join(project.cwd, 'wiki')), false);
});

test('check reports unfinished and misplaced diagram directives', t => {
  const project = fixture(t, {
    'src/billing.ts': '/** @realdocs:docId billing.create */\nexport function createInvoice() {}',
    'docs/flow.md': `# Diagram

\`\`\`mermaid
flowchart LR
  A["{{ symbol('billing.create').name }} {{ symbol('billing.create').name"]
  click A href "https://example.com/{{ symbol('billing.create').name }}"
\`\`\`

Put the graph here {{ diagram.dependencies('billing.create') }}.

\`{{ diagram.dependencies('billing.create') }}\` is a literal example.

\\{{ diagram.dependencies('billing.create') }} is also literal.
`,
  });
  const result = project.result('check', '--entry', 'src/billing.ts', '--page', 'docs/flow.md');
  assert.equal(result.status, 1, result.stderr);
  assert.match(result.stderr, /docs\/flow\.md:5:\d+: error: Unterminated Mermaid reference/);
  assert.match(result.stderr, /docs\/flow\.md:6:\d+: error: .*double-quoted Mermaid label/);
  assert.match(result.stderr, /docs\/flow\.md:9:\d+: error: .*diagram\.dependencies/);
  assert.doesNotMatch(result.stderr, /docs\/flow\.md:(11|13):/);
});

test('keeps HTML navigation and symbol anchors outside the authored overview', t => {
  const project = fixture(t, {
    'index.ts': `/**
 * @realdocs:file Overview with an incomplete example.
 *
 * <div id="symbol-count"></div>
 *
 * \`\`\`text
 * This code fence has no closing line.
 */
export const count = 1;
`,
  });
  project.run('build', '--entry', 'index.ts', '--out', 'wiki', '--format', 'html');

  const page = project.read('wiki/modules/index.ts.html');
  assert.match(page, /&lt;div id=&quot;symbol-count&quot;&gt;/);
  assert.match(page, /<pre><code class="language-text">This code fence has no closing line\.\n<\/code><\/pre>/);
  assert.match(page, /href="\.\.\/index\.html"/);
  assert.equal(page.match(/id="symbol-count"/g)?.length, 1);
  assert.match(page, /<h2(?: [^>]*)?><code>count<\/code><\/h2>/);
});

test('embeds the file map and its relationships in both wiki indexes', t => {
  const project = fixture(t, {
    'src/index.ts': "export { prepare } from './workflow.js';",
    'src/workflow.ts': `/**
 * @realdocs:file Coordinates stock. See the [guide](../docs/guide.md).
 * @realdocs:zone Operations
 */
import type { Order } from './model/order.js';
import { stock } from './inventory.js';
export function prepare(order: Order) { return stock(order.quantity); }
`,
    'src/model/order.ts': 'export interface Order { quantity: number }',
    'src/inventory.ts': 'export const stock = (quantity: number) => quantity > 0;',
    'docs/guide.md': '<!-- @realdocs:zone Architecture -->\n# Guide\n\n[Workflow](../src/workflow.ts#prepare)\n',
  });
  const args = ['--entry', 'src/index.ts', '--entry', 'src/workflow.ts', '--page', 'docs/guide.md', '--graph'];
  project.run('build', ...args, '--out', 'wiki');
  const graph = project.read('wiki/index.md');
  assert.match(graph, /^## File map\n\n```mermaid\nflowchart/m);
  assert.match(graph, /\(pages\/docs\/guide\.md\)/);
  assert.equal(existsSync(join(project.cwd, 'wiki/graph.md')), false);
  assert.match(graph, /Architecture/);
  assert.match(graph, /src\/model\/order\.ts/);

  project.run('build', ...args, '--out', 'site', '--format', 'html');
  const html = project.read('site/index.html');
  assert.match(html, /<section[^>]*aria-labelledby="file-map-title"/);
  assert.match(html, /<h2 id="file-map-title">File map<\/h2>/);
  assert.equal(existsSync(join(project.cwd, 'site/graph.html')), false);
  assert.match(html, /src="assets\/cytoscape\.min\.js"/);
  assert.doesNotMatch(project.read('site/modules/src/index.ts.html'), /file-map-data|cytoscape/);
  const data = JSON.parse(html.match(/<script type="application\/json" id="file-map-data">(.*?)<\/script>/s)[1]);
  assert.deepEqual(data.nodes.map(node => [node.path, node.zone, node.href ?? null]), [
    ['docs/guide.md', 'Architecture', 'pages/docs/guide.html'],
    ['src/index.ts', 'src', 'modules/src/index.ts.html'],
    ['src/inventory.ts', 'src', null],
    ['src/model/order.ts', 'src/model', null],
    ['src/workflow.ts', 'Operations', 'modules/src/workflow.ts.html'],
  ]);
  assert.deepEqual(data.edges.map(({ source, target, kind }) => [source, target, kind]), [
    ['docs/guide.md', 'src/workflow.ts', 'doc-link'],
    ['src/index.ts', 'src/workflow.ts', 're-export'],
    ['src/workflow.ts', 'docs/guide.md', 'doc-link'],
    ['src/workflow.ts', 'src/inventory.ts', 'import'],
    ['src/workflow.ts', 'src/model/order.ts', 'type-only'],
  ]);

  project.run('build', ...args.filter(arg => arg !== '--graph'), '--out', 'site', '--format', 'html');
  assert.doesNotMatch(project.read('site/index.html'), /file-map-data|cytoscape/);
  assert.equal(existsSync(join(project.cwd, 'site/assets/cytoscape.min.js')), false);
});

test('includes explicitly selected Markdown and resolves links in both wiki formats', t => {
  const project = fixture(t, {
    'README.md': '# Fulfillment\n\n[Design][architecture]\n\n[architecture]: docs/architecture.md#shipment-flow\n',
    'docs/architecture.md': `# Architecture

## Shipment flow

[Read the overview](../README.md#fulfillment) and [prepare a shipment](../src/index.ts#prepareShipment).

[See the decision](#decision-notes).

> ### Decision notes ###

\`\`\`md
[Literal reference](../src/index.ts#example)
\`\`\`
`,
    'src/index.ts': '/** @realdocs:file See the [shipment flow](../docs/architecture.md#shipment-flow). */\nexport function prepareShipment() {}',
    'notes.md': '# Private notes',
  });
  const args = ['--entry', 'src/index.ts', '--page', 'README.md', '--page', 'docs/architecture.md', '--strict'];
  project.run('build', ...args, '--out', 'wiki');
  project.run('build', ...args, '--out', 'site', '--format', 'html');

  assert.match(project.read('wiki/index.md'), /\[Fulfillment\]\(pages\/README\.md\)/);
  assert.match(project.read('wiki/modules/src/index.ts.md'), /\(\.\.\/\.\.\/pages\/docs\/architecture\.md#shipment-flow\)/);
  const architecture = project.read('wiki/pages/docs/architecture.md');
  assert.match(architecture, /id="shipment-flow"/);
  assert.match(architecture, /\(\.\.\/\.\.\/modules\/src\/index\.ts\.md#symbol-prepareShipment\)/);
  assert.match(architecture, /\[Literal reference\]\(\.\.\/src\/index\.ts#example\)/);
  assert.match(architecture, /^> ### Decision notes <a id="decision-notes"><\/a> ###$/m);
  assert.equal(existsSync(join(project.cwd, 'wiki/pages/notes.md')), false);

  assert.match(project.read('site/index.html'), /href="pages\/docs\/architecture\.html"/);
  assert.match(project.read('site/pages/README.html'), /href="docs\/architecture\.html#shipment-flow"/);
  const html = project.read('site/pages/docs/architecture.html');
  assert.match(html, /<h2 id="shipment-flow">Shipment flow<\/h2>/);
  assert.match(html, /href="\.\.\/README\.html#fulfillment"/);
  assert.match(html, /href="\.\.\/\.\.\/modules\/src\/index\.ts\.html#symbol-prepareShipment"/);
  assert.match(html, /<h3 id="decision-notes">Decision notes<\/h3>/);
});

test('preserves query values when a Markdown link is rewritten', t => {
  const project = fixture(t, {
    'README.md': '# Guide\n\n<div>\n## Literal heading\n[Filtered guide](other.md?filter=foo\\)&amp;copy;#linked-guide)\n</div>\n',
    'other.md': '# Linked guide',
  });
  project.run('build', '--page', 'README.md', '--page', 'other.md', '--strict', '--out', 'wiki', '--format', 'html');
  const html = project.read('wiki/pages/README.html');
  assert.match(html, /href="other\.html\?filter=foo%29&amp;copy;#linked-guide"/);
  assert.match(html, /id="literal-heading"/);

  project.run('build', '--page', 'README.md', '--page', 'other.md', '--strict', '--out', 'markdown');
  const markdown = project.read('markdown/pages/README.md');
  assert.match(markdown, /<div>\n## Literal heading\n/);
  assert.doesNotMatch(markdown, /id="literal-heading"/);
});

test('checks links in Markdown-only projects and reports missing targets at the source line', t => {
  const project = fixture(t, {
    'README.md': '# Guide\n\n[Missing guide](other.md)\n\n[Missing section](#missing)\n',
    'other.md': '# Linked guide',
  });
  const result = project.result('check', '--page', 'README.md', '--strict', '--out', 'wiki');
  assert.equal(result.status, 1, result.stderr);
  assert.match(result.stderr, /README\.md:3:\d+: warning: .*other\.md/);
  assert.match(result.stderr, /README\.md:5:\d+: warning: .*missing/);
  assert.equal(existsSync(join(project.cwd, 'wiki')), false);

  project.write('README.md', '# Guide\n\n[Linked guide](other.md)\n\n[unused]: missing.md\n');
  project.run('build', '--page', 'README.md', '--page', 'other.md', '--strict', '--out', 'wiki');
  assert.match(project.read('wiki/pages/README.md'), /\[Linked guide\]\(other\.md\)/);
});

test('watch updates a standalone page and recovers after it is restored', { timeout: 15_000 }, async t => {
  const project = fixture(t, { 'README.md': '# Guide\n\nOriginal guide.\n' });
  const child = spawn(process.execPath, [cli, 'watch', '--page', 'README.md', '--out', 'wiki', '--format', 'html'], {
    cwd: project.cwd,
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  const exited = once(child, 'exit');
  let output = '';
  for (const stream of [child.stdout, child.stderr]) stream.setEncoding('utf8').on('data', chunk => { output += chunk; });
  const waitFor = async (pattern, start = 0) => {
    const deadline = Date.now() + 6_000;
    while (!pattern.test(output.slice(start)) && child.exitCode === null && Date.now() < deadline) await delay(20);
    assert.match(output.slice(start), pattern, output);
  };

  try {
    const page = 'wiki/pages/README.html';
    await waitFor(/Watching for source changes/);
    const original = project.read(page);
    assert.match(original, /Original guide\./);

    const beforeRemoval = output.length;
    rmSync(join(project.cwd, 'README.md'));
    await waitFor(/Could not read Markdown page README\.md/, beforeRemoval);
    assert.equal(project.read(page), original);

    const beforeRestore = output.length;
    project.write('README.md', '# Guide\n\nUpdated guide.\n');
    await waitFor(/Generated 2 wiki page\(s\).*\(1 written\)/, beforeRestore);
    assert.match(project.read(page), /Updated guide\./);
  } finally {
    child.kill();
    await exited;
  }
});

test('resolves untyped JS dependencies but rejects missing named imports', t => {
  const project = fixture(t, {
    'node_modules/plain/package.json': '{"main":"index.js"}',
    'node_modules/plain/index.js': 'module.exports = 1;',
    'start.js': "import value from 'plain'; import { basename } from 'node:path'; export const read = () => basename(value);",
    'broken.ts': "import { gone } from './local.js'; export const value = gone;",
    'local.ts': 'export const actual = 1;',
  });
  project.run('build', '--entry', 'start.js', '--out', 'wiki');
  const missing = project.result('check', '--entry', 'broken.ts');
  assert.equal(missing.status, 1, missing.stderr);
  assert.match(missing.stderr, /broken\.ts:1:\d+: error: .*gone/);
});

test('shows public class members and all parts of a merged interface', t => {
  const project = fixture(t, {
    'index.ts': `
export class Counter {
  private count = 0;
  constructor(readonly name: string) {}
  increment(by: number) { this.count += by; return this.count; }
  private reset() { this.count = 0; }
}
export interface Options { minimum: number }
export interface Options { maximum?: number }
`,
  });
  project.run('build', '--entry', 'index.ts', '--out', 'wiki');
  const page = project.read('wiki/modules/index.ts.md');
  assert.match(page, /constructor\(readonly name: string\)/);
  assert.match(page, /increment\(by: number\): number/);
  assert.doesNotMatch(page, /reset\(|private count/);
  assert.match(page, /minimum: number/);
  assert.match(page, /maximum\?: number/);
});

test('documents export assignments and distinguishes type-only re-exports', t => {
  const project = fixture(t, {
    'public.cjs': '/** Runs the task. */\nmodule.exports = function run(value) { return value === 1; };',
    'types.ts': 'function run(value: number) { return value; }\nexport type { run as Run };',
  });
  project.run('build', '--entry', 'public.cjs', '--entry', 'types.ts', '--out', 'wiki');
  const common = project.read('wiki/modules/public.cjs.md');
  assert.match(common, /module\.exports/);
  assert.match(common, /Runs the task/);
  const types = project.read('wiki/modules/types.ts.md');
  assert.match(types, /export type \{ run as Run \}/);
  assert.doesNotMatch(types, /export function Run/);
});

test('checks stale parameter docs and unresolved links without writing output', t => {
  const project = fixture(t, {
    'index.ts': `/**
 * See {@link Missing}.
 * @param former Former parameter.
 */
export function count(current: number) { return current; }
`,
  });

  const result = project.result('check', '--entry', 'index.ts', '--strict', '--out', 'wiki');

  assert.equal(result.status, 1, result.stderr);
  assert.match(result.stderr, /index\.ts:\d+:\d+: warning: .*@param.*former/);
  assert.match(result.stderr, /index\.ts:\d+:\d+: warning: .*link.*Missing/i);
  assert.equal(existsSync(join(project.cwd, 'wiki')), false);
});

test('refreshes changed facts and removes pages for removed entry points', t => {
  const project = fixture(t, {
    'index.ts': '/** Original explanation. */\nexport function count(n: number) { return n; }',
    'extra.ts': 'export const extra = 1;',
  });
  const currentPage = 'wiki/modules/index.ts.md';
  project.run('build', '--entry', 'index.ts', '--entry', 'extra.ts', '--out', 'wiki');
  assert.match(project.read(currentPage), /Original explanation/);

  project.write('index.ts', '/** Current explanation. */\nexport function count(n: string) { return n.length; }');
  project.run('build', '--entry', 'index.ts', '--out', 'wiki');

  const contents = project.read(currentPage);
  assert.match(contents, /count\(n: string\): number/);
  assert.match(contents, /Current explanation/);
  assert.doesNotMatch(contents, /Original explanation/);
  assert.deepEqual(readdirSync(join(project.cwd, 'wiki/modules')), ['index.ts.md']);
  const modified = statSync(join(project.cwd, currentPage)).mtimeMs;
  project.run('build', '--entry', 'index.ts', '--out', 'wiki');
  assert.equal(project.read(currentPage), contents);
  assert.equal(statSync(join(project.cwd, currentPage)).mtimeMs, modified);
});

test('keeps the last successful wiki when a re-export breaks', t => {
  const project = fixture(t, { 'index.ts': 'export const count = 1;' });
  project.run('build', '--entry', 'index.ts', '--out', 'wiki');
  const currentPage = 'wiki/modules/index.ts.md';
  const original = project.read(currentPage);
  project.write('index.ts', "export * from './missing.js';");

  const result = project.result('build', '--entry', 'index.ts', '--out', 'wiki');

  assert.equal(result.status, 1, result.stderr);
  assert.match(result.stderr, /index\.ts:1:\d+: error: .*missing\.js/);
  assert.equal(project.read(currentPage), original);
});

test('preserves an existing output directory that contains user files', t => {
  const project = fixture(t, {
    'index.ts': 'export const count = 1;',
    'wiki/manual.md': 'A manually maintained page.',
  });

  const result = project.result('build', '--entry', 'index.ts', '--out', 'wiki');

  assert.equal(result.status, 1, result.stderr);
  assert.match(result.stderr, /contains files RealDocs does not manage/);
  assert.deepEqual(readdirSync(join(project.cwd, 'wiki')), ['manual.md']);
  assert.equal(project.read('wiki/manual.md'), 'A manually maintained page.');
});

test('preserves a manual file added between staging and publishing', t => {
  const project = fixture(t, {
    'index.ts': 'export const count = 1;',
    'preload.cjs': `
const fs = require('node:fs');
const path = require('node:path');
const rename = fs.renameSync;
fs.renameSync = (from, to) => {
  if (path.basename(from) === 'wiki') fs.writeFileSync(path.join(from, 'manual.md'), 'Keep this.');
  return rename(from, to);
};
require('node:module').syncBuiltinESMExports();
`,
  });
  project.run('build', '--entry', 'index.ts', '--out', 'wiki');
  const original = project.read('wiki/modules/index.ts.md');
  project.write('index.ts', 'export const count = 2;');

  const result = project.withPreload('build', '--entry', 'index.ts', '--out', 'wiki');

  assert.equal(result.status, 1, result.stderr);
  assert.equal(project.read('wiki/manual.md'), 'Keep this.');
  assert.equal(project.read('wiki/modules/index.ts.md'), original);
});

test('recovers an interrupted output swap on the next build', { skip: process.platform === 'win32' }, t => {
  const project = fixture(t, {
    'index.ts': 'export const count = 1;',
    'preload.cjs': `
const fs = require('node:fs');
const path = require('node:path');
const rename = fs.renameSync;
fs.renameSync = (from, to) => {
  if (path.basename(from) === 'next' && path.basename(to) === 'wiki') process.kill(process.pid, 'SIGKILL');
  return rename(from, to);
};
require('node:module').syncBuiltinESMExports();
`,
  });
  project.run('build', '--entry', 'index.ts', '--out', 'wiki');
  project.write('index.ts', 'export const count = 2;');

  assert.equal(project.withPreload('build', '--entry', 'index.ts', '--out', 'wiki').signal, 'SIGKILL');
  project.run('build', '--entry', 'index.ts', '--out', 'wiki');
  assert.match(project.read('wiki/modules/index.ts.md'), /const count: 2/);
});

test('watch keeps the last successful wiki when code and a Markdown page change together', { timeout: 45_000 }, async t => {
  const project = fixture(t, {
    'tsconfig.json': '{"include":["src"]}',
    'README.md': '# Guide\n\nOriginal guide.\n',
    'src/index.ts': "export { count } from './counts.js';",
    'src/counts.ts': '/** Original description. */\nexport function count(value: number) { return value; }',
  });
  const inputs = ['--entry', 'src/index.ts', '--page', 'README.md'];
  const child = spawn(process.execPath, [cli, 'watch', ...inputs, '--out', 'wiki', '--timings'], {
    cwd: project.cwd,
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  const exited = once(child, 'exit');
  let output = '';
  for (const stream of [child.stdout, child.stderr]) {
    stream.setEncoding('utf8').on('data', chunk => { output += chunk; });
  }
  const waitForOutput = async (pattern, start = 0) => {
    const deadline = Date.now() + 12_000;
    while (!pattern.test(output.slice(start)) && child.exitCode === null && Date.now() < deadline) await delay(20);
    assert.match(output.slice(start), pattern, output);
  };

  try {
    const page = 'wiki/modules/src/index.ts.md';
    const guide = 'wiki/pages/README.md';
    await waitForOutput(/Watching for source changes/);
    const original = project.read(page);
    const originalGuide = project.read(guide);
    assert.match(original, /Original description/);

    const beforeError = output.length;
    project.write('README.md', '# Guide\n\nUpdated guide.\n');
    project.write('src/counts.ts', 'export function count(');
    await waitForOutput(/counts\.ts:\d+:\d+: error:/, beforeError);
    assert.equal(project.read(page), original);
    assert.equal(project.read(guide), originalGuide);

    const beforeRecovery = output.length;
    project.write('src/counts.ts', '/** Updated description. */\nexport function count(value: string) { return value.length; }');
    await waitForOutput(/Compiler and extraction \d+ ms, Markdown \d+ ms, output \d+ ms/, beforeRecovery);
    const updated = project.read(page);
    assert.match(updated, /Updated description/);
    assert.match(updated, /count\(value: string\): number/);
    assert.match(project.read(guide), /Updated guide\./);

    project.run('build', ...inputs, '--out', 'clean-wiki');
    assert.equal(project.read('clean-wiki/modules/src/index.ts.md'), updated);
  } finally {
    child.kill();
    await exited;
  }
});
