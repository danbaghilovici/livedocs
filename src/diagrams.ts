import MarkdownIt from 'markdown-it';
import { codeSpan, href, pageFile, symbolAnchor, type PageExtension } from './markdown.js';
import type { Diagnostic, Documentation, DocumentedSymbol, MarkdownContent } from './model.js';

interface DiagramSymbol {
  symbol: DocumentedSymbol;
  file: string;
}

interface DiagramLink {
  node?: string;
  target: DiagramSymbol;
}

interface LineEdit {
  start: number;
  end: number;
  lines: string[];
}

const markdown = {
  md: new MarkdownIt({ html: true }),
  html: new MarkdownIt(),
};
const directive = /\{\{\s*(?:symbol\b|diagram\.)/;
const inlineExpression = /\{\{\s*((?:symbol\b|diagram\.)[^{}]*?)\s*\}\}/g;
const nameExpression = /^symbol\s*\(\s*(['"])([^'"]+)\1\s*\)\s*\.\s*name$/;
const linkLine = /^\s*\{\{\s*diagram\.link\s*\(\s*(['"])([a-zA-Z_][a-zA-Z0-9_-]*)\1\s*,\s*(['"])([^'"]+)\3\s*\)\s*\}\}\s*$/;
const dependencies = /^\s*\{\{\s*diagram\.dependencies\s*\(\s*(['"])([^'"]+)\1\s*\)\s*\}\}\s*$/;
const dependencyReference = /(?<!\\)(?:\\\\)*\{\{\s*diagram\.dependencies\b/;

function mermaidLabel(text: string): string {
  // Mermaid supports numeric entities in quoted labels.
  return text.replace(/[^\p{L}\p{N}\p{M} _.\-]/gu, char => `#${char.codePointAt(0)};`);
}

function inLabel(line: string, column: number): boolean {
  let quote = -1;
  for (let index = 0; index < column; index++) {
    if (line[index] === '\\') index++;
    else if (line[index] === '"') quote = quote < 0 ? index : -1;
  }
  if (quote < 0) return false;
  const before = line.slice(0, quote).trimEnd();
  // Flowchart text follows a shape or edge delimiter. C4 uses positional text arguments.
  return /[\[({|>-]$/.test(before) || /^\s*[A-Z][a-zA-Z_]*\(.*,$/.test(before);
}

function legend(links: DiagramLink[], from: string): string[] {
  if (!links.length) return [];
  return ['', ...links.map(({ node, target }) => {
    const link = `[${codeSpan(target.symbol.name)}](${href(from, target.file)}#${symbolAnchor(target.symbol)})`;
    return `- ${node ? `${codeSpan(node)} ` : ''}${link}`;
  }), ''];
}

function dependencyGraph(root: string, registry: ReadonlyMap<string, DiagramSymbol>, from: string, linkedFiles: Set<string>): string[] {
  const ids = [root];
  const nodes = new Map([[root, 's0']]);
  const edges: string[] = [];
  for (const id of ids) {
    for (const dependency of registry.get(id)!.symbol.docUses ?? []) {
      if (!registry.has(dependency)) continue;
      if (!nodes.has(dependency)) {
        nodes.set(dependency, `s${ids.length}`);
        ids.push(dependency);
      }
      edges.push(`  ${nodes.get(id)} --> ${nodes.get(dependency)}`);
    }
  }
  const links = ids.map(id => ({ target: registry.get(id)! }));
  for (const { target } of links) linkedFiles.add(target.symbol.location.file);
  return [
    '```mermaid', 'flowchart LR',
    ...links.map(({ target }, index) => `  s${index}["${mermaidLabel(target.symbol.name)}"]`),
    ...edges, '```', ...legend(links, from),
  ];
}

function compileContent<T extends MarkdownContent>(
  content: T,
  origin: string,
  from: string,
  registry: ReadonlyMap<string, DiagramSymbol>,
  diagnostics: Diagnostic[],
  extension: PageExtension,
): T {
  if (!directive.test(content.markdown)) return content;

  const lines = content.markdown.split('\n');
  const edits: LineEdit[] = [];
  const linkedFiles = new Set(content.linkedFiles);
  const report = (message: string, line: number, column = 0): void => {
    diagnostics.push({
      level: 'error', message,
      location: { file: origin, line: (content.sourceLine ?? 1) + line, column: column + 1 },
    });
  };
  const resolve = (id: string, line: number, column?: number): DiagramSymbol | undefined => {
    const target = registry.get(id);
    if (!target) report(`Unknown diagram symbol ${id}. Add @realdocs:docId to an included export.`, line, column);
    else linkedFiles.add(target.symbol.location.file);
    return target;
  };

  const tokens = markdown[extension].parse(content.markdown, {});
  for (const [index, token] of tokens.entries()) {
    if (!token.map) continue;
    const [start, end] = token.map;
    if (token.type === 'paragraph_open') {
      const inline = tokens[index + 1];
      const block = lines.slice(start, end).join('\n');
      if (!dependencyReference.test(block) || !inline.children?.some(child =>
        child.type === 'text' && child.content.includes('diagram.dependencies'))) continue;
      const match = token.level === 0 ? dependencies.exec(block) : null;
      if (!match) report('Use {{ diagram.dependencies("id") }} in its own top-level paragraph.', start);
      else if (resolve(match[2], start)) edits.push({ start, end, lines: dependencyGraph(match[2], registry, from, linkedFiles) });
      continue;
    }
    if (token.type !== 'fence' || !/^mermaid(?:\s|$)/.test(token.info.trim()) || !directive.test(token.content)) continue;
    if (token.level !== 0) {
      report('Place Mermaid diagrams that use RealDocs references in a top-level fence.', start);
      continue;
    }

    const links: DiagramLink[] = [];
    const last = lines[end - 1].trim();
    const closed = end > start + 1 && last.startsWith(token.markup) && [...last].every(char => char === token.markup[0]);
    const bodyEnd = closed ? end - 1 : end;
    const body = [lines[start]];
    for (let line = start + 1; line < bodyEnd; line++) {
      const match = linkLine.exec(lines[line]);
      if (match) {
        const target = resolve(match[4], line);
        if (target) links.push({ node: match[2], target });
        continue;
      }
      const source = lines[line];
      if (directive.test(source.replace(inlineExpression, ''))) report('Unterminated Mermaid reference.', line);
      body.push(source.replace(inlineExpression, (raw, expression: string, column: number) => {
        const name = nameExpression.exec(expression);
        if (!name || !inLabel(source, column)) {
          report('Use {{ symbol("id").name }} inside a double-quoted Mermaid label or diagram.link on its own line.', line, column);
          return raw;
        }
        const target = resolve(name[2], line, column);
        return target ? mermaidLabel(target.symbol.name) : raw;
      }));
    }
    if (closed || links.length) body.push(closed ? lines[end - 1] : token.markup);
    edits.push({ start, end, lines: [...body, ...legend(links, from)] });
  }

  if (!edits.length) return content;
  const result: string[] = [];
  let cursor = 0;
  for (const edit of edits) {
    result.push(...lines.slice(cursor, edit.start), ...edit.lines);
    cursor = edit.end;
  }
  result.push(...lines.slice(cursor));
  const headings = content.headings?.map(heading => ({
    ...heading,
    line: heading.line + edits.reduce((offset, edit) =>
      edit.end <= heading.line ? offset + edit.lines.length - (edit.end - edit.start) : offset, 0),
  }));
  return { ...content, markdown: result.join('\n'), headings, linkedFiles: linkedFiles.size ? [...linkedFiles] : undefined };
}

export function compileDiagrams(documentation: Documentation, extension: PageExtension): Documentation {
  const diagnostics = [...documentation.diagnostics];
  const registry = new Map<string, DiagramSymbol>();
  for (const module of documentation.modules) {
    const file = pageFile(documentation, module.name, 'modules', extension);
    for (const symbol of module.symbols) {
      if (!symbol.docId) continue;
      const previous = registry.get(symbol.docId);
      if (previous) {
        const location = previous.symbol.location;
        diagnostics.push({
          level: 'error', location: symbol.location,
          message: `Duplicate @realdocs:docId ${symbol.docId}. Also declared at ${location.file}:${location.line}.`,
        });
      } else {
        registry.set(symbol.docId, { symbol, file });
      }
    }
  }
  for (const module of documentation.modules) {
    for (const symbol of module.symbols) {
      for (const id of symbol.docUses ?? []) {
        if (!registry.has(id)) diagnostics.push({
          level: 'error', location: symbol.location,
          message: `Unknown @realdocs:docUses target ${id} on ${symbol.docId}.`,
        });
      }
    }
  }

  return {
    ...documentation,
    diagnostics,
    modules: documentation.modules.map(module => ({
      ...module,
      overview: module.overview && compileContent(module.overview, module.name,
        pageFile(documentation, module.name, 'modules', extension), registry, diagnostics, extension),
    })),
    pages: documentation.pages?.map(page => compileContent(page, page.name,
      pageFile(documentation, page.name, 'pages', extension), registry, diagnostics, extension)),
  };
}
