import { readFileSync } from 'node:fs';
import { posix } from 'node:path';
import { encodeHrefComponent } from './markdown.js';
import { mermaidSetup, style } from './html.js';
import type { C4Item, C4Model, Documentation } from './model.js';

const escape = (text: string): string => text.replace(/[&<>"]/g, char => `&#${char.charCodeAt(0)};`);

let client: string | undefined;
let stylesheet: string | undefined;

// Relative links in an item's HTML were written for the page it came from; c4.html sits at the wiki root.
// `origin` is a raw output path (folder names may contain %, #, quotes), so encode its segments the way
// the wiki's own links do; the link itself is already URL-encoded and HTML-escaped.
function rebase(html: string, origin: string): string {
  const encodedOrigin = origin.split('/').map(encodeHrefComponent).join('/');
  const directory = posix.dirname(encodedOrigin);
  return html.replace(/(\s(?:href|src)=")([^"]*)"/g, (whole, prefix: string, url: string) => {
    if (!url || url.startsWith('/') || /^[a-z][a-z0-9+.-]*:/i.test(url)) return whole;
    const split = url.search(/[?#]/);
    const path = split < 0 ? url : url.slice(0, split);
    const suffix = split < 0 ? '' : url.slice(split);
    const target = path ? posix.normalize(posix.join(directory, path)) : encodedOrigin;
    return `${prefix}${target}${suffix}"`;
  });
}

export function renderC4Page(documentation: Documentation, renderMarkdown: (markdown: string) => string): Map<string, string> {
  const model = documentation.c4 as C4Model;
  const items = model.items.map(({ markdown, ...item }: C4Item) =>
    markdown === undefined ? item : { ...item, html: rebase(renderMarkdown(markdown), item.origin) });
  const title = documentation.navigation?.title ?? 'Project documentation';
  const json = JSON.stringify({ ...model, items, title }).replaceAll('<', '\\u003c');
  client ??= readFileSync(new URL('../assets/c4.js', import.meta.url), 'utf8');
  stylesheet ??= readFileSync(new URL('../assets/c4.css', import.meta.url), 'utf8');
  const page = `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>${escape(title)} architecture</title>
  <style>${style}</style>
  <link rel="stylesheet" href="assets/c4.css">
  <script defer src="assets/mermaid.min.js"></script>
  <script>globalThis.realdocsConfigureMermaid = mermaid => {
${mermaidSetup}};</script>
  <script defer src="assets/c4.js"></script>
</head>
<body>
<header>
  <h1>${escape(title)}</h1>
  <nav class="crumbs" aria-label="Zoom level"></nav>
  <span class="level"></span>
  <div class="variants" aria-label="Source views"></div>
</header>
<div class="workspace">
  <div class="stage"><div class="canvas"></div></div>
  <aside class="panel" aria-label="Element details"><div class="panel-inner"></div></aside>
</div>
<footer>
  Click a box for details · Double-click a box marked <strong>+</strong>, or scroll up over it, to zoom in (<strong>↗</strong> jumps to a neighbour's own view) · Scroll down or <kbd>Backspace</kbd> to zoom out · <kbd>Esc</kbd> closes the panel
</footer>
<dialog id="enlarge"><div class="dlg-head"><strong></strong><button type="button" value="close">Close</button></div><div class="dlg-body"></div></dialog>
<script type="application/json" id="c4-data">${json}</script>
</body>
</html>
`;
  return new Map([['c4.html', page], ['assets/c4.js', client], ['assets/c4.css', stylesheet]]);
}
