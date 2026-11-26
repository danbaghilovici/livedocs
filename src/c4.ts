import MarkdownIt from 'markdown-it';
import { parseC4View } from './c4-views.js';
import { wikiPath, type PageExtension } from './markdown.js';
import type {
  C4Level, C4Model, C4ModelElement, C4PlacedView, C4View, Diagnostic, Documentation, MarkdownContent,
} from './model.js';

interface Placed {
  view: C4View;
  lines: string[];
  title: string;
  origin: string;
  href: string;
  line: number; // source line of the first body line
}

interface Declaration {
  alias: string;
  kind: string;
  label: string;
  technology?: string;
  description?: string;
  placed: Placed;
  line: number;
  boundary: boolean;
  inside?: string; // innermost enclosing boundary alias in its view
}

const markdown = new MarkdownIt({ html: true });
const marker = /@(?:realdocs|livedocs):c4\b/;

const isMarked = (documentation: Documentation): boolean =>
  [...documentation.pages ?? [], ...documentation.modules.flatMap(module => module.overview ?? [])]
    .some(content => marker.test(content.markdown));

function collectViews(documentation: Documentation, extension: PageExtension): Placed[] {
  const views: Placed[] = [];
  const scan = (content: MarkdownContent, origin: string, href: string, fallback: string): void => {
    let heading = '';
    const tokens = markdown.parse(content.markdown, {});
    for (const [index, token] of tokens.entries()) {
      if (token.type === 'heading_open') heading = tokens[index + 1]?.content ?? '';
      if (token.type !== 'fence' || token.level !== 0 || !token.map || !/^mermaid(?:\s|$)/.test(token.info.trim())) continue;
      const view = parseC4View(token.content);
      if (!view) continue;
      views.push({
        view, lines: token.content.split('\n'), title: view.title || heading || fallback, origin, href,
        line: (content.sourceLine ?? 1) + token.map[0] + 1,
      });
    }
  };
  for (const page of documentation.pages ?? []) scan(page, page.name, wikiPath(page.name, 'pages', extension), page.title);
  for (const module of documentation.modules) {
    if (module.overview) scan(module.overview, module.name, wikiPath(module.name, 'modules', extension), module.name);
  }
  return views;
}

function declarations(views: Placed[]): Declaration[] {
  return views.flatMap(placed => [
    ...placed.view.elements.map(element => ({ ...element, placed, boundary: false, inside: element.boundary })),
    ...placed.view.boundaries.map(boundary => ({ ...boundary, placed, boundary: true, inside: boundary.parent })),
  ].sort((a, b) => a.line - b.line));
}

const where = (declaration: Declaration): Diagnostic['location'] =>
  ({ file: declaration.placed.origin, line: declaration.placed.line + declaration.line, column: 1 });

// Nearest element boundary around a boundary alias in one view; grouping boundaries are transparent.
function enclosing(view: C4View, start: string | undefined, elementBoundaries: Set<string>): string | undefined {
  for (let alias = start; alias; alias = view.boundaries.find(b => b.alias === alias)?.parent) {
    if (elementBoundaries.has(alias)) return alias;
  }
  return undefined;
}

function deriveParents(all: Declaration[], elementBoundaries: Set<string>, diagnostics: Diagnostic[]): Map<string, string> {
  const parents = new Map<string, string>();
  for (const declaration of all) {
    const { view } = declaration.placed;
    const parent = enclosing(view, declaration.inside, elementBoundaries);
    if (!parent) continue;
    const known = parents.get(declaration.alias);
    if (!known) parents.set(declaration.alias, parent);
    else if (known !== parent) {
      diagnostics.push({ level: 'error', message: `C4 element ${declaration.alias} is declared inside both ${known} and ${parent}.`, location: where(declaration) });
    }
  }
  return parents;
}

function derivePaths(aliases: Iterable<string>, parents: Map<string, string>, diagnostics: Diagnostic[]): Map<string, string> {
  const paths = new Map<string, string>();
  const resolve = (alias: string, visiting: Set<string>): string => {
    const known = paths.get(alias);
    if (known !== undefined) return known;
    const parent = parents.get(alias);
    let path = alias;
    if (parent && visiting.has(parent)) {
      diagnostics.push({ level: 'error', message: `C4 element ${alias} is declared inside both ${parent} and ${alias}.` });
    } else if (parent) path = `${resolve(parent, new Set(visiting).add(alias))}.${alias}`;
    paths.set(alias, path);
    return path;
  };
  for (const alias of aliases) resolve(alias, new Set());
  return paths;
}

function relationshipLine(placed: Placed, from: string, to: string, fallback: string): string {
  const pattern = new RegExp(`^\\s*(?:Rel|BiRel)\\w*\\(\\s*${from}\\s*,\\s*${to}\\s*,`);
  return placed.lines.find(line => pattern.test(line))?.trim() ?? fallback;
}

// The union of the views of a level whose only element boundary is its own.
function mergeViews(key: string, views: Placed[], elementBoundaries: Set<string>): string | undefined {
  const onlyKey = ({ view }: Placed): boolean => {
    const owned = view.boundaries.filter(b => elementBoundaries.has(b.alias));
    return owned.length === 1 && owned[0].alias === key;
  };
  if (views.length < 2 || !views.every(onlyKey)) return undefined;
  const outside = new Map<string, string>();
  const inside = new Map<string, string>();
  const relationships = new Map<string, string>();
  for (const placed of views) {
    for (const element of placed.view.elements) {
      const target = element.boundary ? inside : outside;
      if (!target.has(element.alias)) target.set(element.alias, placed.lines[element.line].trim());
    }
    for (const { from, to, label, technology } of placed.view.relationships) {
      const fallback = `Rel(${from}, ${to}, "${label}"${technology ? `, "${technology}"` : ''})`;
      if (!relationships.has(`${from}>${to}`)) relationships.set(`${from}>${to}`, relationshipLine(placed, from, to, fallback));
    }
  }
  for (const alias of inside.keys()) outside.delete(alias);
  const [first] = views;
  const boundary = first.view.boundaries.find(b => b.alias === key)!;
  return [
    first.view.type, `title ${first.title.split(':')[0]} (all views merged)`, ...outside.values(),
    `${boundary.kind}(${key}, "${boundary.label}") {`, ...[...inside.values()].map(line => `  ${line}`), '}',
    ...relationships.values(), ...(first.view.layout ? [first.view.layout] : []),
  ].join('\n');
}

function warn(all: Declaration[], parents: Map<string, string>, hasContext: boolean, diagnostics: Diagnostic[]): void {
  const labels = new Map<string, Declaration>();
  const shared = new Map<string, Declaration>();
  const reported = new Set<string>();
  const once = (key: string, diagnostic: Diagnostic): void => {
    if (!reported.has(key)) diagnostics.push(diagnostic);
    reported.add(key);
  };
  for (const declaration of all) {
    const { alias, label, placed } = declaration;
    const first = labels.get(alias);
    if (!first) labels.set(alias, declaration);
    else if (first.label !== label) {
      once(`${alias}\0${label}\0${placed.origin}\0${declaration.line}`, {
        level: 'warning', location: where(declaration),
        message: `C4 element ${alias} is labeled "${label}" here and "${first.label}" in ${first.placed.origin}.`,
      });
    }
    const boundary = declaration.boundary ? undefined : declaration.inside;
    if (!boundary) continue;
    const key = `${placed.line}\0${boundary}\0${label}`;
    const other = shared.get(key);
    if (!other) shared.set(key, declaration);
    else if (other.alias !== alias) {
      once(`${key}\0${other.alias}\0${alias}`, {
        level: 'warning', location: where(declaration),
        message: `C4 elements ${other.alias} and ${alias} in ${boundary} share the label "${label}". Use one alias for one element.`,
      });
    }
  }
  if (!hasContext) return;
  const inContext = new Set(all.filter(d => !d.boundary && d.placed.view.type === 'C4Context').map(d => d.alias));
  for (const declaration of all) {
    if (declaration.boundary || parents.has(declaration.alias) || inContext.has(declaration.alias)) continue;
    once(`ctx\0${declaration.alias}`, {
      level: 'warning', location: where(declaration),
      message: `C4 element ${declaration.alias} is not shown in any C4Context view.`,
    });
  }
}

function buildModel(views: Placed[], publish: boolean, diagnostics: Diagnostic[]): C4Model {
  const all = declarations(views);
  const elementDeclarations = all.filter(d => !d.boundary);
  const aliases = [...new Set(elementDeclarations.map(d => d.alias))];
  const declared = new Set(aliases);
  const elementBoundaries = new Set(all.filter(d => d.boundary && declared.has(d.alias)).map(d => d.alias));
  const parents = deriveParents(all, elementBoundaries, diagnostics);
  const paths = derivePaths(aliases, parents, diagnostics);

  const contexts = views.filter(({ view }) => view.type === 'C4Context');
  const grouped = new Map<string, Placed[]>();
  if (contexts.length) grouped.set('', contexts);
  for (const placed of views) {
    for (const { alias } of placed.view.boundaries) {
      if (elementBoundaries.has(alias) && !grouped.get(alias)?.includes(placed)) grouped.set(alias, [...grouped.get(alias) ?? [], placed]);
    }
  }
  const root = contexts.length ? '' : [...grouped.keys()].find(key => !parents.has(key)) ?? '';

  const home = (alias: string): string => parents.get(alias) ??
    (contexts.some(({ view }) => view.elements.some(e => e.alias === alias)) ? '' :
      [...grouped].find(([, levelViews]) => levelViews.some(placed => placed.view.elements.some(e => e.alias === alias)))?.[0] ?? root);

  const elements: C4ModelElement[] = aliases.map(alias => {
    const own = elementDeclarations.filter(d => d.alias === alias);
    const homeKey = home(alias);
    const source = own.find(d => grouped.get(homeKey)?.includes(d.placed)) ?? own[0];
    const seen = new Set<Placed>();
    for (const declaration of all) if (declaration.alias === alias) seen.add(declaration.placed);
    return {
      alias, path: paths.get(alias)!, kind: source.kind, label: source.label, technology: source.technology, description: source.description,
      home: homeKey, hasLevel: grouped.has(alias), appearsIn: [...seen].map(({ title, origin }) => ({ title, origin })),
    };
  });

  const place = ({ view, title, origin, href }: Placed): C4PlacedView =>
    ({ title, type: view.type, origin, href, source: view.source, relationships: view.relationships });
  const levels: C4Level[] = [...grouped].map(([key, levelViews]) => {
    const merged = key ? mergeViews(key, levelViews, elementBoundaries) : undefined;
    return {
      key, path: key ? paths.get(key)! : '', label: key ? elements.find(e => e.alias === key)!.label : 'Context',
      type: levelViews[0].view.type, views: levelViews.map(place), ...merged === undefined ? {} : { merged },
    };
  });
  warn(all, parents, contexts.length > 0, diagnostics);
  return { publish, root, levels, elements, items: [] };
}

export function compileC4(documentation: Documentation, extension: PageExtension, enabled: boolean): Documentation {
  if (!enabled && !isMarked(documentation)) return documentation;
  const views = collectViews(documentation, extension);
  const diagnostics: Diagnostic[] = [];
  if (enabled && !views.length) {
    diagnostics.push({ level: 'error', message: '--c4 found no C4Context, C4Container, or C4Component diagrams in the wiki inputs. Add one to a selected guide or @realdocs:file overview.' });
  }
  const c4 = buildModel(views, enabled, diagnostics);
  return { ...documentation, diagnostics: [...documentation.diagnostics, ...diagnostics], c4 };
}
