import { execFileSync } from 'node:child_process';

export function git(directory: string, ...args: string[]): string {
  return execFileSync('git', args, { cwd: directory, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], maxBuffer: 16 * 1024 * 1024 });
}
