import MarkdownIt from 'markdown-it';
import { markerPattern } from './c4-views.js';
import { symbolAnchor, wikiPath, type PageExtension } from './markdown.js';
import type { C4Item, C4Mark, C4Model, Diagnostic, Documentation, MarkdownContent } from './model.js';

const markdown = new MarkdownIt({ html: true });
const mention = /@(?:realdocs|livedocs):c4\b/;
const sectionMarker = /^<!--[ \t]*@(?:realdocs|livedocs):c4(?:[ \t]+(.*?))?[ \t]*-->[ \t]*$/;
const commentSource = String.raw`<!--\s*@(?:realdocs|livedocs):c4\b[\s\S]*?-->`;
const docId = /^[a-zA-Z][a-zA-Z0-9._-]*$/;

interface Heading { line: number; end: number; depth: number; text: string; id?: string }
interface Found extends C4Mark { heading?: Heading }
interface Scan {
  lines: string[];         // the content with every marker line emptied
  headings: Heading[];     // top-level headings
  sections: Found[];       // line is 0-based within the content
  diagrams: (Found & { title: string; mermaid: string })[];
  misplaced: { line: number; column: number; message: string }[];
}

const misplacedSection = 'Place <!-- @realdocs:c4 … --> at the top of the page or on the first line after a heading.';
const misplacedDiagram = 'Place %% @realdocs:c4 … before the diagram type line.';

// The 1-based source line of a line index, after compileDiagrams edits.
export const sourceLineOf = (content: MarkdownContent, index: number): number =>
  (content.sourceLine ?? 1) + (content.sourceLines?.[index] ?? index);

function scanContent(content: MarkdownContent): Scan {
  const lines = content.markdown.split('\n');
  const scan: Scan = { lines, headings: [], sections: [], diagrams: [], misplaced: [] };
  const tokens = markdown.parse(content.markdown, {});
  // Removes every marker comment from lines [start, end) without changing the line count, and returns where they were.
  const strip = (start: number, end: number): { line: number; column: number }[] => {
    const text = lines.slice(start, end).join('\n');
    const found: { line: number; column: number }[] = [];
    const cleaned = text.replace(new RegExp(commentSource, 'g'), (match, offset: number) => {
      const before = text.slice(0, offset);
      found.push({ line: start + before.split('\n').length - 1, column: offset - (before.lastIndexOf('\n') + 1) + 1 });
      return match.replace(/[^\n]/g, '');
    });
    const result = cleaned.split('\n');
    for (const [offset, line] of result.entries()) lines[start + offset] = line.trim() ? line : '';
    return found;
  };
  let heading: Heading | undefined;
  let afterHeading: Heading | undefined; // set while only section markers follow a heading
  for (const [index, token] of tokens.entries()) {
    const [start, end] = token.map ?? [0, 0];
    const run = afterHeading;
    afterHeading = undefined;
    if (token.type === 'heading_open' && token.level === 0 && token.map) {
      heading = {
        line: start, end, depth: Number(token.tag.slice(1)), text: tokens[index + 1].content,
        id: content.headings?.find(item => item.line === start)?.id,
      };
      scan.headings.push(heading);
    } else if (token.type === 'heading_close' && token.level === 0) {
      afterHeading = heading;
    } else if (token.type === 'html_block' && token.map && new RegExp(commentSource).test(token.content)) {
      const marker = sectionMarker.exec(token.content.trim());
      if (marker && run && token.level === 0) {
        scan.sections.push({ path: marker[1] ?? '', line: start, column: lines[start].indexOf('<!--') + 1, heading: run });
        afterHeading = run;
        strip(start, end);
      } else {
        for (const { line, column } of strip(start, end)) scan.misplaced.push({ line, column, message: misplacedSection });
      }
    } else if (token.type === 'inline' && token.map && token.children?.some(child => child.type === 'html_inline' && mention.test(child.content))) {
      for (const { line, column } of strip(start, end)) scan.misplaced.push({ line, column, message: misplacedSection });
    } else if (token.type === 'fence' && token.map && /^mermaid(?:\s|$)/.test(token.info.trim())) {
      const body = token.content.split('\n');
      let typeLine = body.findIndex(text => text.trim() && !text.trim().startsWith('%%'));
      if (typeLine < 0) typeLine = body.length;
      const marks: Found[] = [];
      for (const [offset, text] of body.entries()) {
        const marker = markerPattern.exec(text);
        if (!marker) continue;
        const line = start + 1 + offset;
        const column = lines[line].indexOf('%%') + 1;
        // A nested fence keeps its quote or list prefix.
        lines[line] = token.level === 0 ? '' : lines[line].slice(0, column - 1);
        if (token.level === 0 && offset < typeLine) marks.push({ path: marker[1] ?? '', line, column, heading });
        else scan.misplaced.push({ line, column, message: misplacedDiagram });
      }
      const kept = body.filter(text => !markerPattern.test(text));
      const title = kept.find(text => /^\s*title\s+\S/.test(text))?.trim().slice(5).trim() || heading?.text || '';
      for (const mark of marks) scan.diagrams.push({ ...mark, title, mermaid: kept.join('\n').trimEnd() });
    }
  }
  return scan;
}

const isFound = (scan: Scan): boolean => !!(scan.sections.length || scan.diagrams.length || scan.misplaced.length);

const contents = (documentation: Documentation): MarkdownContent[] =>
  [...documentation.pages ?? [], ...documentation.modules.flatMap(module => module.overview ?? [])];

// Whether any marker is present. A prose mention of the marker text does not count.
export function hasC4Markers(documentation: Documentation): boolean {
  return contents(documentation).some(content => content.c4Marks?.length || mention.test(content.markdown) && isFound(scanContent(content))) ||
    documentation.modules.some(module => module.symbols.some(symbol => symbol.c4Marks?.length));
}

interface Source {
  file: string;     // project path of the page or module
  href: string;     // wiki output file
  fallback: string; // title when a diagram has no title and no heading
}

// Turns every marker into a panel item and empties the marker lines, so none reach the wiki output.
export function collectC4Items(
  documentation: Documentation,
  model: C4Model,
  extension: PageExtension,
  diagnostics: Diagnostic[],
): { documentation: Documentation; items: C4Item[] } {
  const paths = new Set(model.elements.map(element => element.path));
  const aliases = new Map(model.elements.map(element => [element.alias, element.path]));
  const items: C4Item[] = [];

  const accept = ({ path, line, column }: C4Mark, file: string): boolean => {
    const report = (message: string): false => {
      diagnostics.push({ level: 'error', message, location: { file, line, column } });
      return false;
    };
    if (!docId.test(path)) return report(`Invalid @realdocs:c4 path ${JSON.stringify(path)}. Use aliases separated by dots, such as shop.api.`);
    if (paths.has(path)) return true;
    const suggestion = aliases.get(path.split('.').at(-1)!);
    return report(`Unknown C4 element path ${path}.${suggestion ? ` Did you mean ${suggestion}?` : ''}`);
  };

  // Scans one page or overview. `lead` adds the items that come before its sections and diagrams.
  const process = <T extends MarkdownContent>(content: T, { file, href, fallback }: Source, lead: (scan: Scan) => void): T => {
    if (!content.c4Marks?.length && !mention.test(content.markdown)) return content;
    const scan = scanContent(content);
    for (const { line, column, message } of scan.misplaced) {
      diagnostics.push({ level: 'error', message, location: { file, line: sourceLineOf(content, line), column } });
    }
    lead(scan);
    const marks = [
      ...scan.sections.map(mark => ({ ...mark, diagram: undefined })),
      ...scan.diagrams.map(mark => ({ ...mark, diagram: mark })),
    ].sort((a, b) => a.line - b.line);
    for (const { path, line, column, heading, diagram } of marks) {
      if (!accept({ path, line: sourceLineOf(content, line), column }, file)) continue;
      const target = heading?.id ? `${href}#${heading.id}` : href;
      if (diagram) {
        items.push({ path, tab: 'diagrams', kind: 'diagram', title: diagram.title || fallback, source: file, href: target, mermaid: diagram.mermaid, origin: href });
      } else if (heading) {
        const next = scan.headings.find(item => item.line > heading.line && item.depth <= heading.depth);
        items.push({
          path, tab: 'docs', kind: 'section', title: heading.text, source: file, href: target,
          markdown: scan.lines.slice(heading.line, next?.line ?? scan.lines.length).join('\n').trim(), origin: href,
        });
      }
    }
    return { ...content, markdown: scan.lines.join('\n') };
  };

  const pages = documentation.pages?.map(page => {
    const href = wikiPath(page.name, 'pages', extension);
    return process(page, { file: page.name, href, fallback: page.title }, scan => {
      for (const mark of page.c4Marks ?? []) {
        if (!accept(mark, page.name)) continue;
        // The content after a leading level-1 heading, up to the next heading.
        const [first] = scan.headings;
        const leading = first?.depth === 1 && scan.lines.slice(0, first.line).every(line => !line.trim());
        const start = leading ? first.end : 0;
        const next = scan.headings.find(heading => heading.line >= start);
        items.push({
          path: mark.path, tab: 'docs', kind: 'page', title: page.title, source: page.name, href,
          markdown: scan.lines.slice(start, next?.line ?? scan.lines.length).join('\n').trim(), origin: href,
        });
      }
    });
  });

  const modules = documentation.modules.map(module => {
    const href = wikiPath(module.name, 'modules', extension);
    const overview = module.overview && process(module.overview, { file: module.name, href, fallback: module.name }, scan => {
      for (const mark of module.overview!.c4Marks ?? []) {
        if (!accept(mark, module.name)) continue;
        items.push({
          path: mark.path, tab: 'code', kind: 'file', title: module.name, source: module.name, href,
          markdown: scan.lines.join('\n').trim().split(/\n\s*\n/)[0],
          exports: module.symbols.map(symbol => ({ name: symbol.name, href: `${href}#${symbolAnchor(symbol)}` })),
          origin: href,
        });
      }
    });
    for (const symbol of module.symbols) {
      for (const mark of symbol.c4Marks ?? []) {
        if (!accept(mark, symbol.location.file)) continue;
        items.push({
          path: mark.path, tab: 'code', kind: 'symbol', title: symbol.name, source: module.name, href: `${href}#${symbolAnchor(symbol)}`,
          signature: symbol.signatures[0],
          summary: symbol.description.map(part => part.text).join('').split(/\n\s*\n/)[0].trim() || undefined,
          origin: href,
        });
      }
    }
    return { ...module, overview };
  });

  return { documentation: { ...documentation, ...pages && { pages }, modules }, items };
}
