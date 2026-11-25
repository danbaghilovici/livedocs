import { posix, resolve } from 'node:path';
import type { DocPart, DocTag, Documentation, DocumentationSection, DocumentedSymbol, MarkdownContent } from './model.js';
import { projectPath } from './project.js';

interface Address {
  file: string;
  anchor: string;
}

type PageBlock = string | { anchor: string } | MarkdownContent;
type PageRenderer = (file: string, title: string, blocks: readonly PageBlock[], section?: DocumentationSection) => string;
export type PageExtension = 'md' | 'html';

/**
 * An anchor authored as an empty `<a id="…"></a>` or `<a name="…"></a>` element, the form GitHub
 * renders. Markdown output keeps it as raw HTML and HTML output renders it as an anchor, so links to
 * it resolve in both formats. The value is the first or second capture group.
 */
export const explicitAnchor = /<a\s+(?:id|name)\s*=\s*(?:"([^"<>]+)"|'([^'<>]+)')\s*><\/a>/;

function anchorTag(id: string): string {
  return `<a id="${id}"></a>`;
}

const markdownPage: PageRenderer = (_file, _title, blocks) => blocks.map(block => {
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
  const modules = documentation.modules.map(module => ({ ...module, file: wikiPath(module.name, 'modules', extension) }));
  const pages = (documentation.pages ?? []).map(page => ({ ...page, file: wikiPath(page.name, 'pages', extension) }));

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
  const sections = (navigation?.sections ?? []).map(section => ({ ...section, file: `sections/${section.id}/index.${extension}` }));
  const sectionsByFile = new Map<string, typeof sections>();
  for (const section of sections) {
    for (const name of [...section.entries, ...section.pages]) {
      const owners = sectionsByFile.get(name) ?? [];
      owners.push(section);
      sectionsByFile.set(name, owners);
    }
  }
  const sectionLinks = sections.map(section => `- [${escapeText(section.title)}](${href(home, section.file)})`);
  const rootPages = navigation ? new Set(navigation.pages) : undefined;
  const pageLinks = pages.filter(page => !rootPages || rootPages.has(page.name))
    .map(page => `- [${escapeText(page.title)}](${href(home, page.file)})`);
  const moduleLinks = navigation ? [] : modules.map(module => `- [${codeSpan(module.name)}](${href(home, module.file)})`);
  const tagNavigation = tagged.size ? `[Tags](${href(home, tagIndex)})` : '';
  const homeBlocks = [`# ${escapeText(title)}`];
  if (extension === 'html' || navigation) {
    const links = [tagNavigation];
    if (extension === 'html' && documentation.fileGraph) links.push('[File map](#file-map-title)');
    homeBlocks.push(links.filter(Boolean).join(' · '));
    if (sectionLinks.length) homeBlocks.push('## Sections', sectionLinks.join('\n'));
    if (pageLinks.length) homeBlocks.push('## Guides', pageLinks.join('\n'));
    if (moduleLinks.length) homeBlocks.push('## Source reference', moduleLinks.join('\n'));
  } else {
    homeBlocks.push(tagNavigation, [...pageLinks, ...moduleLinks].join('\n\n'));
  }
  if (renderGraph) homeBlocks.push(renderGraph(home));
  files.set(home, renderPage(home, title, homeBlocks.filter(Boolean)));

  for (const section of sections) {
    const { file } = section;
    const entries = new Set(section.entries);
    const guides = new Set(section.pages);
    const links = [`[Home](${href(file, home)})`];
    if (extension === 'html' && documentation.fileGraph) links.push('[File map](#file-map-title)');
    const blocks = [`# ${escapeText(section.title)}`, links.join(' · ')];
    const sectionPages = pages.filter(page => guides.has(page.name));
    if (sectionPages.length) blocks.push('## Guides', sectionPages.map(page => `- [${escapeText(page.title)}](${href(file, page.file)})`).join('\n'));
    const sectionModules = modules.filter(module => entries.has(module.name));
    if (sectionModules.length) blocks.push('## Source reference', sectionModules.map(module => `- [${codeSpan(module.name)}](${href(file, module.file)})`).join('\n'));
    if (renderGraph) blocks.push(renderGraph(file, section));
    files.set(file, renderPage(file, section.title, blocks, section));
  }

  const breadcrumbs = (name: string, file: string): string => [
    `[Home](${href(file, home)})`,
    ...(sectionsByFile.get(name) ?? []).map(section => `[${escapeText(section.title)}](${href(file, section.file)})`),
  ].join(' · ');
  for (const page of pages) {
    const blocks = [breadcrumbs(page.name, page.file), tagLinks(page.tagLabels, page.file, tagIndex), page];
    files.set(page.file, renderPage(page.file, page.title, blocks.filter(Boolean)));
  }
  for (const module of modules) {
    const blocks: PageBlock[] = [`# ${codeSpan(module.name)}`, tagLinks(module.overview?.tagLabels, module.file, tagIndex)];
    if (module.overview?.markdown) blocks.push(module.overview);
    blocks.push(breadcrumbs(module.name, module.file));
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
    files.set(module.file, renderPage(module.file, module.name, blocks.filter(Boolean)));
  }

  if (tagged.size) {
    const blocks: PageBlock[] = ['# Tags', `[Home](${href(tagIndex, home)})`];
    for (const tag of [...tagged.keys()].sort()) {
      blocks.push({ anchor: tagAnchor(tag) }, `## ${codeSpan(tag)}`, tagged.get(tag)!.join('\n'));
    }
    files.set(tagIndex, renderPage(tagIndex, 'Tags', blocks));
  }
  return files;
}
