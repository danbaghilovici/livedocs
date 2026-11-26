// Manual browser check for the C4 page; not part of `npm test`.
// Usage: npm run build && node test/c4-browser.mjs <chromium binary> [screenshot.png]
// Builds a small wiki with --c4 into a temporary directory, drives c4.html over the
// Chrome DevTools Protocol, and prints `ok - <name>` or `not ok - <name>` per check.
import { spawn, spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { fileURLToPath, pathToFileURL } from 'node:url';

const [chrome, screenshot] = process.argv.slice(2);
if (!chrome) {
  console.error('Usage: node test/c4-browser.mjs <chromium binary> [screenshot.png]');
  process.exit(2);
}
const cli = fileURLToPath(new URL('../dist/cli.js', import.meta.url));
const work = mkdtempSync(join(tmpdir(), 'realdocs-c4-browser-'));
let browser;
process.on('exit', () => {
  browser?.kill('SIGKILL');
  rmSync(work, { recursive: true, force: true });
});
process.on('SIGINT', () => process.exit(130));

// The shop/web/api project from test/c4.test.mjs: web and api each appear in the other's component view.
const fence = body => '```mermaid\n' + body + '\n```\n';
const files = {
  'package.json': '{"type":"module"}',
  'docs/architecture.md': `<!-- @realdocs:c4 shop -->
# Architecture

${fence(`C4Context
title Context
Person(customer, "Customer", "Buys")
System(shop, "Shop", "Sells")
System_Ext(payments, "Payments", "Charges cards")
Rel(customer, shop, "Buys from")`)}
## Containers

${fence(`C4Container
title Containers of the shop: serving
Person(customer, "Customer", "Buys")
System_Boundary(shop, "Shop") {
  Container(web, "Web app", "React", "Storefront")
  Container(api, "Order API", "Node.js", "Takes orders")
}
Rel(customer, web, "Uses")
Rel(web, api, "Calls", "HTTPS")`)}
${fence(`C4Container
title Containers of the shop: billing
System_Boundary(shop, "Shop") {
  Container(api, "Order API", "Node.js", "Charges orders")
  ContainerDb(ledger, "Ledger", "PostgreSQL", "Payments")
}
System_Ext(payments, "Payments", "Card processor")
Rel(api, payments, "Charges", "HTTPS")`)}
## Order API notes
<!-- @realdocs:c4 shop.api -->

The API owns [checkout](../src/api.ts#checkout).

${fence(`flowchart LR
  Order --> Checkout`)}
## Unrelated

${'```mermaid'}
%% @realdocs:c4 shop.api
sequenceDiagram
  Web->>API: POST /orders
${'```'}
`,
  'docs/adr.md': '<!-- @realdocs:c4 shop.api -->\n# ADR 1: Use Node\n\nWe use Node.js.\n\n## Context\n\nLong text.\n',
  'docs/api.md': `# Order API\n\n${fence(`C4Component
title Components of the Order API
Container(web, "Web app", "React", "Calls the API")
Container_Boundary(api, "Order API") {
  Component(checkout, "Checkout", "TS", "Validates orders")
}
Rel(web, checkout, "Submits", "HTTPS")`)}`,
  'docs/web.md': `# Web app\n\n${fence(`C4Component
title Components of the Web app
Container(api, "Order API", "Node.js", "Serves the web app")
Container_Boundary(web, "Web app") {
  Component(cart, "Cart", "React", "Holds items")
}
Rel(cart, api, "Submits", "HTTPS")`)}`,
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
};
for (const [file, contents] of Object.entries(files)) {
  mkdirSync(dirname(join(work, file)), { recursive: true });
  writeFileSync(join(work, file), contents);
}
const build = spawnSync(process.execPath, [cli, 'build', '--c4', '--format', 'html', '--out', 'wiki',
  '--entry', 'src/api.ts', '--page', 'docs/architecture.md', '--page', 'docs/adr.md', '--page', 'docs/api.md', '--page', 'docs/web.md'],
{ cwd: work, encoding: 'utf8' });
if (build.status !== 0) {
  console.error(build.stderr);
  process.exit(1);
}
const page = pathToFileURL(join(work, 'wiki/c4.html')).href;

const profile = join(work, 'profile');
browser = spawn(chrome, ['--headless', '--no-sandbox', '--remote-debugging-port=0', `--user-data-dir=${profile}`,
  '--window-size=1500,900', 'about:blank'], { stdio: 'ignore' });
let port;
for (let i = 0; i < 100 && !port; i++) {
  try { port = readFileSync(join(profile, 'DevToolsActivePort'), 'utf8').split('\n')[0]; } catch { await delay(100); }
}
let targets;
for (let i = 0; i < 50 && !targets; i++) {
  try { targets = await (await fetch(`http://127.0.0.1:${port}/json`)).json(); } catch { await delay(100); }
}
const socket = new WebSocket(targets.find(target => target.type === 'page').webSocketDebuggerUrl);
await new Promise((resolve, reject) => { socket.onopen = resolve; socket.onerror = reject; });
let messageId = 0;
const pending = new Map();
socket.onmessage = event => {
  const message = JSON.parse(event.data);
  pending.get(message.id)?.(message);
};
const send = (method, params = {}) => new Promise(resolve => {
  const id = ++messageId;
  pending.set(id, resolve);
  socket.send(JSON.stringify({ id, method, params }));
});
const evaluate = async expression => {
  const { result } = await send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true });
  if (result.exceptionDetails) throw new Error(result.exceptionDetails.exception?.description ?? result.exceptionDetails.text);
  return result.result.value;
};
const until = async (expression, timeout = 5000) => {
  for (const start = Date.now(); Date.now() - start < timeout; await delay(100)) if (await evaluate(expression)) return true;
  return false;
};
const open = async hash => {
  // Leave the page first: a hash-only navigation would keep the old document and its state.
  await send('Page.navigate', { url: 'about:blank' });
  await until('location.href === "about:blank"');
  await send('Page.navigate', { url: `${page}#${hash}` });
  await until('!!window.__c4');
  await evaluate('__c4.ready');
};

let failures = 0;
const check = async (name, assertion) => {
  let detail = '';
  let pass = false;
  try {
    const result = await assertion();
    pass = result === true;
    if (!pass) detail = ` (got ${JSON.stringify(result)})`;
  } catch (error) {
    detail = ` (${error.message})`;
  }
  if (!pass) failures++;
  console.log(`${pass ? 'ok' : 'not ok'} - ${name}${detail}`);
};

await send('Page.enable');
await send('Runtime.enable');
const crumbs = `[...document.querySelectorAll('nav.crumbs button')].map(b => b.textContent).join(' › ')`;
const panelOpen = `document.querySelector('aside.panel').classList.contains('open')`;
const badge = alias => `(() => { const d = document.querySelector('.c4-shape[data-alias="${alias}"] .zoom-badge path')?.getAttribute('d'); return d ? (d.startsWith('M-5') ? '+' : '↗') : 'none'; })()`;
const shapesAccessible = `[...document.querySelectorAll('.canvas .c4-shape')].every(s => s.getAttribute('role') === 'button' && s.getAttribute('tabindex') === '0' && s.getAttribute('aria-label'))`;
const label = alias => `document.querySelector('.c4-shape[data-alias="${alias}"]')?.getAttribute('aria-label')`;
const focused = `document.activeElement.closest('.c4-shape')?.dataset.alias ?? document.activeElement.tagName`;
// The client shows its own text instead of Mermaid's error, and leaves fences that fail to parse as code.
const renderProblem = `(() => {
  const text = document.body.textContent;
  if (/Could not render|Syntax error/i.test(text)) return 'shows "Could not render"';
  if (document.querySelector('.item pre > code.language-mermaid')) return 'leaves a Mermaid fence unrendered';
  if (document.querySelector('body > [id^="dc4"]')) return 'leaves a Mermaid error diagram in the body';
  if (text.includes('Rendering…')) return 'is still rendering';
  return '';
})()`;
const settled = `!document.body.textContent.includes('Rendering…') && !document.querySelector('.item pre > code.language-mermaid')`;
const tabCounts = `Object.fromEntries([...document.querySelectorAll('[role="tab"]')].map(t => [t.dataset.tab, t.querySelector('.count')?.textContent ?? '']))`;
const openTab = async tab => {
  await evaluate(`document.querySelector('[data-tab="${tab}"]').click()`);
  return evaluate(`document.querySelector('[role="tab"][aria-selected="true"]').dataset.tab`);
};

await open('');
await check('opens on the context level', async () => await evaluate(crumbs) === 'Context' && await evaluate(`document.querySelector('.level').textContent`) === 'Level 1 · System context');
await check('the context level badges shop with +', async () => await evaluate(badge('shop')) === '+');
await check('context shapes are buttons with tabindex and a label', () => evaluate(shapesAccessible));
await check('an element without a level of its own is named by its label', async () => await evaluate(label('customer')) === 'Customer');

await evaluate(`__c4.zoomIn('shop')`);
await check('zooming in sets the breadcrumb to the path', async () => await evaluate(crumbs) === 'Context › Shop');
await check('a descendant\'s accessible name says it can zoom in', async () => await evaluate(label('api')) === 'Order API, can zoom in');
await check('a level with several views opens on the first view', async () =>
  JSON.stringify(await evaluate(`[...document.querySelectorAll('.variants button')].map(b => b.textContent + ':' + b.getAttribute('aria-pressed'))`)) ===
  JSON.stringify(['All merged:false', 'Serving:true', 'Billing:false']));
await evaluate(`document.querySelector('.variants [data-variant=""]').click()`);
await check('"All merged" shows elements from every view', () => until(`!!document.querySelector('.c4-shape[data-alias="ledger"]') && !!document.querySelector('.c4-shape[data-alias="web"]')`));

await open('level=shop,api');
await check('a deep link opens the level', async () => await evaluate(crumbs) === 'Context › Shop › Order API');
await check('a peer is badged ↗', async () => await evaluate(badge('web')) === '↗');
await check('a peer\'s accessible name says it can go to its own view', async () => await evaluate(label('web')) === 'Web app, can go to its own view');
const trail = [];
for (const alias of ['web', 'api', 'web', 'api']) {
  await evaluate(`__c4.zoomIn('${alias}')`);
  trail.push(await evaluate(crumbs));
}
await check('jumping between peers never grows the breadcrumb', () => JSON.stringify(trail) === JSON.stringify([
  'Context › Shop › Web app', 'Context › Shop › Order API', 'Context › Shop › Web app', 'Context › Shop › Order API']) || trail);
await check('the hash records the level', async () => await evaluate('location.hash') === '#level=shop%2Capi');

await evaluate(`__c4.select('checkout')`);
await check('selecting an element opens the panel', () => evaluate(panelOpen));
await evaluate(`__c4.select('web')`);
await check('the panel offers to go to a peer', async () => /^Go to Web app components/.test(await evaluate(`document.querySelector('[data-action="zoom"]').textContent`)));
await evaluate(`__c4.zoomIn('web')`);
await check('going to a peer closes the panel', async () => !await evaluate(panelOpen) && await evaluate(crumbs) === 'Context › Shop › Web app');
await evaluate(`__c4.select('cart')`);
await evaluate(`__c4.zoomOut()`);
await check('zooming out closes the panel', async () => !await evaluate(panelOpen) && await evaluate(crumbs) === 'Context › Shop');
await evaluate(`__c4.select('api')`);
await evaluate(`document.querySelector('[data-action="zoom"]').click()`);
await until(`document.querySelector('nav.crumbs').textContent.includes('Order API')`);
await delay(900);
await check('the panel zoom button zooms in and closes the panel', async () => !await evaluate(panelOpen) && await evaluate(crumbs) === 'Context › Shop › Order API');

await open('level=shop&select=api&tab=docs');
await check('a deep link restores level, selection and tab', async () =>
  await evaluate(crumbs) === 'Context › Shop' && await evaluate(panelOpen) && await evaluate('__c4.state.selected') === 'api' &&
  await evaluate(`document.querySelector('[role="tab"][aria-selected="true"]').dataset.tab`) === 'docs');
await check('tabs show their item counts', async () => JSON.stringify(await evaluate(tabCounts)) === JSON.stringify({ overview: '', diagrams: '1', docs: '2', code: '1' }));
await check('Docs items render their HTML', async () =>
  await evaluate(`document.querySelectorAll('.item').length`) === 2 && await evaluate(`document.querySelector('.item .body').textContent.includes('The API owns')`));
await check('a Mermaid fence inside a Docs item renders', () => until(`!!document.querySelector('.item figure.mermaid-diagram svg') && !document.querySelector('.item code.language-mermaid')`));
await check('item links resolve from the wiki root', async () =>
  await evaluate(`document.querySelector('.item-head a').getAttribute('href')`) === 'pages/docs/architecture.html#order-api-notes' &&
  await evaluate(`document.querySelector('.item .body a').getAttribute('href')`) === 'modules/src/api.ts.html#symbol-checkout');
await check('switching tabs updates the hash', async () => await openTab('diagrams') === 'diagrams' && await evaluate('location.hash') === '#level=shop&select=api&tab=diagrams');
await check('Diagrams items render their Mermaid', () => until(`!!document.querySelector('.item .body.diagram svg')`));
await evaluate(`document.querySelector('[data-enlarge]').click()`);
await check('Enlarge opens the diagram in a dialog', async () => await evaluate(`document.getElementById('enlarge').open && !!document.querySelector('#enlarge svg')`));
await evaluate(`document.querySelector('#enlarge button').click()`);
await check('Code file items list their exports', async () => await openTab('code') === 'code' &&
  await evaluate(`[...document.querySelectorAll('.item .body a')].map(a => a.getAttribute('href')).includes('modules/src/api.ts.html#symbol-checkout')`) &&
  await evaluate(`document.querySelector('.item .body').textContent.includes('Order API entry point.')`));
await check('Overview shows Calls and Called by from every view of the home level', async () => {
  await openTab('overview');
  const text = await evaluate(`document.querySelector('[role="tabpanel"]').textContent.replace(/\\s+/g, ' ')`);
  return /Calls ?Payments — Charges \[HTTPS\]/.test(text) && /Called by ?Web app — Calls \[HTTPS\]/.test(text) && /Appears in ?Containers of the shop: serving/.test(text) || text;
});
await check('a Called by entry on screen selects that element', async () => {
  await evaluate(`document.querySelector('[data-goto="web"]').click()`);
  return await evaluate('__c4.state.selected') === 'web';
});

await open('level=shop,api&select=checkout&tab=code');
await check('Code symbol items show the signature and summary', async () =>
  await evaluate(`document.querySelector('.item .body pre code')?.textContent`) === 'export function checkout(order: string): boolean' &&
  await evaluate(`document.querySelector('.item .body').textContent.includes('Validates an order.')`));
await check('Arrow keys move between tabs', async () => {
  await evaluate(`document.querySelector('[role="tab"][aria-selected="true"]').focus()`);
  await send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'ArrowLeft', code: 'ArrowLeft', windowsVirtualKeyCode: 37 });
  return await evaluate(`document.activeElement.dataset.tab`) === 'overview';
});
await send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27 });
await check('Escape closes the panel', async () => !await evaluate(panelOpen));
await evaluate(`document.querySelector('.c4-shape[data-alias="checkout"]').focus()`);
await send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Enter', code: 'Enter', windowsVirtualKeyCode: 13 });
await check('Enter on a focused element selects it', async () => await evaluate(panelOpen) && await evaluate('__c4.state.selected') === 'checkout');
await evaluate(`document.activeElement.blur()`);
await send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Backspace', code: 'Backspace', windowsVirtualKeyCode: 8 });
await check('Backspace zooms out', () => until(`${crumbs} === 'Context › Shop' && !__c4.state.selected`));

await open('level=shop,api');
await evaluate(`document.querySelector('.c4-shape[data-alias="checkout"]').focus()`);
await send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Backspace', code: 'Backspace', windowsVirtualKeyCode: 8 });
await until(`${crumbs} === 'Context › Shop'`);
await delay(800);
await check('zooming out focuses the box it came out of', async () => await evaluate(focused) === 'api' || evaluate(focused));
await send('Input.dispatchKeyEvent', { type: 'keyDown', key: '+', code: 'Equal', text: '+' });
await until(`${crumbs} === 'Context › Shop › Order API'`);
await delay(800);
await check('zooming in with + keeps focus on a box', async () => await evaluate(`!!document.activeElement.closest('.canvas .c4-shape')`) || evaluate(focused));
await open('level=shop&select=api');
await evaluate(`(b => { b.focus(); b.click(); })(document.querySelector('[data-action="zoom"]'))`);
await until(`${crumbs} === 'Context › Shop › Order API'`);
await delay(800);
await check('the panel zoom button leaves focus on a box', async () => await evaluate(`!!document.activeElement.closest('.canvas .c4-shape')`) || evaluate(focused));
await open('level=shop&select=api');
await evaluate(`(b => { b.focus(); b.click(); })(document.querySelector('[data-goto="web"]'))`);
await check('a Called by entry keeps focus in the panel', async () =>
  await evaluate('__c4.state.selected') === 'web' && await evaluate(`document.querySelector('aside.panel').contains(document.activeElement)`));

await open('level=shop');
await check('a click during a transition does not open the panel', async () => {
  const during = await evaluate(`(async () => {
    const done = __c4.zoomIn('api');
    await new Promise(resolve => setTimeout(resolve, 100));
    document.querySelector('.c4-shape[data-alias="web"]').dispatchEvent(new MouseEvent('click', { bubbles: true }));
    const selected = __c4.state.selected;
    await done;
    return selected;
  })()`);
  return during === null && !await evaluate(panelOpen) && await evaluate('__c4.state.selected') === null && await evaluate(crumbs) === 'Context › Shop › Order API';
});
await open('level=shop');
await check('a view toggle during a transition is ignored', async () => {
  const during = await evaluate(`(async () => {
    const done = __c4.zoomOut();
    await new Promise(resolve => setTimeout(resolve, 100));
    document.querySelector('.variants [data-variant="1"]').click();
    const variant = __c4.state.variant;
    await done;
    return variant;
  })()`);
  return during === 0 && await evaluate('__c4.state.variant') === null && await evaluate(crumbs) === 'Context' && !await evaluate(renderProblem);
});

const problems = [];
let accessible = true;
for (const [hash, variants] of [['', 0], ['level=shop', 3], ['level=shop,api', 0], ['level=shop,web', 0]]) {
  await open(hash);
  for (let index = 0; index < Math.max(variants, 1); index++) {
    if (variants) await evaluate(`document.querySelectorAll('.variants button')[${index}].click()`);
    await delay(200);
    accessible &&= await evaluate(shapesAccessible) && await evaluate(`document.querySelectorAll('.canvas .c4-shape').length > 0`);
    const problem = await evaluate(renderProblem);
    if (problem) problems.push(`${await evaluate(crumbs)} view ${index} ${problem}`);
  }
  for (const alias of await evaluate(`[...document.querySelectorAll('.c4-shape')].map(s => s.dataset.alias)`)) {
    await evaluate(`__c4.select('${alias}')`);
    for (const tab of ['diagrams', 'docs', 'code']) {
      if (!await evaluate(`!!document.querySelector('[data-tab="${tab}"]')`)) continue;
      await openTab(tab);
      await until(settled, 3000);
      const problem = await evaluate(renderProblem);
      if (problem) problems.push(`${alias} ${tab} tab on ${await evaluate(crumbs)} ${problem}`);
    }
  }
}
await check('every .c4-shape on every level and view is an accessible button', () => accessible);
await check('every level, view and tab renders without a Mermaid error', () => !problems.length || problems);

if (screenshot) {
  await open('level=shop&select=api&tab=docs');
  await until(`!!document.querySelector('.item figure.mermaid-diagram svg')`);
  await delay(500);
  const { result } = await send('Page.captureScreenshot', { format: 'png' });
  writeFileSync(screenshot, Buffer.from(result.data, 'base64'));
}

await send('Emulation.setDeviceMetricsOverride', { width: 375, height: 800, deviceScaleFactor: 1, mobile: true });
await open('level=shop&select=api');
await check('at 375px the panel overlays the canvas', async () =>
  await evaluate(`getComputedStyle(document.querySelector('aside.panel')).position`) === 'absolute' &&
  await until(`document.querySelector('aside.panel').getBoundingClientRect().width === 375`));

socket.close();
process.exit(failures ? 1 : 0);
