import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join, posix } from 'node:path';
import { codeSpan, href, wikiPath, type PageExtension } from './markdown.js';
import type { Documentation, DocumentationSection, FileRelation } from './model.js';

const relations: Record<FileRelation, string> = {
  import: 'Imports',
  're-export': 'Re-exports',
  'type-only': 'Uses types from',
  'doc-link': 'Links to',
  declared: 'Declares a dependency on',
};

function graphData(documentation: Documentation, extension: PageExtension, file: string, section?: DocumentationSection) {
  const graph = documentation.fileGraph!;
  const scope = section && new Set([...section.entries, ...section.pages]);
  if (scope) {
    const imports = new Map<string, string[]>();
    for (const { source, target } of graph.edges) {
      const targets = imports.get(source) ?? [];
      targets.push(target);
      imports.set(source, targets);
    }
    for (const path of scope) for (const target of imports.get(path) ?? []) scope.add(target);
  }
  const nodes = [
    ...graph.nodes,
    ...(documentation.pages ?? []).map(page => ({ path: page.name, zone: page.zone, kind: 'doc' as const, documented: true })),
  ].filter(node => !scope || scope.has(node.path)).sort((a, b) => compare(a.path, b.path)).map(node => ({
    path: node.path,
    label: posix.basename(node.path),
    zone: node.zone ?? (posix.dirname(node.path) === '.' ? 'Project root' : posix.dirname(node.path)),
    kind: node.kind,
    href: node.documented ? href(file, wikiPath(node.path, node.kind === 'code' ? 'modules' : 'pages', extension)) : undefined,
  }));
  const paths = new Set(nodes.map(node => node.path));
  const edges = new Map<string, typeof graph.edges[number]>();
  const relate = (source: string, target: string, kind: FileRelation): void => {
    if (source !== target && paths.has(source) && paths.has(target)) edges.set(JSON.stringify([source, target, kind]), { source, target, kind });
  };
  for (const { source, target, kind } of fileRelationships(documentation)) relate(source, target, kind);
  return { nodes, edges: [...edges.values()].sort((a, b) =>
    compare(a.source, b.source) || compare(a.target, b.target) || compare(a.kind, b.kind)), relations };
}

export function fileRelationships(documentation: Documentation) {
  const edges = [...(documentation.fileGraph?.edges ?? [])];
  const symbols = new Map(documentation.modules.flatMap(module => module.symbols.map(symbol => [symbol.id, symbol.location.file])));
  const ids = new Map(documentation.modules.flatMap(module => module.symbols.filter(symbol => symbol.docId)
    .map(symbol => [symbol.docId!, symbol.location.file])));
  for (const module of documentation.modules) {
    for (const target of module.overview?.linkedFiles ?? []) edges.push({ source: module.name, target, kind: 'doc-link' });
    for (const symbol of module.symbols) {
      for (const part of [...symbol.description, ...symbol.tags.flatMap(tag => tag.body)]) {
        if (part.link && 'symbol' in part.link) {
          const target = symbols.get(part.link.symbol);
          if (target) edges.push({ source: symbol.location.file, target, kind: 'doc-link' });
        }
      }
      for (const id of symbol.docUses ?? []) {
        const target = ids.get(id);
        if (target) edges.push({ source: symbol.location.file, target, kind: 'declared' });
      }
    }
  }
  for (const page of documentation.pages ?? []) {
    for (const target of page.linkedFiles ?? []) edges.push({ source: page.name, target, kind: 'doc-link' });
  }
  return edges;
}

function compare(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

export function renderMarkdownGraph(documentation: Documentation, file: string, section?: DocumentationSection): string {
  const data = graphData(documentation, 'md', file, section);
  const zones = new Map<string, number[]>();
  const indexes = new Map<string, number>();
  for (const [index, node] of data.nodes.entries()) {
    indexes.set(node.path, index);
    const zone = zones.get(node.zone) ?? [];
    zone.push(index);
    zones.set(node.zone, zone);
  }
  const label = (text: string): string => text.replace(/[^\p{L}\p{N}\p{M} _.\-/]/gu, char => `#${char.codePointAt(0)};`);
  const diagram = ['```mermaid', 'flowchart LR'];
  for (const [index, [zone, members]] of [...zones].entries()) {
    diagram.push(`  subgraph z${index}["${label(zone)}"]`);
    for (const member of members) diagram.push(`    f${member}["${label(data.nodes[member].label)}"]`);
    diagram.push('  end');
  }
  for (const { source, target, kind } of data.edges) diagram.push(`  f${indexes.get(source)} -->|${relations[kind]}| f${indexes.get(target)}`);
  diagram.push('```');

  const lines = ['## File map', '', ...diagram, '', '### Files by zone'];
  for (const [zone, members] of zones) {
    lines.push('', `#### ${codeSpan(zone)}`, '');
    for (const member of members) {
      const node = data.nodes[member];
      lines.push(`- ${node.href ? `[${codeSpan(node.path)}](${node.href})` : codeSpan(node.path)}`);
    }
  }
  return lines.join('\n');
}

const require = createRequire(import.meta.url);
let cytoscape: string | undefined;
let license: string | undefined;
let client: string | undefined;
let style: string | undefined;

export function renderHtmlGraph(documentation: Documentation, file: string, section?: DocumentationSection) {
  const data = graphData(documentation, 'html', file, section);
  const bundle = require.resolve('cytoscape/dist/cytoscape.min.js');
  cytoscape ??= readFileSync(bundle, 'utf8');
  license ??= readFileSync(join(dirname(bundle), '../LICENSE'), 'utf8');
  client ??= readFileSync(new URL('../assets/file-map.js', import.meta.url), 'utf8');
  style ??= readFileSync(new URL('../assets/file-map.css', import.meta.url), 'utf8');
  const assets = new Map([
    ['assets/cytoscape.min.js', cytoscape],
    ['assets/cytoscape.LICENSE', license],
    ['assets/file-map.js', client],
    ['assets/file-map.css', style],
  ]);
  const json = JSON.stringify(data).replaceAll('<', '\\u003c');
  const head = `
  <link rel="stylesheet" href="${href(file, 'assets/file-map.css')}">
  <script defer src="${href(file, 'assets/cytoscape.min.js')}"></script>
  <script defer src="${href(file, 'assets/file-map.js')}"></script>`;
  const body = `<section class="file-map" aria-labelledby="file-map-title">
  <header class="map-header">
    <h2 id="file-map-title">File map</h2>
    <p id="map-count" role="status"></p>
  </header>
  <div class="workspace">
    <aside class="sidebar" aria-label="File map filters">
      <label for="find-file">Find a file</label>
      <input id="find-file" type="search" placeholder="Search paths" autocomplete="off">
      <label for="zone-filter">Zone</label>
      <select id="zone-filter"><option value="">All zones</option></select>
      <fieldset id="relationship-filter"><legend>Relationships</legend></fieldset>
      <h3>Files</h3>
      <ul id="file-list" class="file-list" aria-label="Matching files"></ul>
    </aside>
    <section class="map-panel" aria-label="File relationships">
      <div class="map-tools" aria-label="Map controls">
        <button type="button" id="zoom-out" aria-label="Zoom out">−</button>
        <button type="button" id="zoom-in" aria-label="Zoom in">+</button>
        <button type="button" id="fit-map">Fit map</button>
      </div>
      <div id="map" aria-hidden="true"></div>
      <div id="map-empty" class="map-empty" hidden>No matching files.</div>
      <section class="selection" aria-label="File details">
        <div class="selection-header">
          <div><p id="selected-zone"></p><h3 id="selected-name">Select a file</h3></div>
          <a id="open-file" hidden>Open docs ↗</a>
        </div>
        <p id="selection-help">Select a node or a file from the list to inspect its relationships.</p>
        <div id="selection-actions" hidden>
          <button type="button" id="focus-neighbors" aria-pressed="false">Show neighbors only</button>
          <button type="button" id="clear-selection">Clear selection</button>
        </div>
        <ul id="neighbor-list" class="neighbor-list" aria-label="Related files"></ul>
      </section>
    </section>
  </div>
  <noscript>JavaScript is required for the interactive map.</noscript>
  <script type="application/json" id="file-map-data">${json}</script>
</section>
`;
  return { assets, head, body };
}
