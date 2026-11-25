import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import MarkdownIt from 'markdown-it';
import { renderHtmlGraph } from './graph.js';
import { href, renderWiki } from './markdown.js';
import type { Documentation } from './model.js';

const require = createRequire(import.meta.url);
const markdown = new MarkdownIt();
const escape = markdown.utils.escapeHtml;

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
  body { font: 1rem/1.65 system-ui, sans-serif; margin: 0; background: var(--wiki-page); color: var(--wiki-ink) }
  main { max-width: 84ch; margin-inline: auto; padding: clamp(1.25rem, 4vw, 3rem); overflow-wrap: anywhere }
  h1, h2 { font-family: var(--wiki-heading); font-weight: 400; letter-spacing: -.025em; line-height: 1.15 }
  h1 { font-size: clamp(2.15rem, 5vw, 3.5rem); margin-block: 0 .8rem }
  h2 { font-size: clamp(1.55rem, 3vw, 2.1rem); margin-block: 2rem .65rem }
  h3 { line-height: 1.3 }
  a { color: var(--wiki-accent); text-underline-offset: .2em }
  :focus-visible { outline: 2px solid var(--wiki-accent); outline-offset: 3px }
  code { font: .86em/1.55 var(--wiki-mono) }
  pre { overflow: auto; padding: 1rem; border: 1px solid var(--wiki-line); border-radius: var(--wiki-radius); background: var(--wiki-surface) }
  blockquote { margin-inline: 0; padding-inline-start: 1rem; border-inline-start: 2px solid var(--wiki-line); color: var(--wiki-muted) }
  img { max-width: 100%; height: auto }
  table { display: block; overflow-x: auto; border-collapse: collapse }
  th, td { padding: .5rem .75rem; border: 1px solid var(--wiki-line); text-align: start }
  th { background: var(--wiki-surface) }
  .mermaid-diagram { margin-inline: 0; padding: 1rem; overflow: auto; background: var(--wiki-surface); color: var(--wiki-ink); border: 1px solid var(--wiki-line); border-radius: var(--wiki-radius) }
  .mermaid-diagram svg { display: block; margin-inline: auto; max-width: 100%; height: auto }
  /* C4 uses fixed relationship and boundary colors outside Mermaid's theme. */
  .mermaid-c4 svg :is(text, tspan)[fill="#444444"], .mermaid-c4 svg :is(text, tspan)[fill="black"],
  .mermaid-c4 svg marker[id$="-arrowhead"] path, .mermaid-c4 svg marker[id$="-arrowend"] path { fill: var(--wiki-muted) }
  .mermaid-c4 svg [stroke="#444444"] { stroke: var(--wiki-muted) }
  .wiki-index { max-width: 86rem }
  .wiki-directory > :is(h2, ul) { margin-block: 0 }
  .wiki-directory > h2 { margin-block: 1.5rem .45rem }
  .wiki-directory > ul { display: grid; grid-template-columns: repeat(auto-fit, minmax(min(18rem, 100%), 1fr)); column-gap: 1rem; padding: 0; list-style: none }
  .wiki-directory > ul > li { border-block-start: 1px solid var(--wiki-line); min-width: 0 }
  .wiki-directory > ul > li > a { display: block; padding: .38rem .6rem .38rem 0; text-decoration: none }
  .wiki-directory > ul > li > a:hover { text-decoration: underline }
  .wiki-directory > p { margin-block: .65rem 0 }
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
    startOnLoad: false, securityLevel: 'strict', theme: 'base',
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

function htmlPage(file: string, title: string, body: string, hasDiagram: boolean, graph?: ReturnType<typeof renderHtmlGraph>): string {
  const scripts = hasDiagram ? `
  <script defer src="${href(file, runtimePath)}"></script>
  <script defer src="${href(file, runnerPath)}"></script>` : '';
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>${escape(title)}</title>
  <style>${style}</style>${scripts}${graph?.head ?? ''}
</head>
<body>
<main${file === 'index.html' ? ' class="wiki-index"' : ''}>
${file === 'index.html' ? `<div class="wiki-directory">\n${body}</div>\n${graph?.body ?? ''}` : body}</main>
</body>
</html>
`;
}

export function renderHtmlWiki(documentation: Documentation): { files: Map<string, string>; pages: number } {
  let needsMermaid = false;
  const graph = documentation.fileGraph ? renderHtmlGraph(documentation) : undefined;
  const files = renderWiki(documentation, 'html', (file, title, blocks) => {
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
    return htmlPage(file, title, body, hasDiagram, file === 'index.html' ? graph : undefined);
  });
  const pages = files.size;
  for (const [path, content] of graph?.assets ?? []) files.set(path, content);
  if (needsMermaid) {
    runtime ??= readFileSync(require.resolve('mermaid/dist/mermaid.min.js'), 'utf8');
    license ??= readFileSync(require.resolve('mermaid/LICENSE'), 'utf8');
    files.set(runtimePath, runtime);
    files.set(runnerPath, runner);
    files.set(licensePath, license);
  }
  return { files, pages };
}
