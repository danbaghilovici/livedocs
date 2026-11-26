#!/usr/bin/env node
import { existsSync, watchFile } from 'node:fs';
import { resolve } from 'node:path';
import { performance } from 'node:perf_hooks';
import { parseArgs } from 'node:util';
import type ts from 'typescript';
import { configName, readSite } from './config.js';
import { compileDiagrams } from './diagrams.js';
import { renderMarkdownGraph } from './graph.js';
import { renderWiki, type PageExtension } from './markdown.js';
import { placeDocumentation } from './navigation.js';
import type { Diagnostic, Documentation } from './model.js';
import { releaseManifestName, writeWiki } from './output.js';
import { createProgram, projectFromArguments, watchProject, type Project } from './project.js';
import { extractDocumentation, extractDocumentations } from './typescript.js';

const defaultOutput = 'dist/realdocs';

const help = `Usage: realdocs <build|check|diff|watch> [--entry <file>] [--page <file>] [options]
       realdocs init [--print]
       realdocs install-skill [--skills-dir <dir>] [--instructions-file <file>]

  init              Discover source entries and guides and write realdocs.json.
  install-skill     Install the bundled RealDocs skills for project agents.
  build             Generate the documentation wiki.
  check             Validate source, JSDoc references, and wiki links.
  diff              Report documentation affected by changes since a Git revision.
  watch             Regenerate the wiki as input files change.

  --entry <file>    JS/TS entry point. Repeat for more than one.
  --page <file>     Standalone Markdown page. Repeat for more than one.
  --print           Show the detected config without writing it (init only).
  --skills-dir <dir>  Agent skills directory. Defaults to .agents/skills (install-skill only).
  --instructions-file <file>  Add the documentation maintenance rule to this file (install-skill only).
  --base <ref>       Git commit, tag, or branch to compare against (required by diff).
  --json            Emit a JSON impact report (diff only).
  --version <name>  Build an immutable wiki pinned to the checked-out commit (build only).
  --project <file>  tsconfig.json or jsconfig.json. Defaults to the config in the current directory.
  --out <dir>       Dedicated output directory. Defaults to ${defaultOutput}.
  --format <type>   Output format, markdown (default) or html.
  --graph           Add a file map with relationship types and zones.
  --strict          Treat documentation warnings as build failures.
  --timings         Report compiler, rendering and output timings.
  --help            Show usage.
`;

function report(diagnostic: Diagnostic): void {
  const { location, level, message } = diagnostic;
  const where = location ? `${location.file}:${location.line}:${location.column}: ` : '';
  console.error(`${where}${level}: ${message}`);
}

function reportError(error: unknown): void {
  report({ level: 'error', message: error instanceof Error ? error.message : String(error) });
}

interface RunOptions {
  check: boolean;
  output: string;
  extension: PageExtension;
  graph: boolean;
  renderHtml?: typeof import('./html.js').renderHtmlWiki;
  includePages?: typeof import('./pages.js').includePages;
  releaseManifest?: (documentation: Documentation, files: ReadonlyMap<string, string>) => string;
  strict?: boolean;
  timings?: boolean;
}

function prepareDocumentation(extractedCode: Documentation, project: Project, options: RunOptions): Documentation {
  const inputs = options.includePages?.(extractedCode, project, options.extension) ?? placeDocumentation(extractedCode, options.extension);
  return compileDiagrams(inputs, options.extension);
}

function validate(documentation: Documentation, strict?: boolean): boolean {
  for (const diagnostic of documentation.diagnostics) report(diagnostic);
  return !documentation.diagnostics.some(item => item.level === 'error' || strict);
}

function document(extractedCode: Documentation, project: Project, options: RunOptions, started: number): boolean {
  const documentation = prepareDocumentation(extractedCode, project, options);
  const extracted = performance.now();
  if (!validate(documentation, options.strict)) return false;

  if (options.check) {
    const pages = documentation.pages?.length ? ` and ${documentation.pages.length} Markdown page(s)` : '';
    console.log(`Checked ${documentation.modules.length} module(s)${pages}.`);
    if (options.timings) console.log(`Compiler and extraction ${Math.round(extracted - started)} ms.`);
    return true;
  }

  const html = options.renderHtml?.(documentation);
  const files = html?.files ?? renderWiki(documentation, 'md', undefined,
    documentation.fileGraph ? (file, section) => renderMarkdownGraph(documentation, file, section) : undefined);
  const pages = html?.pages ?? files.size;
  if (options.releaseManifest) files.set(releaseManifestName, options.releaseManifest(documentation, files));
  const assets = files.size - pages;
  const rendered = performance.now();
  const changed = writeWiki(options.output, files);
  const withAssets = assets ? ` and ${assets} asset(s)` : '';
  console.log(`Generated ${pages} wiki page(s)${withAssets} in ${options.output} (${changed} written).`);
  if (options.timings) {
    console.log(`Compiler and extraction ${Math.round(extracted - started)} ms, ${html ? 'HTML' : 'Markdown'} ${Math.round(rendered - extracted)} ms, output ${Math.round(performance.now() - rendered)} ms.`);
  }
  return true;
}

async function main(): Promise<void> {
  const { positionals, values } = parseArgs({
    allowPositionals: true,
    options: {
      entry: { type: 'string', multiple: true },
      page: { type: 'string', multiple: true },
      print: { type: 'boolean' },
      'skills-dir': { type: 'string' },
      'instructions-file': { type: 'string' },
      base: { type: 'string' },
      json: { type: 'boolean' },
      version: { type: 'string' },
      project: { type: 'string' },
      out: { type: 'string' },
      format: { type: 'string' },
      graph: { type: 'boolean' },
      strict: { type: 'boolean' },
      timings: { type: 'boolean' },
      help: { type: 'boolean', short: 'h' },
    },
  });
  if (values.help || !process.argv.slice(2).length) {
    console.log(help);
    return;
  }
  const [command] = positionals;
  if (positionals.length !== 1 || !['init', 'install-skill', 'build', 'check', 'diff', 'watch'].includes(command)) {
    throw new Error('Pass init, install-skill, build, check, diff, or watch. Run realdocs --help for usage.');
  }
  const cwd = process.cwd();
  if (command === 'install-skill') {
    const skillsDir = values['skills-dir'] ?? '.agents/skills';
    const instructionsFile = values['instructions-file'];
    if (!skillsDir.trim() || instructionsFile?.trim() === '' ||
        Object.keys(values).some(option => option !== 'skills-dir' && option !== 'instructions-file')) {
      throw new Error('Use realdocs install-skill [--skills-dir <dir>] [--instructions-file <file>].');
    }
    const { installSkills } = await import('./skills.js');
    installSkills(resolve(cwd, skillsDir), instructionsFile && resolve(cwd, instructionsFile));
    return;
  }
  if (values['skills-dir'] !== undefined) throw new Error('--skills-dir is only supported by realdocs install-skill.');
  if (values['instructions-file'] !== undefined) throw new Error('--instructions-file is only supported by realdocs install-skill.');
  if (command === 'init') {
    if (Object.keys(values).some(option => option !== 'print')) throw new Error('Use realdocs init [--print].');
    const { initialize } = await import('./discovery.js');
    initialize(cwd, values.print ?? false);
    return;
  }
  if (values.print) throw new Error('--print is only supported by realdocs init.');
  if (command === 'diff' && !values.base) throw new Error('Use realdocs diff --base <ref>.');
  if (command !== 'diff' && (values.base !== undefined || values.json)) throw new Error('--base and --json are only supported by realdocs diff.');
  if (values.version !== undefined && command !== 'build') throw new Error('--version is only supported by realdocs build.');
  const format = values.format ?? 'markdown';
  if (format !== 'markdown' && format !== 'html') throw new Error(`Unknown output format ${format}. Use markdown or html.`);

  const configPath = resolve(cwd, configName);
  const explicit = values.entry || values.project || (command === 'watch' && values.page);
  const hasConfig = !explicit && existsSync(configPath);
  if (hasConfig && command === 'watch') throw new Error('Use build or check with realdocs.json. Watch requires --entry or --page inputs.');
  const site = hasConfig ? readSite(configPath, values.page ?? []) : undefined;
  if (!site && !values.entry?.length && !values.page?.length) {
    throw new Error(`Provide --entry or --page inputs, or run realdocs init to create ${configName}.`);
  }
  const project = site?.project ?? projectFromArguments(cwd, values.entry ?? [], values.project, values.page);
  const releases = values.version === undefined ? undefined : await import('./release.js');
  const release = releases?.readRelease(project.directory, values.version!);
  const options: RunOptions = {
    check: command === 'check',
    output: resolve(cwd, values.out ?? (release ? `${defaultOutput}-releases/${release.version}` : defaultOutput)),
    extension: format === 'html' ? 'html' : 'md',
    graph: command === 'diff' || (values.graph ?? false),
    renderHtml: format === 'html' && (command === 'build' || command === 'watch') ? (await import('./html.js')).renderHtmlWiki : undefined,
    includePages: site || project.pages.length || values.graph || command === 'diff' ? (await import('./pages.js')).includePages : undefined,
    strict: values.strict,
    timings: values.timings,
  };
  let code: Documentation = { modules: [], diagnostics: [], fileGraph: options.graph ? { nodes: [], edges: [] } : undefined };
  if (command === 'watch') {
    const build = (started: number, program?: ts.Program): void => {
      try {
        if (program) code = extractDocumentation(program, project, options.graph);
        document(code, project, options, started);
      } catch (error) {
        reportError(error);
      }
    };
    if (project.entries.length) watchProject(project, (program, started) => build(started, program), report);
    else build(performance.now());
    let pending: NodeJS.Timeout | undefined;
    for (const file of project.pages) {
      watchFile(file, { interval: 200 }, () => {
        clearTimeout(pending);
        pending = setTimeout(() => {
          try {
            // Code watcher notifications can still be pending when a Markdown save arrives.
            const started = performance.now();
            build(started, project.entries.length ? createProgram(project) : undefined);
          } catch (error) {
            reportError(error);
          }
        }, 50);
      });
    }
    console.log('Watching for source changes.');
    return;
  }
  const started = performance.now();
  const impact = command === 'diff' ? await import('./impact.js') : undefined;
  const changes = impact?.changesSince(project.directory, values.base!);
  const projects = site?.projects ?? (project.entries.length ? [project] : []);
  const compilations = projects.map(project => ({ project, program: createProgram(project) }));
  code = extractDocumentations(compilations, options.graph);
  if (site) {
    const { title, pages, sections, home, categories, groups, rules, sourceUrl } = site;
    code.navigation = { title, pages, sections, home, categories, groups, rules, sourceUrl };
  }
  const compilerConfigs = impact || release ? compilations.flatMap(({ project, program }) => {
    const compilerConfig = program.getCompilerOptions().configFile as ts.TsConfigSourceFile | undefined;
    return [...(project.config ? [project.config] : []), ...(compilerConfig?.extendedSourceFiles ?? [])];
  }) : [];
  const configs = [...(site?.configPaths ?? []), ...compilerConfigs];
  if (impact && changes) {
    const documentation = prepareDocumentation(code, project, options);
    impact.reportImpact(changes, documentation, project, projects.flatMap(project => project.entries), configs, options.extension, values.json ?? false);
    if (!validate(documentation, options.strict)) process.exitCode = 1;
    return;
  }
  if (releases && release) {
    code.release = release;
    const sources = compilations.flatMap(({ program }) => program.getSourceFiles()
      .filter(file => !program.isSourceFileDefaultLibrary(file) && !program.isSourceFileFromExternalLibrary(file))
      .map(file => file.fileName));
    const inputs = [...sources, ...configs, ...project.pages];
    options.releaseManifest = (documentation, files) => releases.releaseManifest(release, documentation, options.extension, inputs, files);
  }
  if (!document(code, project, options, started)) process.exitCode = 1;
}

try {
  await main();
} catch (error) {
  reportError(error);
  process.exitCode = 1;
}
