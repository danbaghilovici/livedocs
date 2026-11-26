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

const style = `
  :root {
    color-scheme: dark;
    --wiki-page: #101614;
    --wiki-surface: #1a2521;
    --wiki-ink: #e8efe9;
    --wiki-muted: #b0c0b7;
    --wiki-line: #3b5046;
    --wiki-accent: #a6dfc3;
    --wiki-heading: Georgia, 'Times New Roman', serif;
    --wiki-mono: ui-monospace, 'Cascadia Code', monospace;
    --wiki-radius: .45rem;
  }
  *, *::before, *::after { box-sizing: border-box }
  body { background: var(--wiki-page); color: var(--wiki-ink) }
  .wiki-content :is(h1, h2) { font-family: var(--wiki-heading); font-weight: 400; letter-spacing: -.025em; line-height: 1.15 }
  .wiki-content h1 { font-size: clamp(2.15rem, 5vw, 3.5rem); margin-block: 0 .8rem }
  .wiki-content h2 { font-size: clamp(1.55rem, 3vw, 2.1rem); margin-block: 2rem .65rem }
  .wiki-content h3 { line-height: 1.3; margin-block-start: 1.5rem }
  .wiki-content a { color: var(--wiki-accent); text-underline-offset: .2em }
  :focus-visible { outline: 2px solid var(--wiki-accent); outline-offset: 3px }
  .wiki-content code { font: .86em/1.55 var(--wiki-mono) }
  .wiki-content pre { overflow: auto; padding: 1rem; border: 1px solid var(--wiki-line); border-radius: var(--wiki-radius); background: var(--wiki-surface) }
  .wiki-content blockquote { margin-inline: 0; padding-inline-start: 1rem; border-inline-start: 2px solid var(--wiki-line); color: var(--wiki-muted) }
  .wiki-content img { max-width: 100%; height: auto }
  .wiki-content table { display: block; overflow-x: auto; border-collapse: collapse }
  .wiki-content th, .wiki-content td { padding: .5rem .75rem; border: 1px solid var(--wiki-line); text-align: start }
  .wiki-content th { background: var(--wiki-surface) }
  .mermaid-diagram { margin-inline: 0; padding: 1rem; overflow: auto; background: var(--wiki-surface); color: var(--wiki-ink); border: 1px solid var(--wiki-line); border-radius: var(--wiki-radius) }
  .mermaid-diagram svg { display: block; margin-inline: auto; max-width: 100%; height: auto }
  /* C4 uses fixed relationship and boundary colors outside Mermaid's theme. */
  .mermaid-c4 svg :is(text, tspan)[fill="#444444"], .mermaid-c4 svg :is(text, tspan)[fill="black"],
  .mermaid-c4 svg marker[id$="-arrowhead"] path, .mermaid-c4 svg marker[id$="-arrowend"] path { fill: var(--wiki-muted) }
  .mermaid-c4 svg [stroke="#444444"] { stroke: var(--wiki-muted) }
`;

const runtimePath = 'assets/mermaid.min.js';
const runnerPath = 'assets/render-mermaid.js';
const licensePath = 'assets/mermaid.LICENSE';
const runner = `
(async () => {
  const mermaid = globalThis.mermaid;
  if (!mermaid) return;
  const style = getComputedStyle(document.documentElement);
  const color = name => style.getPropertyValue('--wiki-' + name).trim();
  mermaid.initialize({
    // Mermaid 12 changed the default flowchart layout, look, and label width (to 120px, which
    // clips single-word labels such as export names); keep the established rendering.
    startOnLoad: false, securityLevel: 'strict', theme: 'base', layout: 'dagre', look: 'classic',
    flowchart: { wrappingWidth: 200 },
    themeVariables: {
      darkMode: true, background: color('surface'), primaryColor: '#284137',
      primaryTextColor: color('ink'), primaryBorderColor: '#698d7e',
      lineColor: color('muted'), textColor: color('ink'),
      secondaryColor: '#2c3a4c', tertiaryColor: color('surface'),
      edgeLabelBackground: color('surface'), fontFamily: 'system-ui, sans-serif',
    },
    c4: {
      person_bg_color: '#285b4a', person_border_color: '#619b86',
      system_bg_color: '#315a72', system_border_color: '#7099af',
      container_bg_color: '#315a72', container_border_color: '#7099af',
      component_bg_color: '#2e5144', component_border_color: '#619b86',
    },
  });
  const diagrams = document.querySelectorAll('pre > code.language-mermaid');
  for (const [index, code] of diagrams.entries()) {
    const source = code.textContent;
    try {
      const diagram = await mermaid.parse(source, { suppressErrors: true });
      if (!diagram) continue;
      const { svg } = await mermaid.render('realdocs-diagram-' + index, source);
      const figure = document.createElement('figure');
      figure.className = 'mermaid-diagram';
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
