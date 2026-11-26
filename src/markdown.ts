import { posix, resolve } from 'node:path';
import type {
  DocPart, DocTag, Documentation, DocumentationSection, DocumentedSymbol, MarkdownContent, NavGroup, NavItem, SiteMap,
} from './model.js';
import { projectPath } from './project.js';

interface Address {
  file: string;
  anchor: string;
}

export type PageBlock = string | { anchor: string } | MarkdownContent;
export type PageExtension = 'md' | 'html';

export interface Crumb {
  label: string;
  file: string;
}

export interface PageContext {
  file: string;
  title: string;
  blocks: readonly PageBlock[];
  /** Ancestors from Home down, excluding the page itself; empty on the home page. */
  crumbs: readonly Crumb[];
  section?: DocumentationSection;
}

export type PageRenderer = (page: PageContext) => string;

/** The ancestors of a page or group page in the navigation tree, starting at Home. */
export function crumbsFor(site: SiteMap, file: string): Crumb[] {
  if (file === site.home) return [];
  const search = (nodes: readonly NavItem[], trail: Crumb[]): Crumb[] | undefined => {
    for (const node of nodes) {
      if (node.kind === 'page') {
        if (node.file === file) return trail;
        continue;
      }
      if (node.file === file) return trail;
      const found = search(node.children, [...trail, { label: node.label, file: node.file }]);
      if (found) return found;
    }
  };
  const home = { label: 'Home', file: site.home };
  return search(site.tree, [home]) ?? [home];
}

/** A Markdown breadcrumb line, such as `[Home](../index.md) › [Decisions](index.md)`. */
export function crumbLine(crumbs: readonly Crumb[], file: string): string {
  return crumbs.map(crumb => `[${escapeText(crumb.label)}](${href(file, crumb.file) || encodeHrefComponent(posix.basename(crumb.file))})`).join(' › ');
}

/**
 * An anchor authored as an empty `<a id="…"></a>` or `<a name="…"></a>` element, the form GitHub
 * renders. Markdown output keeps it as raw HTML and HTML output renders it as an anchor, so links to
 * it resolve in both formats. The value is the first or second capture group.
 */
export const explicitAnchor = /<a\s+(?:id|name)\s*=\s*(?:"([^"<>]+)"|'([^'<>]+)')\s*><\/a>/;

function anchorTag(id: string): string {
  return `<a id="${id}"></a>`;
}

const markdownPage: PageRenderer = ({ file, blocks, crumbs }) => [crumbs.length ? crumbLine(crumbs, file) : '', ...blocks].filter(Boolean).map(block => {
  if (typeof block === 'string') return block;
  if ('anchor' in block) return anchorTag(block.anchor);
  const headings = new Map(block.headings?.map(heading => [heading.line, heading]));
  if (!headings.size) return block.markdown;
  return block.markdown.split('\n').map((line, index) => {
    const heading = headings.get(index);
    if (!heading) return line;
    const anchor = anchorTag(heading.id);
    if (!heading.nested) return `${anchor}\n\n${line}`;

    // Keep the anchor within the heading so a list item or blockquote stays intact.
    const text = line.trimEnd();
    const opening = text.search(/#{1,6}(?:[ \t]|$)/);
    const closing = /[ \t]+#+$/.exec(text);
    const end = closing && closing.index > opening ? closing.index : text.length;
    return `${line.slice(0, end)} ${anchor}${line.slice(end)}`;
  }).join('\n');
}).join('\n\n') + '\n';

function anchorPart(name: string): string {
  return name.replace(/[^a-zA-Z0-9-]/gu, char => `_${char.codePointAt(0)!.toString(16)}_`);
}

export function anchorFor(name: string): string {
  return `symbol-${anchorPart(name)}`;
}

export function symbolAnchor(symbol: DocumentedSymbol): string {
  return symbol.docId ? `doc-${symbol.docId}` : anchorFor(symbol.name);
}

function tagAnchor(name: string): string {
  return `tag-${anchorPart(name)}`;
}

function backticks(value: string, minimum: number): string {
  const runs = value.match(/`+/g) ?? [];
  return '`'.repeat(Math.max(minimum, ...runs.map(run => run.length + 1)));
}

export function codeSpan(value: string): string {
  const fence = backticks(value, 1);
  const padded = /^(?:`| )|(?:`| )$/.test(value) ? ` ${value} ` : value;
  return `${fence}${padded}${fence}`;
}

function codeBlock(value: string, language: string): string {
  const fence = backticks(value, 3);
  return `${fence}${language}\n${value}\n${fence}`;
}

function escapeText(value: string): string {
  return value.replace(/[\\`*_\[\]<>]/g, '\\$&');
}

export function encodeHrefComponent(value: string): string {
  return encodeURIComponent(value).replaceAll('(', '%28').replaceAll(')', '%29');
}

export function href(from: string, destination: string): string {
  if (from === destination) return '';
  return posix.relative(posix.dirname(from), destination).split('/').map(encodeHrefComponent).join('/');
}

// A link from the wiki root to an output path, encoded the way the wiki's own links are.
export function wikiLink(path: string, fragment?: string): string {
  const encoded = path.split('/').map(encodeHrefComponent).join('/');
  return fragment === undefined ? encoded : `${encoded}#${fragment.replace(/[<>()[\]\\\s]/g, encodeHrefComponent)}`;
}

export function wikiPath(name: string, directory: 'modules' | 'pages', extension: PageExtension): string {
  const segments = name.split('/');
  const sourceName = segments.pop()!;
  const pageName = directory === 'pages' ? sourceName.replace(/\.md$/i, '') : sourceName;
  const pageSuffix = extension === 'html' ? /\.html$/i : /\.md$/i;
  // Keep the output suffix exclusive to page files.
  const folders = segments.map(segment =>
    segment.replaceAll('%', '%25').replace(pageSuffix, suffix => `%2E${suffix.slice(1)}`));
  return [directory, ...folders, `${pageName}.${extension}`].join('/');
}

/** The output file of a page or entry: its placed route, or the path that mirrors its source. */
export function pageFile(documentation: Documentation, name: string, kind: 'modules' | 'pages', extension: PageExtension): string {
  return documentation.site?.routes[name]?.file ?? wikiPath(name, kind, extension);
}

function docText(parts: DocPart[], file: string, addresses: ReadonlyMap<string, Address>): string {
  return parts.map(part => {
    if (!part.link) return part.code ? codeSpan(part.text) : part.text;
    const label = part.code ? codeSpan(part.text) : escapeText(part.text);
    if ('url' in part.link) return `[${label}](<${part.link.url.replaceAll('<', '%3C').replaceAll('>', '%3E')}>)`;
    const target = addresses.get(part.link.symbol);
    return target ? `[${label}](${href(file, target.file)}#${target.anchor})` : label;
  }).join('').trim();
}

function tagText(tag: DocTag, file: string, addresses: ReadonlyMap<string, Address>, language: string): string {
  const body = docText(tag.body, file, addresses);
  switch (tag.name) {
    case 'param':
      return `**Parameter${tag.parameter ? ` ${codeSpan(tag.parameter)}` : ''}** ${body.replace(/^[-–—]\s+/, '')}`.trimEnd();
    case 'return':
    case 'returns':
      return `**Returns** ${body}`.trimEnd();
    case 'throws':
    case 'exception':
      return `**Throws** ${body}`.trimEnd();
    case 'deprecated':
      return `**Deprecated** ${body}`.trimEnd();
    case 'example':
      return body.startsWith('```') || body.startsWith('~~~') ? body : codeBlock(body, language);
    case 'remarks':
      return body;
    case 'see':
      return `**See also** ${body}`.trimEnd();
    default:
      return '';
  }
}

function tagLinks(tags: string[] | undefined, file: string, tagIndex: string): string {
  if (!tags?.length) return '';
  return `**Tags** ${tags.map(tag => `[${codeSpan(tag)}](${href(file, tagIndex)}#${tagAnchor(tag)})`).join(', ')}`;
}

export function renderWiki(
  documentation: Documentation,
  extension: PageExtension = 'md',
  renderPage = markdownPage,
  renderGraph?: (file: string, section?: DocumentationSection) => string,
): Map<string, string> {
  const files = new Map<string, string>();
  const addresses = new Map<string, Address>();
  const tagged = new Map<string, string[]>();
  const home = `index.${extension}`;
  const tagIndex = `tags.${extension}`;
  const modules = documentation.modules.map(module => ({ ...module, file: pageFile(documentation, module.name, 'modules', extension) }));
  const pages = (documentation.pages ?? []).map(page => ({ ...page, file: pageFile(documentation, page.name, 'pages', extension) }));

  function indexTags(tags: string[] | undefined, label: string, file: string, anchor?: string): void {
    if (!tags?.length) return;
    const item = `- [${label}](${href(tagIndex, file)}${anchor ? `#${anchor}` : ''})`;
    for (const tag of tags) {
      const entries = tagged.get(tag);
      if (entries) entries.push(item);
      else tagged.set(tag, [item]);
    }
  }

  for (const page of pages) indexTags(page.tagLabels, escapeText(page.title), page.file);
  for (const module of modules) {
    indexTags(module.overview?.tagLabels, codeSpan(module.name), module.file);
    for (const symbol of module.symbols) {
      const anchor = symbolAnchor(symbol);
      addresses.set(symbol.id, { file: module.file, anchor });
      indexTags(symbol.tagLabels, `${codeSpan(symbol.name)} in ${codeSpan(module.name)}`, module.file, anchor);
    }
  }

  const navigation = documentation.navigation;
  const title = navigation?.title ?? 'Project documentation';
  const site: SiteMap = documentation.site ?? { home, routes: {}, tree: [] };
  const sections = new Map((navigation?.sections ?? []).map(section => [section.id, section]));
  const render = (file: string, pageTitle: string, blocks: readonly PageBlock[], section?: DocumentationSection): void => {
    files.set(file, renderPage({ file, title: pageTitle, blocks: blocks.filter(Boolean), crumbs: crumbsFor(site, file), section }));
  };
  const treeList = (nodes: readonly NavItem[], from: string, depth = 0): string[] => nodes.flatMap(node => [
    `${'  '.repeat(depth)}- [${escapeText(node.label)}](${href(from, node.file)})`,
    ...(node.kind === 'group' ? treeList(node.children, from, depth + 1) : []),
  ]);

  const pageBlocks = (page: typeof pages[number]): PageBlock[] => [tagLinks(page.tagLabels, page.file, tagIndex), page];
  const moduleBlocks = (module: typeof modules[number]): PageBlock[] => {
    const blocks: PageBlock[] = [`# ${codeSpan(module.name)}`, tagLinks(module.overview?.tagLabels, module.file, tagIndex)];
    if (module.overview?.markdown) blocks.push(module.overview);
    if (!module.symbols.length) blocks.push('This entry point has no exports.');
    for (const symbol of module.symbols) {
      const address = addresses.get(symbol.id)!;
      if (symbol.docId) blocks.push({ anchor: anchorFor(symbol.name) });
      blocks.push({ anchor: address.anchor }, `## ${codeSpan(symbol.name)}`);
      blocks.push(tagLinks(symbol.tagLabels, module.file, tagIndex));
      if (symbol.signatures.length) blocks.push(codeBlock(symbol.signatures.join('\n'), 'typescript'));
      blocks.push(docText(symbol.description, module.file, addresses));
      blocks.push(...symbol.tags.map(tag => tagText(tag, module.file, addresses, module.language)));
      const { file, line } = symbol.location;
      const label = codeSpan(`${file}:${line}`);
      const release = documentation.release;
      const source = release && projectPath(release.root, resolve(release.directory, file));
      if (release?.repository && source && release.tracked.has(source)) {
        const path = source.split('/').map(encodeHrefComponent).join('/');
        blocks.push(`Source [${label}](${release.repository}/blob/${release.commit}/${path}#L${line})`);
      } else blocks.push(`Source ${label}`);
    }
    return blocks;
  };
  const pagesByName = new Map(pages.map(page => [page.name, page]));
  const modulesByName = new Map(modules.map(module => [module.name, module]));
  const authored = (name: string | undefined): { title: string; blocks: PageBlock[] } | undefined => {
    const page = name === undefined ? undefined : pagesByName.get(name);
    if (page) return { title: page.title, blocks: pageBlocks(page) };
    const module = name === undefined ? undefined : modulesByName.get(name);
    if (module) return { title: module.name, blocks: moduleBlocks(module) };
  };

  // Home: the home page's content, or a title; Markdown also lists the whole tree.
  const homePage = authored(site.homeSource);
  const homeBlocks: PageBlock[] = homePage?.blocks ?? [`# ${escapeText(title)}`];
  const fileMap = `file-map.${extension}`;
  if (extension === 'md' || !homePage) {
    if (extension === 'md') {
      const links = [tagged.size ? `[Tags](${href(home, tagIndex)})` : '', documentation.fileGraph ? `[File map](${href(home, fileMap)})` : ''];
      homeBlocks.push(links.filter(Boolean).join(' · '));
    }
    if (site.tree.length) homeBlocks.push('## Contents', treeList(site.tree, home).join('\n'));
  }
  render(home, homePage?.title ?? title, homeBlocks);

  // Every group has a page: its authored index, or its label, followed by its direct children.
  const groupPages = (nodes: readonly NavItem[]): void => {
    for (const node of nodes) {
      if (node.kind !== 'group') continue;
      const index = authored(node.index);
      const blocks = index?.blocks ?? [`# ${escapeText(node.label)}`];
      if (node.children.length) blocks.push('## In this section', treeList(node.children, node.file).join('\n'));
      const section = node.section === undefined ? undefined : sections.get(node.section);
      if (section && renderGraph) blocks.push(renderGraph(node.file, section));
      render(node.file, index?.title ?? node.label, blocks, section);
      groupPages(node.children);
    }
  };
  groupPages(site.tree);

  const rendered = new Set(files.keys());
  for (const page of pages) if (!rendered.has(page.file)) render(page.file, page.title, pageBlocks(page));
  for (const module of modules) if (!rendered.has(module.file)) render(module.file, module.name, moduleBlocks(module));
  if (documentation.fileGraph) render(fileMap, 'File map', [renderGraph?.(fileMap) ?? '']);

  if (tagged.size) {
    const blocks: PageBlock[] = ['# Tags'];
    for (const tag of [...tagged.keys()].sort()) {
      blocks.push({ anchor: tagAnchor(tag) }, `## ${codeSpan(tag)}`, tagged.get(tag)!.join('\n'));
    }
    render(tagIndex, 'Tags', blocks);
  }
  return files;
}
