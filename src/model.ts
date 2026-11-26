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
