import { createHash } from 'node:crypto';
import { existsSync, readFileSync, realpathSync } from 'node:fs';
import { dirname, isAbsolute, resolve } from 'node:path';
import { git } from './git.js';
import { pageFile, symbolAnchor, type PageExtension } from './markdown.js';
import type { Documentation, Release } from './model.js';
import { projectPath } from './project.js';

export function readRelease(directory: string, version: string): Release {
  if (!/^[a-zA-Z0-9][a-zA-Z0-9._-]*$/.test(version) || version.endsWith('.')) {
    throw new Error('Use a release version with letters, digits, dots, underscores, or hyphens.');
  }
  let root: string;
  let commit: string;
  try {
    root = git(directory, 'rev-parse', '--show-toplevel').trimEnd();
    commit = git(root, 'rev-parse', '--verify', 'HEAD').trim();
  } catch {
    throw new Error('A versioned build requires a Git checkout with a checked-out commit.');
  }
  let repository: string | undefined;
  try {
    const remote = git(root, 'remote', 'get-url', 'origin').trim();
    const name = /^(?:https:\/\/github\.com\/|ssh:\/\/git@github\.com\/|git@github\.com:)([\w.-]+\/[\w.-]+?)(?:\.git)?\/?$/.exec(remote)?.[1];
    if (name) repository = `https://github.com/${name}`;
  } catch {
    // A repository without an origin still has a verifiable commit and local source paths.
  }
  verifyCommit(root, commit);
  const tracked = new Set(git(root, 'ls-files', '-z', '--cached').split('\0'));
  return { version, commit, repository, directory, root, tracked };
}

function verifyCommit(root: string, commit: string): void {
  if (git(root, 'rev-parse', '--verify', 'HEAD').trim() !== commit ||
      git(root, 'diff', '--name-only', '-z', commit, '--')) {
    throw new Error('A versioned build requires a stable commit without uncommitted tracked changes.');
  }
}

const digest = (contents: string | Buffer): string => createHash('sha256').update(contents).digest('hex');

export function releaseManifest(release: Release, documentation: Documentation, extension: PageExtension,
  inputs: readonly string[], files: ReadonlyMap<string, string>): string {
  const { root, directory, version, commit, repository, tracked } = release;
  const paths = new Set(inputs.map(file => resolve(directory, file)));
  for (const file of paths) {
    paths.add(realpathSync(file));
    // Package metadata can affect module resolution and the generated index title.
    for (let parent = dirname(file); ; parent = dirname(parent)) {
      const relative = projectPath(root, parent);
      if (isAbsolute(relative) || relative === '..' || relative.startsWith('../')) break;
      const manifest = resolve(parent, 'package.json');
      if (existsSync(manifest)) paths.add(manifest);
      if (!relative) break;
    }
  }
  const sources: [string, string][] = [];
  for (const file of [...paths].sort()) {
    const path = projectPath(root, file);
    if (isAbsolute(path) || path.startsWith('../') || !tracked.has(path)) {
      throw new Error(`Versioned documentation input ${path} must be tracked in the checked-out commit.`);
    }
    sources.push([path, digest(readFileSync(file))]);
  }
  verifyCommit(root, commit);
  return JSON.stringify({
    schemaVersion: 1, version, commit, repository, format: extension,
    sources: Object.fromEntries(sources),
    symbols: documentation.modules.flatMap(module => module.symbols.map(symbol => ({
      id: symbol.docId ?? symbol.id,
      page: `${pageFile(documentation, module.name, 'modules', extension)}#${symbolAnchor(symbol)}`,
      source: { ...symbol.location, file: projectPath(root, resolve(directory, symbol.location.file)) },
    }))),
    files: Object.fromEntries([...files].map(([name, contents]) => [name, digest(contents)])),
  }, null, 2) + '\n';
}
