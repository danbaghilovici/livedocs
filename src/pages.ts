import { readFileSync } from 'node:fs';
import { posix } from 'node:path';
import MarkdownIt from 'markdown-it';
import { parse, postprocess, preprocess } from 'micromark';
import { anchorFor, encodeHrefComponent, href, symbolAnchor, wikiPath, type PageExtension } from './markdown.js';
import { normalizeTagLabels, type AuthoredPage, type Diagnostic, type Documentation, type MarkdownContent } from './model.js';
import { projectPath, type Project } from './project.js';

const markdown = {
  md: new MarkdownIt({ html: true }),
  html: new MarkdownIt(),
};
const documentationFile = /\.(?:md|[jt]sx?|[cm][jt]s)$/i;

interface Destination {
  output: string;
  headings: ReadonlySet<string>;
  symbols?: ReadonlyMap<string, string>;
}

function readPageAnnotations(text: string): MarkdownContent {
  const lines = text.split('\n');
  const tags: string[] = [];
  let zone: string | undefined;
  let annotated = false;
  let firstLine = 0;
  for (; firstLine < lines.length; firstLine++) {
    const line = lines[firstLine].trim();
    if (!line) continue;
    const annotation = /^<!--\s*@(?:realdocs|livedocs):(tag|zone)(?:[ \t]+(.*?))?\s*-->$/.exec(line);
    if (!annotation) break;
    annotated = true;
    if (annotation[1] === 'tag') tags.push(annotation[2] ?? '');
    else zone ??= annotation[2]?.trim() || undefined;
  }
  if (!annotated) return { markdown: text };
  return { markdown: lines.slice(firstLine).join('\n'), sourceLine: firstLine + 1, tagLabels: normalizeTagLabels(tags), zone };
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
    const slug = text.normalize('NFC').toLowerCase().replace(/[^\p{L}\p{N}\p{M}_\s-]/gu, '').trim().replace(/\s+/gu, '-') || 'section';
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
  const destination = registry.get(target);
  if (!destination) {
    if (documentationFile.test(target)) warn(`Documentation link ${value} points to an input that is not included. Add it with --page or --entry.`);
    return;
  }

  let id: string | undefined;
  if (fragment) {
    const heading = destination.headings.has(fragment) ? fragment : undefined;
    const symbol = destination.symbols?.get(fragment);
    id = path ? symbol ?? heading : heading ?? symbol;
    if (!id) {
      warn(`Documentation link ${value} has no matching heading or symbol in ${target}.`);
      return;
    }
  }
  const from = registry.get(origin)!.output;
  linked?.(target);
  const url = path ? href(from, destination.output) || encodeHrefComponent(posix.basename(from)) : '';
  const escapedQuery = query.replaceAll('&', '&amp;').replace(/[<>()[\]\\\s]/g, encodeHrefComponent);
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
    const url = resolveLink(raw, origin, registry, message => {
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
  const diagnostics = [...documentation.diagnostics];
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
    registry.set(module.name, {
      output: wikiPath(module.name, 'modules', extension),
      headings: new Set(overview?.headings.map(heading => heading.id)),
      symbols,
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
    outputPaths.add(output);
    registry.set(name, { output, headings: new Set(page.headings.map(heading => heading.id)) });
    pages.push({ ...page, name, title: page.title || posix.basename(name) });
  }

  return {
    ...documentation,
    diagnostics,
    modules: modules.map(module => ({
      ...module,
      overview: module.overview && rebaseLinks(module.overview, module.name, registry, diagnostics, extension, !!documentation.fileGraph),
    })),
    pages: pages.map(page => rebaseLinks(page, page.name, registry, diagnostics, extension, !!documentation.fileGraph)),
  };
}
