import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { createRequire } from 'node:module';
import MarkdownIt from 'markdown-it';
import { renderHtmlGraph } from './graph.js';
import { explicitAnchor, href, renderWiki } from './markdown.js';
import { bootstrapScript, bootstrapStyle, renderShell } from './shell.js';
import type { Documentation } from './model.js';

const require = createRequire(import.meta.url);
const markdown = new MarkdownIt();
const escape = markdown.utils.escapeHtml;
const anchorAtStart = new RegExp(`^(?:${explicitAnchor.source})`, 'i');

// Raw HTML stays escaped; only an empty anchor element becomes markup, so links to it resolve.
markdown.inline.ruler.before('html_inline', 'realdocs_anchor', (state, silent) => {
  if (state.src.charCodeAt(state.pos) !== 0x3c) return false;
  const match = anchorAtStart.exec(state.src.slice(state.pos));
  if (!match) return false;
  if (!silent) state.push('realdocs_anchor', 'a', 0).attrSet('id', match[1] ?? match[2]);
  state.pos += match[0].length;
  return true;
});
markdown.renderer.rules.realdocs_anchor = (tokens, index) => `<a id="${escape(String(tokens[index].attrGet('id') ?? ''))}"></a>`;

// Authored content uses Bootstrap's table, code block, and blockquote classes.
markdown.renderer.rules.table_open = () => '<div class="table-responsive"><table class="table table-bordered">\n';
markdown.renderer.rules.table_close = () => '</table></div>\n';
markdown.renderer.rules.blockquote_open = () => '<blockquote class="border-start border-3 ps-3 text-body-secondary">\n';
for (const rule of ['fence', 'code_block'] as const) {
  const render = markdown.renderer.rules[rule]!;
  markdown.renderer.rules[rule] = (...args) => render(...args).replace(/^<pre>/, '<pre class="p-3 bg-body-tertiary border rounded">');
}

// Bootstrap styles the pages. These aliases give the file map and diagrams Bootstrap's colours.
const style = `
  :root {
    --wiki-page: var(--bs-body-bg);
    --wiki-surface: var(--bs-tertiary-bg);
    --wiki-ink: var(--bs-body-color);
    --wiki-muted: var(--bs-secondary-color);
    --wiki-line: var(--bs-border-color);
    --wiki-accent: var(--bs-link-color);
    --wiki-heading: var(--bs-body-font-family);
    --wiki-mono: var(--bs-font-monospace);
    --wiki-radius: var(--bs-border-radius);
  }
  .mermaid-diagram svg { display: block; margin-inline: auto; max-width: 100%; height: auto }
  /* C4 draws boundaries and relationships in fixed dark grey, outside Mermaid's theme. */
  [data-bs-theme="dark"] .mermaid-c4 svg :is(text, tspan)[fill="#444444"], [data-bs-theme="dark"] .mermaid-c4 svg :is(text, tspan)[fill="black"],
  [data-bs-theme="dark"] .mermaid-c4 svg marker[id$="-arrowhead"] path, [data-bs-theme="dark"] .mermaid-c4 svg marker[id$="-arrowend"] path { fill: var(--bs-secondary-color) }
  [data-bs-theme="dark"] .mermaid-c4 svg [stroke="#444444"] { stroke: var(--bs-secondary-color) }
  /* Bootstrap's reboot floats and enlarges legends; the file map filters expect plain ones. */
  .file-map legend { float: none; width: auto; margin: 0; font-size: inherit; line-height: inherit }
`;

const runtimePath = 'assets/mermaid.min.js';
const runnerPath = 'assets/render-mermaid.js';
const licensePath = 'assets/mermaid.LICENSE';
const runner = `
(async () => {
  const mermaid = globalThis.mermaid;
  if (!mermaid) return;
  mermaid.initialize({
    // Mermaid 12 changed the default flowchart layout, look, and label width (to 120px, which
    // clips single-word labels such as export names); keep the established rendering.
    startOnLoad: false, securityLevel: 'strict',
    theme: document.documentElement.dataset.bsTheme === 'dark' ? 'dark' : 'default', layout: 'dagre', look: 'classic',
    flowchart: { wrappingWidth: 200 },
  });
  const diagrams = document.querySelectorAll('pre > code.language-mermaid');
  for (const [index, code] of diagrams.entries()) {
    const source = code.textContent;
    try {
      const diagram = await mermaid.parse(source, { suppressErrors: true });
      if (!diagram) continue;
      const { svg } = await mermaid.render('realdocs-diagram-' + index, source);
      const figure = document.createElement('figure');
      figure.className = 'mermaid-diagram border rounded p-3';
      if (diagram.diagramType === 'c4') figure.classList.add('mermaid-c4');
      figure.innerHTML = svg;
      code.parentElement.replaceWith(figure);
    } catch (error) {
      console.warn('Could not render a Mermaid diagram.', error);
    }
  }
})();
`.trimStart();

let runtime: string | undefined;
let license: string | undefined;

let bootstrap: Map<string, string> | undefined;

function bootstrapAssets(): Map<string, string> {
  const manifest = require.resolve('bootstrap/package.json');
  bootstrap ??= new Map([
    [bootstrapStyle, readFileSync(require.resolve('bootstrap/dist/css/bootstrap.min.css'), 'utf8')],
    [bootstrapScript, readFileSync(require.resolve('bootstrap/dist/js/bootstrap.bundle.min.js'), 'utf8')],
    ['assets/bootstrap.LICENSE', readFileSync(join(dirname(manifest), 'LICENSE'), 'utf8')],
  ]);
  return bootstrap;
}

function hasTags(documentation: Documentation): boolean {
  return (documentation.pages ?? []).some(page => page.tagLabels?.length) || documentation.modules.some(module =>
    module.overview?.tagLabels?.length || module.symbols.some(symbol => symbol.tagLabels?.length));
}

export function renderHtmlWiki(documentation: Documentation): { files: Map<string, string>; pages: number } {
  let needsMermaid = false;
  let graphAssets: ReturnType<typeof renderHtmlGraph>['assets'] | undefined;
  const tagged = hasTags(documentation);
  const files = renderWiki(documentation, 'html', page => {
    const { file, blocks, section } = page;
    let hasDiagram = false;
    const body = blocks.map(block => {
      if (typeof block !== 'string' && 'anchor' in block) return `<div id="${escape(block.anchor)}"></div>\n`;

      // An unfinished code fence in an authored block must not consume generated navigation.
      const environment = {};
      const text = typeof block === 'string' ? block : block.markdown;
      const tokens = markdown.parse(`${text}\n`, environment);
      if (typeof block !== 'string' && block.headings) {
        const headings = new Map(block.headings.map(heading => [heading.line, heading.id]));
        for (const token of tokens) {
          const id = token.type === 'heading_open' && token.map ? headings.get(token.map[0]) : undefined;
          if (id) token.attrSet('id', id);
        }
      }
      if (tokens.some(token => token.type === 'fence' && /^mermaid(?:\s|$)/.test(token.info.trim()))) hasDiagram = true;
      return markdown.renderer.render(tokens, markdown.options, environment);
    }).join('');
    if (hasDiagram) needsMermaid = true;
    const graph = documentation.fileGraph && (file === 'file-map.html' || section) ? renderHtmlGraph(documentation, file, section) : undefined;
    graphAssets ??= graph?.assets;
    const scripts = hasDiagram ? `
  <script defer src="${href(file, runtimePath)}"></script>
  <script defer src="${href(file, runnerPath)}"></script>` : '';
    const head = `
  <style>${style}</style>${scripts}${graph?.head ?? ''}`;
    return renderShell({ page, content: body + (graph?.body ?? ''), head, documentation, hasTags: tagged });
  });
  const pages = files.size;
  for (const [path, content] of bootstrapAssets()) files.set(path, content);
  for (const [path, content] of graphAssets ?? []) files.set(path, content);
  if (needsMermaid) {
    runtime ??= readFileSync(require.resolve('mermaid/dist/mermaid.min.js'), 'utf8');
    license ??= readFileSync(require.resolve('mermaid/LICENSE'), 'utf8');
    files.set(runtimePath, runtime);
    files.set(runnerPath, runner);
    files.set(licensePath, license);
  }
  return { files, pages };
}
