export interface SourceLocation {
  file: string;
  line: number;
  column: number;
}

export interface Diagnostic {
  level: 'error' | 'warning';
  message: string;
  location?: SourceLocation;
}

export interface DocPart {
  text: string;
  code?: boolean;
  link?: { symbol: string } | { url: string };
}

export interface DocTag {
  name: string;
  body: DocPart[];
  parameter?: string;
}

export interface DocumentedSymbol {
  id: string;
  name: string;
  signatures: string[];
  description: DocPart[];
  tags: DocTag[];
  tagLabels?: string[];
  docId?: string;
  docUses?: string[];
  location: SourceLocation;
}

export interface MarkdownContent {
  markdown: string;
  headings?: { line: number; id: string; nested: boolean }[];
  sourceLine?: number;
  tagLabels?: string[];
  zone?: string;
  linkedFiles?: string[];
}

export interface AuthoredPage extends MarkdownContent {
  name: string;
  title: string;
}

export interface DocumentedModule {
  name: string;
  language: string;
  overview?: MarkdownContent;
  symbols: DocumentedSymbol[];
}

export interface DocumentationSection {
  id: string;
  title: string;
  entries: string[];
  pages: string[];
}

export interface Release {
  version: string;
  commit: string;
  repository?: string;
  directory: string;
  root: string;
  tracked: ReadonlySet<string>;
}

export interface Documentation {
  modules: DocumentedModule[];
  pages?: AuthoredPage[];
  diagnostics: Diagnostic[];
  fileGraph?: FileGraph;
  release?: Release;
  navigation?: { title: string; pages: string[]; sections: DocumentationSection[] };
}

export type FileRelation = 'import' | 're-export' | 'type-only' | 'doc-link' | 'declared';

export interface FileEdge {
  source: string;
  target: string;
  kind: FileRelation;
}

export interface FileGraph {
  nodes: { path: string; zone?: string; kind: 'code' | 'doc'; documented?: boolean }[];
  edges: FileEdge[];
}

export function normalizeTagLabels(labels: readonly string[]): string[] {
  return [...new Set(labels.map(label => label.trim().toLowerCase().normalize('NFC').replace(/\s+/gu, '-')).filter(Boolean))];
}

export interface C4Mark { path: string; line: number; column: number }

export interface C4Element {
  alias: string;
  kind: string;
  label: string;
  technology?: string;
  description?: string;
  line: number;
}
export interface C4Boundary { alias: string; kind: string; label: string; parent?: string; line: number }
export interface C4Relationship { from: string; to: string; label: string; technology?: string }

export interface C4View {
  type: 'C4Context' | 'C4Container' | 'C4Component';
  title: string;
  elements: (C4Element & { boundary?: string })[];
  boundaries: C4Boundary[];
  relationships: C4Relationship[];
  layout?: string;
  source: string;
  marks: C4Mark[];
  misplacedMarks: C4Mark[];
}
