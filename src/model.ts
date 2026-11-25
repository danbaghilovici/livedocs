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

export interface Documentation {
  modules: DocumentedModule[];
  pages?: AuthoredPage[];
  diagnostics: Diagnostic[];
  fileGraph?: FileGraph;
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
