import { dirname, isAbsolute, relative, resolve, sep } from 'node:path';
import { performance } from 'node:perf_hooks';
import ts from 'typescript';
import type { Diagnostic, SourceLocation } from './model.js';

export interface Project {
  directory: string;
  entries: string[];
  pages: string[];
  config?: string;
}

export const standaloneOptions: ts.CompilerOptions = {
  target: ts.ScriptTarget.ES2022,
  module: ts.ModuleKind.NodeNext,
  strict: true,
  types: [],
};

export function projectPath(directory: string, file: string): string {
  return relative(directory, file).split(sep).join('/');
}

export function sourceLocation(directory: string, file: ts.SourceFile, offset: number): SourceLocation {
  const { line, character } = file.getLineAndCharacterOfPosition(offset);
  return { file: projectPath(directory, file.fileName), line: line + 1, column: character + 1 };
}

export function compilerDiagnostic(directory: string, diagnostic: ts.Diagnostic): Diagnostic {
  return {
    level: diagnostic.category === ts.DiagnosticCategory.Error ? 'error' : 'warning',
    message: ts.flattenDiagnosticMessageText(diagnostic.messageText, '\n'),
    location: diagnostic.file && diagnostic.start !== undefined
      ? sourceLocation(directory, diagnostic.file, diagnostic.start)
      : undefined,
  };
}

function inputPaths(cwd: string, directory: string, names: string[], extension: RegExp, description: string): string[] {
  const paths = [...new Set(names.map(name => resolve(cwd, name)))];
  for (const path of paths) {
    const local = relative(directory, path);
    if (local === '..' || local.startsWith(`..${sep}`) || isAbsolute(local) || !extension.test(path)) {
      throw new Error(`Expected ${description} inside the project directory: ${path}`);
    }
  }
  return paths;
}

export function defaultCompilerConfig(directory: string): string | undefined {
  return ['tsconfig.json', 'jsconfig.json'].map(file => resolve(directory, file)).find(ts.sys.fileExists);
}

export function projectFromArguments(cwd: string, entries: string[], configPath?: string, pages: string[] = []): Project {
  const config = configPath ? resolve(cwd, configPath) : defaultCompilerConfig(cwd);
  const directory = config ? dirname(config) : cwd;
  return {
    directory,
    entries: inputPaths(cwd, directory, entries, /\.(?:[jt]sx?|[cm][jt]s)$/i, 'a JS/TS entry file').sort(),
    pages: inputPaths(cwd, directory, pages, /\.md$/i, 'a Markdown page'),
    config,
  };
}

function compilerOptions(options: ts.CompilerOptions): ts.CompilerOptions {
  // TypeScript 6 can still resolve legacy baseUrl aliases once the deprecation is acknowledged.
  const ignoreDeprecations = options.ignoreDeprecations ?? (options.baseUrl && ts.versionMajorMinor.startsWith('6.') ? '6.0' : undefined);
  return { ...options, ignoreDeprecations, allowJs: options.allowJs ?? true, noEmit: true };
}

function rootNames(project: Project, configured: readonly string[] = []): string[] {
  const declarations = configured.filter(file => /\.d\.[cm]?ts$/i.test(file));
  return [...new Set([...project.entries, ...declarations])];
}

function configDiagnostics(diagnostics: readonly ts.Diagnostic[]): ts.Diagnostic[] {
  // The CLI supplies its own entry files, including for configs without inputs.
  return diagnostics.filter(item => item.code !== 18002 && item.code !== 18003);
}

export function createProgram(project: Project): ts.Program {
  if (!project.config) return ts.createProgram(project.entries, compilerOptions(standaloneOptions));

  const parsed = ts.getParsedCommandLineOfConfigFile(project.config, {}, {
    ...ts.sys,
    onUnRecoverableConfigFileDiagnostic: diagnostic => {
      throw new Error(compilerDiagnostic(project.directory, diagnostic).message);
    },
  });
  if (!parsed) throw new Error(`Could not read project configuration ${project.config}`);
  return ts.createProgram({
    rootNames: rootNames(project, parsed.fileNames),
    options: compilerOptions(parsed.options),
    projectReferences: parsed.projectReferences,
    configFileParsingDiagnostics: configDiagnostics(parsed.errors),
  });
}

export function watchProject(
  project: Project,
  rebuild: (program: ts.Program, started: number) => void,
  report: (diagnostic: Diagnostic) => void,
): void {
  const builder = ts.createSemanticDiagnosticsBuilderProgram;
  const reportConfig = (diagnostic: ts.Diagnostic): void => report(compilerDiagnostic(project.directory, diagnostic));
  const host = project.config
    ? ts.createWatchCompilerHost(project.config, {}, ts.sys, builder, reportConfig, () => {})
    : ts.createWatchCompilerHost(project.entries, standaloneOptions, ts.sys, builder, reportConfig, () => {});
  const create = host.createProgram;
  let started = performance.now();
  host.jsDocParsingMode = ts.JSDocParsingMode.ParseAll;
  host.createProgram = (files, options, compiler, previous, diagnostics, references) => {
    started = performance.now();
    return create(rootNames(project, files), compilerOptions(options ?? standaloneOptions), compiler, previous,
      configDiagnostics(diagnostics ?? []), references);
  };
  host.afterProgramCreate = next => rebuild(next.getProgram(), started);
  if ('configFileName' in host) ts.createWatchProgram(host);
  else ts.createWatchProgram(host);
}
