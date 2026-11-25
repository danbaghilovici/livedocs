import { readFileSync, realpathSync } from 'node:fs';
import { basename, dirname, isAbsolute, resolve } from 'node:path';
import { defaultCompilerConfig, projectPath, type Project } from './project.js';
import type { DocumentationSection } from './model.js';

export const configName = 'realdocs.json';
export const sourceFile = /\.(?:[jt]sx?|[cm][jt]s)$/i;
const markdownFile = /\.md$/i;
const jsonFile = /\.json$/i;

interface SectionConfig {
  title?: string;
  config?: string;
  project?: string;
  entries?: string[];
  pages?: string[];
}

export interface Config {
  sourceUrl?: string;
  pages?: string[];
  sections?: Record<string, SectionConfig>;
}

export interface Site {
  project: Project;
  projects: Project[];
  configPaths: string[];
  title: string;
  pages: string[];
  sections: DocumentationSection[];
}

type ConfigNavigation = Pick<Site, 'pages' | 'sections'>;

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

function inputPath(directory: string, value: unknown, field: string, pattern: RegExp): string {
  if (typeof value !== 'string' || !value.trim() || !pattern.test(value)) {
    throw new Error(`${field} has an invalid file path.`);
  }
  const path = resolve(directory, value);
  const relative = projectPath(directory, path);
  if (isAbsolute(value) || isAbsolute(relative) || relative === '..' || relative.startsWith('../')) {
    throw new Error(`${field} must be inside the config directory (${value}).`);
  }
  return path;
}

function sourceUrl(value: unknown, field: string): string | undefined {
  if (value === undefined) return undefined;
  let url: URL | undefined;
  try {
    url = typeof value === 'string' ? new URL(value) : undefined;
  } catch {
    // Reported below with the expected form.
  }
  if (!url || (url.protocol !== 'https:' && url.protocol !== 'http:') || url.search || url.hash) {
    throw new Error(`${field} must be an http(s) URL without a query or fragment, such as https://github.com/owner/repo/blob/main.`);
  }
  return url.href.replace(/\/+$/, '');
}

function list(directory: string, value: unknown, field: string, pattern: RegExp): string[] {
  if (value === undefined) return [];
  if (!Array.isArray(value)) throw new Error(`${field} must be an array of file paths.`);
  return [...new Set(value.map(path => inputPath(directory, path, field, pattern)))];
}

export function readSite(path: string, extraPages: string[]): Site {
  const directory = dirname(path);
  const compilerProjects = new Map<string, { config?: string; compilerDirectory: string; entries: Set<string> }>();
  const configPaths = new Set<string>();
  const activeConfigs = new Map<string, string>();
  const loadedConfigs = new Map<string, ConfigNavigation>();
  let siteSourceUrl: string | undefined;
  const sitePath = (file: string): string => projectPath(directory, file);

  function readConfig(configPath: string, addedPages: string[] = []): ConfigNavigation {
    const loaded = loadedConfigs.get(configPath);
    if (loaded) return loaded;

    const label = sitePath(configPath);
    const configDirectory = dirname(configPath);
    let input: Record<string, unknown> | undefined;
    let realPath: string;
    try {
      realPath = realpathSync(configPath);
      input = record(JSON.parse(readFileSync(configPath, 'utf8').replace(/^\uFEFF/, '')));
    } catch (error) {
      throw new Error(`Could not read ${label}. ${error instanceof Error ? error.message : String(error)}`);
    }
    if (activeConfigs.has(realPath)) {
      throw new Error(`Circular config include: ${[...activeConfigs.values(), label].join(' -> ')}.`);
    }
    activeConfigs.set(realPath, label);
    configPaths.add(configPath);
    configPaths.add(realPath);
    if (!input) throw new Error(`${label} must contain a JSON object.`);
    // An included config's source URL applies when that config builds its own wiki.
    const configSourceUrl = sourceUrl(input.sourceUrl, `${label}: sourceUrl`);
    if (configPath === path) siteSourceUrl = configSourceUrl;

    const defaultConfig = defaultCompilerConfig(configDirectory);
    const pages = [...new Set([
      ...list(configDirectory, input.pages, `${label}: pages`, markdownFile),
      ...list(configDirectory, addedPages, `${label}: --page`, markdownFile),
    ])].map(sitePath);
    const sections: DocumentationSection[] = [];
    const declared = input.sections === undefined ? {} : record(input.sections);
    if (!declared) throw new Error(`${label}: sections must be an object.`);

    for (const [id, value] of Object.entries(declared)) {
      if (!/^[a-z0-9][a-z0-9_-]*$/.test(id)) throw new Error(`${label}: invalid section ID ${JSON.stringify(id)}.`);
      const field = `${label}: sections.${id}`;
      const section = record(value);
      if (!section) throw new Error(`${field} must be an object.`);
      const title = section.title;
      if (title !== undefined && (typeof title !== 'string' || !title.trim() || /[\r\n]/.test(title))) {
        throw new Error(`${field}.title must be a nonempty single-line string.`);
      }
      const sectionTitle = title?.trim() ?? id;
      if (section.config !== undefined) {
        if (section.entries !== undefined || section.pages !== undefined || section.project !== undefined) {
          throw new Error(`${field}.config cannot be combined with entries, pages, or project.`);
        }
        const included = readConfig(inputPath(configDirectory, section.config, `${field}.config`, jsonFile));
        sections.push({
          id,
          title: sectionTitle,
          entries: [...new Set(included.sections.flatMap(section => section.entries))],
          pages: [...new Set([...included.pages, ...included.sections.flatMap(section => section.pages)])],
        });
        continue;
      }
      const entries = list(configDirectory, section.entries, `${field}.entries`, sourceFile);
      const sectionPages = list(configDirectory, section.pages, `${field}.pages`, markdownFile);
      const config = section.project === undefined ? defaultConfig
        : inputPath(configDirectory, section.project, `${field}.project`, jsonFile);
      if (entries.length) {
        const compilerDirectory = config ? dirname(config) : configDirectory;
        const key = config ?? compilerDirectory;
        const project = compilerProjects.get(key) ?? { config, compilerDirectory, entries: new Set<string>() };
        for (const entry of entries) project.entries.add(entry);
        compilerProjects.set(key, project);
      }
      sections.push({ id, title: sectionTitle, entries: entries.map(sitePath), pages: sectionPages.map(sitePath) });
    }
    if (!pages.length && !sections.some(section => section.entries.length || section.pages.length)) {
      throw new Error(`${label} needs at least one entry or Markdown page.`);
    }
    activeConfigs.delete(realPath);
    const navigation = { pages, sections };
    loadedConfigs.set(configPath, navigation);
    return navigation;
  }

  const { pages, sections } = readConfig(path, extraPages);
  const projects = [...compilerProjects.values()].map(project => ({
    ...project, directory, entries: [...project.entries].sort(), pages: [],
  }));
  const name = packageInfo(resolve(directory, 'package.json'))?.name;
  const project = {
    directory,
    entries: [],
    pages: [...new Set([...pages, ...sections.flatMap(section => section.pages)])].map(page => resolve(directory, page)),
    ...(siteSourceUrl && { sourceUrl: siteSourceUrl }),
  };
  return { project, projects, configPaths: [...configPaths], pages, sections,
    title: typeof name === 'string' && name.trim() ? name.trim() : basename(directory) || 'Project documentation' };
}
