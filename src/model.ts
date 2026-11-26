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
  c4Marks?: C4Mark[];
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
  sourceLines?: number[]; // original line index of each line, set when compileDiagrams edits the content
  c4Marks?: C4Mark[];
  linkedFiles?: string[];
  category?: string;
  path?: string;
  annotationErrors?: { message: string; line: number }[];
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
  category?: string;
  group?: string;
}

/** A folder default from realdocs.json. The pattern is a normalized glob relative to the site root. */
export interface PlacementRule {
  pattern: string;
  category: string;
  group?: string;
}

export interface Navigation {
  title: string;
  pages: string[];
  sections: DocumentationSection[];
  home?: string;
  categories: string[];
  groups: Record<string, string>;
  rules: PlacementRule[];
  sourceUrl?: string;
}

/** Where an input is written, and the label of the category that placed it. */
export interface Route {
  file: string;
  category?: string;
}

export interface NavPage {
  kind: 'page';
  label: string;
  file: string;
  source: string;
  code: boolean;
}

export interface NavGroup {
  kind: 'group';
  label: string;
  key: string;
  file: string;
  /** Source name of the authored page that is this group's index. */
  index?: string;
  /** Section ID when the group is a section landing page. */
  section?: string;
  children: NavItem[];
}

export type NavItem = NavGroup | NavPage;

export interface SiteMap {
  home: string;
  homeSource?: string;
  routes: Record<string, Route>;
  tree: NavGroup[];
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
  navigation?: Navigation;
  site?: SiteMap;
  c4?: C4Model;
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

/** Why a `category` or `path` annotation value is unusable, or undefined when it is fine. */
export function placementError(name: 'category' | 'path', value: string, repeated: boolean): string | undefined {
  if (repeated) return `A file can have only one @realdocs:${name}.`;
  if (!value.trim()) return `@realdocs:${name} needs a value.`;
  if (/[\r\n]/.test(value.trim())) return `@realdocs:${name} must be a single line.`;
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
}

export interface C4PlacedView { title: string; type: C4View['type']; origin: string; href: string; source: string; relationships: C4Relationship[] }
export interface C4Level { key: string; path: string; label: string; type: C4View['type']; views: C4PlacedView[]; merged?: string }
export interface C4ModelElement {
  alias: string; path: string; kind: string; label: string; technology?: string; description?: string;
  home: string; hasLevel: boolean; appearsIn: { title: string; origin: string }[];
}
export type C4Tab = 'diagrams' | 'docs' | 'code';
export interface C4Item {
  path: string; tab: C4Tab; kind: 'page' | 'section' | 'diagram' | 'file' | 'symbol';
  title: string; source: string; href: string;
  markdown?: string; mermaid?: string;
  signature?: string; summary?: string;
  exports?: { name: string; href: string }[];
  origin: string;
}
export interface C4Model { publish: boolean; root: string; levels: C4Level[]; elements: C4ModelElement[]; items: C4Item[] }
