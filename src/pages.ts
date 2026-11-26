import { existsSync, readFileSync } from 'node:fs';
import { posix, resolve } from 'node:path';
import MarkdownIt from 'markdown-it';
import { parse, postprocess, preprocess } from 'micromark';
import { anchorFor, encodeHrefComponent, explicitAnchor, href, pageFile, symbolAnchor, wikiPath, type PageExtension } from './markdown.js';
import { placeDocumentation } from './navigation.js';
import { normalizeTagLabels, placementError, type AuthoredPage, type Diagnostic, type Documentation, type MarkdownContent } from './model.js';
import { projectPath, type Project } from './project.js';

const markdown = {
  md: new MarkdownIt({ html: true }),
  html: new MarkdownIt(),
};
const documentationFile = /\.(?:md|[jt]sx?|[cm][jt]s)$/i;
// GitHub line fragments: #L12, #L12-L20, #L12C3-L20C8.
const lineFragment = /^L(\d+)(?:C\d+)?(?:-L?\d+(?:C\d+)?)?$/;

interface Destination {
  output: string;
  headings: ReadonlySet<string>;
  symbols?: ReadonlyMap<string, string>;
  /** Anchors by the source line they start at, in ascending order, for GitHub line fragments. */
  lines: readonly { line: number; id: string }[];
}

interface LinkSite {
  directory: string;
  /** The source browser URL of a project file or folder outside the wiki, when one is known. */
  source: (path: string) => string | undefined;
}

/** Anchors written as an empty `<a id>` or `<a name>` element in raw HTML, outside code. */
function explicitAnchors(text: string): string[] {
  const anchors: string[] = [];
  const pattern = new RegExp(explicitAnchor.source, 'gi');
  for (const token of markdown.md.parse(text, {})) {
    // Inline HTML arrives one tag per token: rejoin adjacent tags, and keep anything else between them.
    const html = token.type === 'html_block' ? token.content
      : token.children?.map(child => child.type === 'html_inline' ? child.content : '\0').join('') ?? '';
    for (const match of html.matchAll(pattern)) anchors.push(match[1] ?? match[2]);
  }
  return anchors;
}

function lineTargets(content: MarkdownContent | undefined, symbols: readonly { line: number; id: string }[] = []) {
  const start = content?.sourceLine ?? 1;
  const headings = content?.headings?.map(heading => ({ line: start + heading.line, id: heading.id })) ?? [];
  return [...headings, ...symbols].sort((a, b) => a.line - b.line);
}

function encodePath(path: string): string {
  return path.split('/').map(encodeURIComponent).join('/');
}

function readPageAnnotations(text: string): MarkdownContent {
  const lines = text.split('\n');
  const tags: string[] = [];
  const placement: { category?: string; path?: string } = {};
  const annotationErrors: { message: string; line: number }[] = [];
  let zone: string | undefined;
  let annotated = false;
  let firstLine = 0;
  for (; firstLine < lines.length; firstLine++) {
    const line = lines[firstLine].trim();
    if (!line) continue;
    const annotation = /^<!--\s*@(?:realdocs|livedocs):(tag|zone|category|path)(?:[ \t]+(.*?))?\s*-->$/.exec(line);
    if (!annotation) break;
    annotated = true;
    const [, name, value = ''] = annotation;
    if (name === 'tag') tags.push(value);
    else if (name === 'zone') zone ??= value.trim() || undefined;
    else {
      const key = name as 'category' | 'path';
      const error = placementError(key, value, placement[key] !== undefined);
      if (error) annotationErrors.push({ message: error, line: firstLine + 1 });
      else placement[key] = value.trim();
    }
  }
  if (!annotated) return { markdown: text };
  return {
    markdown: lines.slice(firstLine).join('\n'), sourceLine: firstLine + 1, tagLabels: normalizeTagLabels(tags), zone,
    ...placement, ...(annotationErrors.length && { annotationErrors }),
  };
}

function headingsIn(content: MarkdownContent, extension: PageExtension, taken = new Set<string>()) {
  const tokens = markdown[extension].parse(`${content.markdown}\n`, {});
  const headings: NonNullable<MarkdownContent['headings']> = [];
  let title: string | undefined;
  for (const [index, token] of tokens.entries()) {
    if (token.type !== 'heading_open' || !token.map) continue;
    const text = tokens[index + 1].children?.map(part =>
      part.type === 'softbreak' || part.type === 'hardbreak' ? ' ' : part.content).join('').trim() ?? '';
    if (token.level === 0) title ||= text;
    // Match GitHub: drop punctuation, then turn every space into a hyphen, so `A — B` is `a--b`.
    const slug = text.normalize('NFC').toLowerCase().replace(/[^\p{L}\p{N}\p{M}_\s-]/gu, '').trim().replace(/\s/gu, '-') || 'section';
    let id = slug;
    for (let suffix = 1; taken.has(id); suffix++) id = `${slug}-${suffix}`;
    taken.add(id);
    headings.push({ line: token.map[0], id, nested: token.level > 0 });
  }
  return { ...content, title, headings };
}

function resolveLink(
  raw: string,
  origin: string,
  registry: ReadonlyMap<string, Destination>,
  site: LinkSite,
  warn: (message: string) => void,
  linked?: (path: string) => void,
): string | undefined {
  const value = markdown.md.utils.unescapeAll(raw);
  if (value.startsWith('/') || /^[a-z][a-z\d+.-]*:/i.test(value)) return;
  const parts = /^([^?#]*)(\?[^#]*)?(?:#(.*))?$/.exec(value);
  if (!parts) return;

  const [, path, query = '', hash] = parts;
  if (!path && !hash) return;
  let target: string;
  let fragment: string | undefined;
  try {
    target = path ? posix.join(posix.dirname(origin), decodeURIComponent(path)) : origin;
    fragment = hash ? decodeURIComponent(hash) : undefined;
  } catch {
    warn(`Invalid encoding in documentation link ${value}.`);
    return;
  }
  const escapedQuery = query.replaceAll('&', '&amp;').replace(/[<>()[\]\\\s]/g, encodeHrefComponent);
  const destination = registry.get(target);
  if (!destination) {
    const inside = target !== '..' && !target.startsWith('../');
    if (!inside || !existsSync(resolve(site.directory, target))) {
      if (documentationFile.test(target)) warn(`Documentation link ${value} points to ${target}, which does not exist.`);
      return;
    }
    if (documentationFile.test(target)) linked?.(target);
    const source = site.source(target);
    if (source) return `${source}${escapedQuery}${hash === undefined ? '' : `#${hash.replace(/[<>()[\]\\\s]/g, encodeHrefComponent)}`}`;
    if (documentationFile.test(target)) {
      warn(`Documentation link ${value} points to an input that is not included. Add it with --page or --entry, or set sourceUrl in realdocs.json to link to its source.`);
    }
    return;
  }
  linked?.(target);

  let id: string | undefined;
  if (fragment) {
    const heading = destination.headings.has(fragment) ? fragment : undefined;
    const symbol = destination.symbols?.get(fragment);
    id = path ? symbol ?? heading : heading ?? symbol;
    const line = id ? undefined : lineFragment.exec(fragment)?.[1];
    // A line fragment lands on the nearest heading or symbol at or above that line, or the top.
    if (line) id = [...destination.lines].reverse().find(item => item.line <= Number(line))?.id;
    else if (!id) {
      warn(`Documentation link ${value} has no matching heading or symbol in ${target}.`);
      return;
    }
  }
  const from = registry.get(origin)!.output;
  const url = path ? href(from, destination.output) || encodeHrefComponent(posix.basename(from)) : '';
  return `${url}${escapedQuery}${id ? `#${encodeURIComponent(id)}` : ''}`;
}

function linkedUrls(text: string, parser: typeof markdown.md): Set<string> {
  const links = new Set<string>();
  for (const token of parser.parse(text, {})) {
    for (const child of token.children ?? []) {
      if (child.type !== 'link_open') continue;
      const url = child.attrGet('href');
      if (typeof url === 'string') links.add(url);
    }
  }
  return links;
}

function rebaseLinks<T extends MarkdownContent>(
  content: T,
  origin: string,
  registry: ReadonlyMap<string, Destination>,
  site: LinkSite,
  diagnostics: Diagnostic[],
  extension: PageExtension,
  withGraph: boolean,
): T {
  const text = content.markdown;
  const parser = markdown[extension];
  // HTML output escapes raw tags, so the links between them are still Markdown.
  const extensions = extension === 'html' ? [{ disable: { null: ['htmlFlow', 'htmlText'] } }] : [];
  const events = postprocess(parse({ extensions }).document().write(preprocess()(text, undefined, true)));
  const pieces: string[] = [];
  const linked = new Set<string>();
  let links: Set<string> | undefined;
  let cursor = 0;
  let images = 0;
  for (const [kind, token] of events) {
    if (token.type === 'image') images += kind === 'enter' ? 1 : -1;
    if (kind !== 'enter' || images || (token.type !== 'resourceDestinationString' && token.type !== 'definitionDestinationString')) continue;
    const { start, end } = token;
    const raw = text.slice(start.offset, end.offset);
    if (token.type === 'definitionDestinationString') {
      links ??= linkedUrls(text, parser);
      if (!links.has(parser.normalizeLink(parser.utils.unescapeAll(raw)))) continue;
    }
    const url = resolveLink(raw, origin, registry, site, message => {
      diagnostics.push({
        level: 'warning', message,
        location: { file: origin, line: (content.sourceLine ?? 1) + start.line - 1, column: start.column },
      });
    }, withGraph ? path => linked.add(path) : undefined);
    if (url === undefined) continue;
    pieces.push(text.slice(cursor, start.offset), url);
    cursor = end.offset;
  }
  return { ...content, markdown: pieces.join('') + text.slice(cursor), linkedFiles: linked.size ? [...linked] : undefined };
}

export function includePages(documentation: Documentation, project: Project, extension: PageExtension): Documentation {
  let diagnostics = [...documentation.diagnostics];
  const registry = new Map<string, Destination>();
  const modules = documentation.modules.map(module => {
    const symbols = new Map<string, string>();
    for (const symbol of module.symbols) {
      const id = symbolAnchor(symbol);
      symbols.set(id, id);
      symbols.set(anchorFor(symbol.name), id);
    }
    for (const symbol of module.symbols) symbols.set(symbol.name, symbolAnchor(symbol));
    const overview = module.overview && headingsIn(module.overview, extension, new Set(symbols.values()));
    const declared = module.symbols.filter(symbol => symbol.location.file === module.name)
      .map(symbol => ({ line: symbol.location.line, id: symbolAnchor(symbol) }));
    registry.set(module.name, {
      output: '', // Set once every input is placed.
      headings: new Set([...overview?.headings.map(heading => heading.id) ?? [], ...explicitAnchors(overview?.markdown ?? '')]),
      symbols,
      lines: lineTargets(overview, declared),
    });
    return { ...module, overview };
  });

  const pages: AuthoredPage[] = [];
  const outputPaths = new Set<string>();
  for (const file of project.pages) {
    const name = projectPath(project.directory, file);
    const output = wikiPath(name, 'pages', extension);
    if (outputPaths.has(output)) {
      diagnostics.push({ level: 'error', message: `Markdown page ${name} conflicts with another input at ${output}.` });
      continue;
    }
    let text: string;
    try {
      text = readFileSync(file, 'utf8').replace(/^\uFEFF/, '').replace(/\r\n?/g, '\n');
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error);
      diagnostics.push({ level: 'error', message: `Could not read Markdown page ${name}. ${reason}` });
      continue;
    }
    const page = headingsIn(readPageAnnotations(text), extension);
    for (const { message, line } of page.annotationErrors ?? []) {
      diagnostics.push({ level: 'error', message, location: { file: name, line, column: 1 } });
    }
    outputPaths.add(output);
    registry.set(name, {
      output: '',
      headings: new Set([...page.headings.map(heading => heading.id), ...explicitAnchors(page.markdown)]),
      lines: lineTargets(page),
    });
    pages.push({ ...page, name, title: page.title || posix.basename(name) });
  }

  const placed = placeDocumentation({ ...documentation, diagnostics, modules, pages }, extension);
  diagnostics = [...placed.diagnostics];
  const moduleNames = new Set(modules.map(module => module.name));
  for (const [name, destination] of registry) {
    destination.output = pageFile(placed, name, moduleNames.has(name) ? 'modules' : 'pages', extension);
  }

  const { release } = documentation;
  const site: LinkSite = {
    directory: project.directory,
    source: path => {
      // A versioned wiki links tracked files at its own commit, like its symbol source links.
      const file = release && projectPath(release.root, resolve(project.directory, path));
      if (release?.repository && file && release.tracked.has(file)) return `${release.repository}/blob/${release.commit}/${encodePath(file)}`;
      return project.sourceUrl && `${project.sourceUrl}/${encodePath(path)}`;
    },
  };
  return {
    ...placed,
    diagnostics,
    modules: modules.map(module => ({
      ...module,
      overview: module.overview && rebaseLinks(module.overview, module.name, registry, site, diagnostics, extension, !!documentation.fileGraph),
    })),
    pages: pages.map(page => rebaseLinks(page, page.name, registry, site, diagnostics, extension, !!documentation.fileGraph)),
  };
}
