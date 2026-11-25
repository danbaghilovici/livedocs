import { constants, copyFileSync, lstatSync, mkdirSync, readFileSync, rmdirSync, writeFileSync } from 'node:fs';
import { basename, dirname, join } from 'node:path';

const skills = ['realdocs-c4', 'realdocs-bootstrap'];
const instructionsTemplate = new URL('../.agents/realdocs-instructions.md', import.meta.url);
const maintenanceStart = '<!-- realdocs:maintenance:start -->';
const maintenanceEnd = '<!-- realdocs:maintenance:end -->';

function installSkill(skillsDirectory: string, skillName: string): string | undefined {
  const bundledSkill = new URL(`../.agents/skills/${skillName}/SKILL.md`, import.meta.url);
  const directory = join(skillsDirectory, skillName);
  const target = join(directory, 'SKILL.md');
  mkdirSync(directory, { recursive: true });
  try {
    copyFileSync(bundledSkill, target, constants.COPYFILE_EXCL);
  } catch (error) {
    if (!(error instanceof Error) || !('code' in error) || error.code !== 'EEXIST') throw error;
    if (lstatSync(target, { throwIfNoEntry: false })?.isFile()
      && readFileSync(target).equals(readFileSync(bundledSkill))) {
      console.log(`${skillName} is already installed at ${target}.`);
      return;
    }
    return `${target} already exists and differs from the bundled skill. Review it before replacing it.`;
  }
  console.log(`Installed ${skillName} at ${target}.`);
}

function installInstructions(target: string): void {
  const template = readFileSync(instructionsTemplate, 'utf8');
  const directory = dirname(target);
  mkdirSync(directory, { recursive: true });
  const lock = join(directory, `.${basename(target)}.realdocs-lock`);
  try {
    mkdirSync(lock);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error;
    throw new Error(`Installation is locked by ${lock}. Retry after the other installer exits, or remove the lock if it was left behind.`);
  }
  try {
    const file = lstatSync(target, { throwIfNoEntry: false });
    if (file && !file.isFile()) throw new Error(`Expected a regular instructions file at ${target}.`);
    const contents = file ? readFileSync(target, 'utf8') : '';
    const start = contents.indexOf(maintenanceStart);
    const end = contents.indexOf(maintenanceEnd);
    if (start >= 0 && end > start) {
      console.log(`RealDocs maintenance instructions are already present in ${target}.`);
      return;
    }
    if (start >= 0 || end >= 0) throw new Error(`Incomplete RealDocs maintenance block in ${target}. Review it before rerunning the installer.`);

    const newline = contents.includes('\r\n') ? '\r\n' : '\n';
    const separator = contents ? newline.repeat(contents.endsWith(newline) ? 1 : 2) : '';
    writeFileSync(target, separator + template.replace(/\n/g, newline), { flag: file ? 'a' : 'wx' });
    console.log(`Added RealDocs maintenance instructions to ${target}.`);
  } finally {
    rmdirSync(lock);
  }
}

export function installSkills(skillsDirectory: string, instructionsFile?: string): void {
  const conflicts: string[] = [];
  for (const name of skills) {
    const conflict = installSkill(skillsDirectory, name);
    if (conflict) conflicts.push(conflict);
  }
  if (instructionsFile) installInstructions(instructionsFile);
  if (conflicts.length) throw new Error(conflicts.join('\n'));
}
