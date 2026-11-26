import { execFileSync, spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

export const cli = fileURLToPath(new URL('../dist/cli.js', import.meta.url));

export function fixture(t, files) {
  const cwd = mkdtempSync(join(tmpdir(), 'realdocs-test-'));
  t.after(() => rmSync(cwd, { recursive: true, force: true }));
  const write = (file, contents) => {
    mkdirSync(dirname(join(cwd, file)), { recursive: true });
    writeFileSync(join(cwd, file), contents);
  };
  write('package.json', '{"type":"module"}');
  for (const [file, contents] of Object.entries(files)) write(file, contents);

  return {
    cwd,
    write,
    read: file => readFileSync(join(cwd, file), 'utf8'),
    run: (...args) => execFileSync(process.execPath, [cli, ...args], { cwd, encoding: 'utf8', stdio: 'pipe' }),
    result: (...args) => spawnSync(process.execPath, [cli, ...args], { cwd, encoding: 'utf8' }),
    withPreload: (...args) => spawnSync(process.execPath, ['--require', './preload.cjs', cli, ...args], { cwd, encoding: 'utf8' }),
  };
}

