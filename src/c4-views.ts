import type { C4Boundary, C4View } from './model.js';

export const markerPattern = /^\s*%%\s*@(?:realdocs|livedocs):c4(?:\s+(.*?))?\s*$/;

const viewTypes = new Set<string>(['C4Context', 'C4Container', 'C4Component']);
const elementMacro = /^(Person|System|SystemDb|SystemQueue|Container|ContainerDb|ContainerQueue|Component|ComponentDb|ComponentQueue)(_Ext)?$/;
const boundaryMacro = /^(System_Boundary|Container_Boundary|Enterprise_Boundary|Boundary)$/;
const relationshipMacro = /^(Rel|BiRel|Rel_\w+)$/;

function splitArgs(text: string): string[] {
  const args: string[] = [];
  let current = '';
  let quoted = false;
  for (const char of text) {
    if (char === '"') quoted = !quoted;
    else if (char === ',' && !quoted) {
      args.push(current.trim());
      current = '';
    } else current += char;
  }
  args.push(current.trim());
  return args.filter(arg => !arg.startsWith('$'));
}

const optional = (value: string | undefined): string | undefined => value || undefined;

export function parseC4View(body: string): C4View | undefined {
  const lines = body.split('\n');
  const kept: string[] = [];
  let view: C4View | undefined;
  const stack: string[] = [];

  for (const [index, raw] of lines.entries()) {
    const line = raw.trim();
    if (markerPattern.test(raw)) continue;
    kept.push(raw);
    if (!line || line.startsWith('%%')) continue;
    if (!view) {
      const type = line.split(/\s+/)[0];
      if (!viewTypes.has(type)) return undefined;
      view = { type: type as C4View['type'], title: '', elements: [], boundaries: [], relationships: [], source: '' };
      continue;
    }
    if (line.startsWith('title ')) { view.title = line.slice(6).trim(); continue; }
    if (line === '}') { stack.pop(); continue; }
    const call = /^(\w+)\((.*)\)\s*(\{)?$/.exec(line);
    if (!call) continue;
    const [, macro, argText, open] = call;
    const args = splitArgs(argText);
    if (open && boundaryMacro.test(macro)) {
      const boundary: C4Boundary = { alias: args[0], kind: macro, label: args[1] ?? '', parent: stack.at(-1), line: index };
      view.boundaries.push(boundary);
      stack.push(boundary.alias);
    } else if (open) stack.push('');
    else if (elementMacro.test(macro)) {
      const deep = /^(Container|Component)/.test(macro);
      view.elements.push({
        alias: args[0], kind: macro, label: args[1] ?? '',
        technology: optional(deep ? args[2] : undefined),
        description: optional(deep ? args[3] : args[2]),
        line: index, boundary: stack.at(-1) || undefined,
      });
    } else if (relationshipMacro.test(macro)) {
      view.relationships.push({ from: args[0], to: args[1], label: args[2] ?? '', technology: optional(args[3]) });
    } else if (macro === 'UpdateLayoutConfig') view.layout = line;
  }
  if (view) view.source = kept.join('\n');
  return view;
}
