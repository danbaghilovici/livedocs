import { readdirSync, writeFileSync } from 'node:fs';
import { basename, posix, resolve } from 'node:path';
import ts from 'typescript';
import { configName, packageInfo, record, sourceFile, type Config } from './config.js';
import { projectPath } from './project.js';

// Build output, dependencies, and test code with its fixtures and end-to-end suites.
const ignored = new Set(['node_modules', 'dist', 'build', 'coverage', 'out', 'vendor',
  'test', 'tests', '__tests__', 'e2e', 'fixtures', '__fixtures__', '__mocks__']);
// Instructions for coding agents, which the maintenance rule asks to keep out of the wiki.
const agentInstructions = /^(?:AGENTS(?:\.override)?|CLAUDE|GEMINI)\.md$/i;
const configFile = /^(?:tsconfig(?:\.(?:app|lib))?|jsconfig)\.json$/;
const entryName = /^(?:main|index)\.(?:[jt]sx?|[cm][jt]s)$/i;
const testFile = /(?:\.(?:spec|test|d)|-spec)\.[cm]?[jt]sx?$/i;
const toolingFile = /\.config\.[cm]?[jt]sx?$/i;

interface Candidate {
  path: string;
  id?: string;
  config?: string;
  entry?: string;
}

function paths(directory: string, folder = ''): string[] {
  const result: string[] = [];
  const items = readdirSync(resolve(directory, folder), { withFileTypes: true });
  if (items.some(item => item.isFile() && /^\.(?:real|live)docs-manifest\.json$/.test(item.name))) return result;
  for (const item of items) {
    if (item.name.startsWith('.') || ignored.has(item.name)) continue;
    const path = posix.join(folder, item.name);
    if (item.isDirectory()) result.push(...paths(directory, path));
    else if (item.isFile()) result.push(path);
  }
  return result;
}

function within(folder: string, path: string): boolean {
  return folder === '.' || path.startsWith(`${folder}/`);
}

function inside(path: string): boolean {
  return !posix.isAbsolute(path) && path !== '..' && !path.startsWith('../');
}

function sourceEntry(path: string): boolean {
  return sourceFile.test(path) && !testFile.test(path) && !toolingFile.test(path);
}

export function discoverConfig(directory: string): Config {
  const files = paths(directory).sort();
  const known = new Set(files);
  const candidates = new Map<string, Candidate>();
  const at = (path: string): Candidate => {
    const candidate = candidates.get(path) ?? { path };
    candidates.set(path, candidate);
    return candidate;
  };
  const configPaths = new Set(files.filter(file => configFile.test(posix.basename(file))));
  const configInputs = new Map<string, Record<string, unknown>>();
  for (const config of configPaths) {
    const data = record(ts.readConfigFile(resolve(directory, config), ts.sys.readFile).config);
    if (data && (Array.isArray(data.files) || Array.isArray(data.include))) configInputs.set(config, data);
    for (const reference of Array.isArray(data?.references) ? data.references : []) {
      const path = record(reference)?.path;
      if (typeof path !== 'string') continue;
      const target = posix.join(posix.dirname(config), path);
      const file = target.endsWith('.json') ? target : posix.join(target, 'tsconfig.json');
      if (known.has(file)) configPaths.add(file);
    }
    at(posix.dirname(config)).config ??= config;
  }

  // Framework metadata is a discovery hint. Later commands only use realdocs.json.
  const nest = record(packageInfo(resolve(directory, 'nest-cli.json'))?.projects);
  for (const [id, value] of Object.entries(nest ?? {})) {
    const project = record(value);
    if (typeof project?.root !== 'string') continue;
    const root = posix.normalize(project.root);
    if (!inside(root)) continue;
    const candidate = at(root);
    candidate.id = id;
    const compiler = record(project.compilerOptions)?.tsConfigPath;
    if (typeof compiler === 'string' && known.has(posix.normalize(compiler))) candidate.config = posix.normalize(compiler);
    if (typeof project.entryFile !== 'string') continue;
    const sourceRoot = typeof project.sourceRoot === 'string' ? project.sourceRoot : posix.join(root, 'src');
    const entry = posix.join(sourceRoot, project.entryFile);
    candidate.entry = known.has(entry) && sourceFile.test(entry) ? entry
      : ['.ts', '.tsx', '.js', '.mts', '.cts', '.mjs', '.cjs'].map(suffix => `${entry}${suffix}`).find(file => known.has(file));
  }

  for (const file of files) {
    const folder = posix.dirname(file);
    const name = posix.basename(file);
    if (name === 'package.json' || (folder === '.' && entryName.test(name))) at(folder);
    if (posix.basename(folder) === 'src' && entryName.test(name)) at(posix.dirname(folder));
  }

  const sources = new Map<string, string[]>();
  for (const file of files) {
    if (!sourceEntry(file)) continue;
    const folder = posix.dirname(file);
    const owner = candidates.has(folder) ? folder : posix.basename(folder) === 'src' && candidates.has(posix.dirname(folder))
      ? posix.dirname(folder) : undefined;
    if (!owner) continue;
    const entries = sources.get(owner) ?? [];
    entries.push(file);
    sources.set(owner, entries);
  }

  const sections = new Map<string, NonNullable<Config['sections']>[string]>();
  const byFolder = new Map<string, NonNullable<Config['sections']>[string]>();
  for (const candidate of [...candidates.values()].sort((a, b) => a.path < b.path ? -1 : a.path > b.path ? 1 : 0)) {
    const { path, config, entry } = candidate;
    const pkg = packageInfo(resolve(directory, path, 'package.json'));
    const name = typeof pkg?.name === 'string' && pkg.name.trim() ? pkg.name.trim() : basename(resolve(directory, path));
    const local = sources.get(path) ?? [];
    const selected = local.filter(file => entryName.test(posix.basename(file)) || /\.module\.[jt]s$/i.test(file));
    if (entry) selected.push(entry);
    if (typeof pkg?.main === 'string') {
      const main = posix.join(path, pkg.main);
      if (known.has(main) && sourceFile.test(main)) selected.push(main);
    }
    const inputs = config && configInputs.get(config);
    if (!selected.length && config && inputs) {
      const absoluteConfig = resolve(directory, config);
      const parsed = ts.parseJsonConfigFileContent(inputs, ts.sys, resolve(directory, path), undefined, absoluteConfig);
      const nested = [...candidates.keys()].filter(other => other !== path && within(path, other));
      for (const file of parsed.fileNames.map(file => projectPath(directory, file))) {
        if (known.has(file) && within(path, file) && sourceEntry(file) &&
            !nested.some(other => within(other, file))) selected.push(file);
      }
    }
    const entries = [...new Set(selected.length ? selected : local)].sort();
    if (!entries.length) continue;
    const base = (candidate.id ?? name).toLowerCase().replace(/[^a-z0-9_-]+/g, '-').replace(/^[^a-z0-9]+|[-_]+$/g, '') || 'project';
    let id = base;
    for (let suffix = 2; sections.has(id); suffix++) id = `${base}-${suffix}`;
    const project = config ?? candidates.get('.')?.config;
    const section = { title: typeof pkg?.name === 'string' ? name : (candidate.id ?? name), ...(project && { project }), entries };
    sections.set(id, section);
    byFolder.set(path, section);
  }

  const pages: string[] = [];
  const folders = [...byFolder.keys()].filter(path => path !== '.').sort((a, b) => b.length - a.length);
  for (const file of files.filter(file => /\.md$/i.test(file) && !agentInstructions.test(posix.basename(file)))) {
    const owner = folders.find(folder => within(folder, file));
    if (!owner) pages.push(file);
    else (byFolder.get(owner)!.pages ??= []).push(file);
  }
  if (!sections.size && !pages.length) throw new Error('No source entries or Markdown pages found. Run init from the directory you want to document.');
  return { ...(pages.length ? { pages } : {}), ...(sections.size ? { sections: Object.fromEntries(sections) } : {}) };
}

export function initialize(directory: string, print: boolean): void {
  const config = discoverConfig(directory);
  const json = `${JSON.stringify(config, null, 2)}\n`;
  if (print) {
    process.stdout.write(json);
    return;
  }
  try {
    writeFileSync(resolve(directory, configName), json, { flag: 'wx' });
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'EEXIST') throw new Error(`${configName} already exists. Use init --print to preview discovery.`);
    throw error;
  }
  const sections = Object.values(config.sections ?? {});
  const count = (config.pages?.length ?? 0) + sections.reduce((sum, section) => sum + (section.pages?.length ?? 0), 0);
  console.log(`Created ${configName} with ${sections.length} section(s) and ${count} Markdown page(s).`);
  for (const section of sections) console.log(`  ${section.title}: ${section.entries?.join(', ')}`);
}
