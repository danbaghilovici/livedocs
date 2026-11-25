import { git } from './git.js';
import { fileRelationships } from './graph.js';
import { wikiPath, type PageExtension } from './markdown.js';
import type { Documentation } from './model.js';
import { projectPath, type Project } from './project.js';

interface Change {
  path: string;
  status: 'added' | 'modified' | 'deleted';
}

export function changesSince(directory: string, ref: string): { base: string; changes: Change[] } {
  let base: string;
  try {
    base = git(directory, 'rev-parse', '--verify', '--end-of-options', `${ref}^{commit}`).trim();
  } catch {
    throw new Error(`Could not resolve Git base ${JSON.stringify(ref)}. Run diff in a Git checkout and select a commit, tag, or branch.`);
  }
  // Keep both sides of a rename so a selected input at the old path is visible.
  const tracked = git(directory, 'diff', '--relative', '--no-renames', '--name-status', '-z', base, '--', '.').split('\0');
  const changes = new Map<string, Change['status']>();
  for (let i = 0; i + 1 < tracked.length && tracked[i + 1]; i += 2) {
    changes.set(tracked[i + 1], tracked[i] === 'A' ? 'added' : tracked[i] === 'D' ? 'deleted' : 'modified');
  }
  for (const path of git(directory, 'ls-files', '--others', '--exclude-standard', '-z', '--', '.').split('\0')) {
    if (path && !changes.has(path)) changes.set(path, 'added');
  }
  return { base, changes: [...changes.keys()].sort().map(path => ({ path, status: changes.get(path)! })) };
}

export function reportImpact(
  input: ReturnType<typeof changesSince>,
  documentation: Documentation,
  project: Project,
  entries: readonly string[],
  configPaths: readonly string[],
  extension: PageExtension,
  json: boolean,
): void {
  const targets = new Map<string, 'modules' | 'pages'>();
  for (const file of entries) targets.set(projectPath(project.directory, file), 'modules');
  for (const file of project.pages) targets.set(projectPath(project.directory, file), 'pages');

  const reverse = new Map<string, Set<string>>();
  const depend = (source: string, target: string): void => {
    if (source === target) return;
    const dependents = reverse.get(target) ?? new Set<string>();
    dependents.add(source);
    reverse.set(target, dependents);
  };
  for (const { source, target } of fileRelationships(documentation)) depend(source, target);
  for (const module of documentation.modules) {
    for (const symbol of module.symbols) depend(module.name, symbol.location.file);
  }

  const globalInputs = new Set(['realdocs.json', 'package.json', 'tsconfig.json', 'jsconfig.json',
    ...configPaths.map(path => projectPath(project.directory, path))]);
  const impacts = new Map<string, string[]>();
  for (const { path } of input.changes) {
    const related = new Set([path]);
    if (globalInputs.has(path)) for (const target of targets.keys()) related.add(target);
    for (const source of related) {
      for (const dependent of reverse.get(source) ?? []) related.add(dependent);
      if (!targets.has(source)) continue;
      const reasons = impacts.get(source) ?? [];
      reasons.push(path);
      impacts.set(source, reasons);
    }
  }
  const affected = [...impacts.keys()].sort().map(path => ({
    input: path, page: wikiPath(path, targets.get(path)!, extension), reasons: impacts.get(path)!,
  }));

  if (json) console.log(JSON.stringify({ ...input, affected }, null, 2));
  else {
    console.log(`Compared with ${input.base.slice(0, 12)}. ${input.changes.length} changed file(s), ${affected.length} affected documentation page(s).`);
    for (const { page, reasons } of affected) console.log(`  ${page} (${reasons.join(', ')})`);
  }
}
