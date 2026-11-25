import {
  existsSync, linkSync, lstatSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, renameSync, rmdirSync,
  rmSync, unlinkSync, writeFileSync,
} from 'node:fs';
import { basename, dirname, join } from 'node:path';

// Preserve the manifest and lock names so older builds can share the same output directory.
const manifest = '.livedocs-manifest.json';
const lockSuffix = '.livedocs-lock';

function lockOwner(lock: string): number | undefined {
  try {
    const pid = Number(readFileSync(join(lock, 'pid'), 'utf8'));
    if (Number.isSafeInteger(pid) && pid > 0) return pid;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
  }
}

function stopped(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return false;
  } catch (error) {
    return (error as NodeJS.ErrnoException).code === 'ESRCH';
  }
}

function keepBackup(backup: string, directory: string): void {
  const saved = mkdtempSync(join(dirname(directory), '.realdocs-recovered-'));
  renameSync(backup, join(saved, 'wiki'));
  console.warn(`warning: Previous output was preserved in ${join(saved, 'wiki')}.`);
}

function acquireLock(lock: string, directory: string): void {
  const busy = () => new Error(`Another build holds the output lock ${lock}.`);
  try {
    mkdirSync(lock);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error;
    const pid = lockOwner(lock);
    if (pid === undefined || !stopped(pid)) throw busy();
    const recovery = join(lock, 'recovering');
    try {
      mkdirSync(recovery);
    } catch (error) {
      if (['ENOENT', 'EEXIST'].includes((error as NodeJS.ErrnoException).code ?? '')) throw busy();
      throw error;
    }
    // Lock paths can be reused by another writer between reading the owner and claiming recovery.
    try {
      if (lockOwner(lock) !== pid) throw busy();
      const backup = join(lock, 'previous');
      if (existsSync(backup)) {
        if (existsSync(directory)) keepBackup(backup, directory);
        else renameSync(backup, directory);
      }
      const reclaimed = mkdtempSync(join(dirname(lock), '.realdocs-reclaimed-'));
      try {
        renameSync(lock, join(reclaimed, 'lock'));
      } finally {
        rmSync(reclaimed, { recursive: true, force: true });
      }
    } catch (error) {
      rmdirSync(recovery);
      throw error;
    }
    // Another writer may have acquired the path once recovery released it.
    acquireLock(lock, directory);
    return;
  }
  try {
    writeFileSync(join(lock, 'pid'), String(process.pid));
  } catch (error) {
    rmdirSync(lock);
    throw error;
  }
}

function managedFiles(directory: string): Set<string> {
  if (!existsSync(directory)) return new Set();
  const reject = () => new Error(`The output directory ${directory} contains files RealDocs does not manage. Choose a dedicated output directory.`);
  if (!lstatSync(directory).isDirectory()) throw reject();
  if (!readdirSync(directory).length) return new Set();

  let paths: unknown;
  try {
    const marker = join(directory, manifest);
    if (!lstatSync(marker).isFile()) throw reject();
    const stored = JSON.parse(readFileSync(marker, 'utf8'));
    if (stored.version === 1) paths = stored.files;
  } catch {
    throw reject();
  }
  if (!Array.isArray(paths) || !paths.every(file => typeof file === 'string')) throw reject();
  const previous = new Set<string>();
  const declared = new Set(paths);

  function inspect(folder: string, prefix = ''): void {
    for (const entry of readdirSync(folder, { withFileTypes: true })) {
      const name = `${prefix}${entry.name}`;
      if (name === manifest) continue;
      if (entry.isDirectory()) inspect(join(folder, entry.name), `${name}/`);
      else if (entry.isFile() && declared.has(name)) previous.add(name);
      else throw reject();
    }
  }
  inspect(directory);
  return previous;
}

function removeOldPages(directory: string, paths: ReadonlySet<string>, prefix = ''): void {
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const name = `${prefix}${entry.name}`;
    const file = join(directory, entry.name);
    if (entry.isDirectory()) {
      removeOldPages(file, paths, `${name}/`);
      if (!readdirSync(file).length) rmdirSync(file);
    } else if (entry.isFile() && (paths.has(name) || name === manifest)) {
      unlinkSync(file);
    }
  }
}

export const releaseManifestName = 'release.json';

export function writeWiki(directory: string, files: ReadonlyMap<string, string>): number {
  const parent = dirname(directory);
  mkdirSync(parent, { recursive: true });
  const lock = join(parent, `.${basename(directory)}${lockSuffix}`);
  acquireLock(lock, directory);

  const next = join(lock, 'next');
  const backup = join(lock, 'previous');
  try {
    const previous = managedFiles(directory);
    const unchanged = new Set<string>();
    for (const [file, content] of files) {
      if (previous.has(file) && readFileSync(join(directory, file), 'utf8') === content) unchanged.add(file);
    }
    if (unchanged.size === files.size && previous.size === files.size) return 0;
    if (previous.size && (previous.has(releaseManifestName) || files.has(releaseManifestName))) {
      throw new Error(`Release output at ${directory} is immutable. Choose a new version or empty output directory.`);
    }

    for (const [file, content] of files) {
      const target = join(next, file);
      mkdirSync(dirname(target), { recursive: true });
      if (unchanged.has(file)) linkSync(join(directory, file), target);
      else writeFileSync(target, content, { flag: 'wx' });
    }
    writeFileSync(join(next, manifest), JSON.stringify({ version: 1, files: [...files.keys()] }, null, 2) + '\n');

    const hadOutput = existsSync(directory);
    if (hadOutput) renameSync(directory, backup);
    try {
      if (hadOutput) managedFiles(backup);
      renameSync(next, directory);
    } catch (error) {
      if (hadOutput) renameSync(backup, directory);
      throw error;
    }
    if (hadOutput) {
      removeOldPages(backup, previous);
      if (readdirSync(backup).length) keepBackup(backup, directory);
      else rmdirSync(backup);
    }
    return files.size - unchanged.size;
  } finally {
    // An unsuccessful rollback must leave the previous output available for recovery.
    if (!existsSync(backup)) rmSync(lock, { recursive: true });
  }
}
