import { readFileSync } from 'node:fs';
import { basename, dirname, isAbsolute, resolve } from 'node:path';
import { defaultCompilerConfig, projectPath, type Project } from './project.js';
import type { DocumentationSection } from './model.js';

export const configName = 'realdocs.json';
export const sourceFile = /\.(?:[jt]sx?|[cm][jt]s)$/i;
const markdownFile = /\.md$/i;

interface SectionConfig {
  title?: string;
  project?: string;
  entries?: string[];
  pages?: string[];
}

export interface Config {
  pages?: string[];
  sections?: Record<string, SectionConfig>;
}

export interface Site {
  project: Project;
  projects: Project[];
  title: string;
  pages: string[];
  sections: DocumentationSection[];
}

export function record(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : undefined;
}

export function packageInfo(path: string): Record<string, unknown> | undefined {
  try {
    return record(JSON.parse(readFileSync(path, 'utf8')));
  } catch {
    return undefined;
  }
}

function relativeInput(directory: string, value: unknown, field: string, pattern: RegExp): string {
  if (typeof value !== 'string' || !value.trim() || !pattern.test(value)) {
    throw new Error(`${configName}: ${field} has an invalid file path.`);
  }
  const path = projectPath(directory, resolve(directory, value));
  if (isAbsolute(value) || isAbsolute(path) || path === '..' || path.startsWith('../')) {
    throw new Error(`${configName}: ${field} must be inside the config directory (${value}).`);
  }
  return path;
}

function list(directory: string, value: unknown, field: string, pattern: RegExp): string[] {
  if (value === undefined) return [];
  if (!Array.isArray(value)) throw new Error(`${configName}: ${field} must be an array of file paths.`);
  return [...new Set(value.map(path => relativeInput(directory, path, field, pattern)))];
}

export function readSite(path: string, extraPages: string[]): Site {
  const directory = dirname(path);
  let input: Record<string, unknown> | undefined;
  try {
    input = record(JSON.parse(readFileSync(path, 'utf8').replace(/^\uFEFF/, '')));
  } catch (error) {
    throw new Error(`Could not read ${configName}. ${error instanceof Error ? error.message : String(error)}`);
  }
  if (!input) throw new Error(`${configName} must contain a JSON object.`);
  const entriesByConfig = new Map<string | undefined, Set<string>>();
  const defaultConfig = defaultCompilerConfig(directory);
  const pages = list(directory, input.pages, 'pages', markdownFile);
  const rootPages = [...new Set([...pages, ...list(directory, extraPages, '--page', markdownFile)])];
  const sections: DocumentationSection[] = [];
  const declared = input.sections === undefined ? {} : record(input.sections);
  if (!declared) throw new Error(`${configName}: sections must be an object.`);

  for (const [id, value] of Object.entries(declared)) {
    if (!/^[a-z0-9][a-z0-9_-]*$/.test(id)) throw new Error(`${configName}: invalid section ID ${JSON.stringify(id)}.`);
    const section = record(value);
    if (!section) throw new Error(`${configName}: sections.${id} must be an object.`);
    const field = `sections.${id}`;
    const title = section.title;
    if (title !== undefined && (typeof title !== 'string' || !title.trim() || /[\r\n]/.test(title))) {
      throw new Error(`${configName}: ${field}.title must be a nonempty single-line string.`);
    }
    const entries = list(directory, section.entries, `${field}.entries`, sourceFile);
    const sectionPages = list(directory, section.pages, `${field}.pages`, markdownFile);
    const config = section.project === undefined ? defaultConfig
      : resolve(directory, relativeInput(directory, section.project, `${field}.project`, /\.json$/i));
    if (entries.length) {
      const paths = entriesByConfig.get(config) ?? new Set<string>();
      for (const entry of entries) paths.add(resolve(directory, entry));
      entriesByConfig.set(config, paths);
    }
    sections.push({ id, title: title?.trim() ?? id, entries, pages: sectionPages });
  }

  const projects = [...entriesByConfig].map(([config, entries]) => ({ directory, config, entries: [...entries].sort(), pages: [] }));
  const name = packageInfo(resolve(directory, 'package.json'))?.name;
  const project = {
    directory,
    entries: [],
    pages: [...new Set([...rootPages, ...sections.flatMap(section => section.pages)])].map(page => resolve(directory, page)),
  };
  if (!projects.length && !project.pages.length) throw new Error(`${configName} needs at least one entry or Markdown page.`);
  return { project, projects, title: typeof name === 'string' && name.trim() ? name.trim() : basename(directory) || 'Project documentation',
    pages: rootPages, sections };
}
