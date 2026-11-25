#!/usr/bin/env node
import { watchFile } from 'node:fs';
import { resolve } from 'node:path';
import { performance } from 'node:perf_hooks';
import { parseArgs } from 'node:util';
import type ts from 'typescript';
import { compileDiagrams } from './diagrams.js';
import { renderMarkdownGraph } from './graph.js';
import { renderWiki, type PageExtension } from './markdown.js';
import type { Diagnostic, Documentation } from './model.js';
import { writeWiki } from './output.js';
import { createProgram, projectFromArguments, watchProject, type Project } from './project.js';
import { extractDocumentation } from './typescript.js';

const defaultOutput = 'dist/realdocs';

const help = `Usage: realdocs <build|check|watch> [--entry <file>] [--page <file>] [options]

  build             Generate the documentation wiki.
  check             Validate source, JSDoc references, and wiki links.
  watch             Regenerate the wiki as input files change.

  --entry <file>    JS/TS entry point. Repeat for more than one.
  --page <file>     Standalone Markdown page. Repeat for more than one.
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
  strict?: boolean;
  timings?: boolean;
}

function document(extractedCode: Documentation, project: Project, options: RunOptions, started: number): boolean {
  const inputs = options.includePages?.(extractedCode, project, options.extension) ?? extractedCode;
  const documentation = compileDiagrams(inputs, options.extension);
  const extracted = performance.now();
  for (const diagnostic of documentation.diagnostics) report(diagnostic);
  if (documentation.diagnostics.some(item => item.level === 'error' || options.strict)) return false;

  if (options.check) {
    const pages = documentation.pages?.length ? ` and ${documentation.pages.length} Markdown page(s)` : '';
    console.log(`Checked ${documentation.modules.length} module(s)${pages}.`);
    if (options.timings) console.log(`Compiler and extraction ${Math.round(extracted - started)} ms.`);
    return true;
  }

  const html = options.renderHtml?.(documentation);
  const files = html?.files ?? renderWiki(documentation, 'md', undefined,
    documentation.fileGraph ? renderMarkdownGraph(documentation) : undefined);
  const pages = html?.pages ?? files.size;
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
  if (positionals.length !== 1 || !['build', 'check', 'watch'].includes(command) || (!values.entry?.length && !values.page?.length)) {
    throw new Error('Pass build, check, or watch and at least one --entry or --page file. Run realdocs --help for usage.');
  }
  const format = values.format ?? 'markdown';
  if (format !== 'markdown' && format !== 'html') throw new Error(`Unknown output format ${format}. Use markdown or html.`);

  const cwd = process.cwd();
  const project = projectFromArguments(cwd, values.entry ?? [], values.project, values.page);
  const options: RunOptions = {
    check: command === 'check',
    output: resolve(cwd, values.out ?? defaultOutput),
    extension: format === 'html' ? 'html' : 'md',
    graph: values.graph ?? false,
    renderHtml: format === 'html' && command !== 'check' ? (await import('./html.js')).renderHtmlWiki : undefined,
    includePages: project.pages.length || values.graph ? (await import('./pages.js')).includePages : undefined,
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
  if (project.entries.length) code = extractDocumentation(createProgram(project), project, options.graph);
  if (!document(code, project, options, started)) process.exitCode = 1;
}

try {
  await main();
} catch (error) {
  reportError(error);
  process.exitCode = 1;
}
