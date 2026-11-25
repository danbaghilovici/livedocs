import { isBuiltin } from 'node:module';
import { resolve } from 'node:path';
import ts from 'typescript';
import { normalizeTagLabels, type Diagnostic, type DocPart, type DocTag, type Documentation, type FileGraph, type FileRelation, type MarkdownContent, type SourceLocation } from './model.js';
import { compilerDiagnostic, projectPath, sourceLocation, type Project } from './project.js';

interface Export {
  name: string;
  symbol: ts.Symbol;
  declaration: ts.Declaration;
  id: string;
  typeAlias?: ts.ExportSpecifier;
  assignment?: boolean;
}

const printer = ts.createPrinter({ removeComments: true, newLine: ts.NewLineKind.LineFeed });
const typeFormat = ts.TypeFormatFlags.NoTruncation | ts.TypeFormatFlags.UseAliasDefinedOutsideCurrentScope;

function declarationKey(file: string, start: number): string {
  return `${resolve(file)}:${start}`;
}

function printed(node: ts.Node): string {
  return printer.printNode(ts.EmitHint.Unspecified, node, node.getSourceFile()).trim();
}

function classShape(declaration: ts.ClassDeclaration, checker: ts.TypeChecker): string[] {
  const members = declaration.members.filter(member =>
    !(ts.getCombinedModifierFlags(member) & ts.ModifierFlags.NonPublicAccessibilityModifier) &&
    !(member.name && ts.isPrivateIdentifier(member.name)));
  const constructorOverloads = members.some(member => ts.isConstructorDeclaration(member) && !member.body);
  const result: string[] = [];
  for (const member of members) {
    if (ts.isConstructorDeclaration(member)) {
      if (!member.body || !constructorOverloads) result.push(`constructor(${member.parameters.map(printed).join(', ')});`);
      continue;
    }
    const flags = ts.getCombinedModifierFlags(member);
    const prefix = `${flags & ts.ModifierFlags.Static ? 'static ' : ''}${flags & ts.ModifierFlags.Abstract ? 'abstract ' : ''}`;
    if (ts.isMethodDeclaration(member)) {
      const declarationSymbol = checker.getSymbolAtLocation(member.name);
      const hasOverloads = declarationSymbol?.declarations?.some(node => ts.isMethodDeclaration(node) && !node.body);
      if (member.body && hasOverloads) continue;
      const signature = checker.getSignatureFromDeclaration(member);
      if (signature) result.push(`${prefix}${printed(member.name)}${member.questionToken ? '?' : ''}${checker.signatureToString(signature, member, typeFormat)};`);
    } else if (ts.isPropertyDeclaration(member) || ts.isGetAccessorDeclaration(member)) {
      const type = checker.typeToString(checker.getTypeAtLocation(member), member, typeFormat);
      const readonly = ts.isPropertyDeclaration(member) && flags & ts.ModifierFlags.Readonly ? 'readonly ' : '';
      const optional = ts.isPropertyDeclaration(member) && member.questionToken ? '?' : '';
      if (ts.isGetAccessorDeclaration(member)) result.push(`${prefix}get ${printed(member.name)}(): ${type};`);
      else result.push(`${prefix}${readonly}${printed(member.name)}${optional}: ${type};`);
    } else if (ts.isSetAccessorDeclaration(member)) {
      result.push(`${prefix}set ${printed(member.name)}(${member.parameters.map(printed).join(', ')});`);
    } else if (ts.isIndexSignatureDeclaration(member)) {
      result.push(printed(member));
    }
  }
  return result;
}

function signatures(entry: Export, checker: ts.TypeChecker): string[] {
  const { name, declaration, symbol } = entry;
  const type = checker.getTypeOfSymbolAtLocation(symbol, declaration);
  if (entry.typeAlias) {
    const { name, propertyName } = entry.typeAlias;
    return [`export type { ${propertyName ? `${printed(propertyName)} as ` : ''}${printed(name)} }`];
  }
  if (entry.assignment) return [`${name}: ${checker.typeToString(type, declaration, typeFormat)}`];
  if (symbol.flags & ts.SymbolFlags.Function) {
    const prefix = name === 'default' ? 'export default function' : `export function ${name}`;
    return type.getCallSignatures().map(signature =>
      `${prefix}${checker.signatureToString(signature, declaration, typeFormat)}`);
  }

  if (ts.isClassDeclaration(declaration)) {
    const typeParameters = declaration.typeParameters?.map(printed).join(', ');
    const heritage = declaration.heritageClauses?.map(printed).join(' ');
    const defaultName = declaration.name ? ` ${declaration.name.text}` : '';
    const keyword = ts.getCombinedModifierFlags(declaration) & ts.ModifierFlags.Abstract ? 'abstract class' : 'class';
    const prefix = name === 'default' ? `export default ${keyword}${defaultName}` : `export ${keyword} ${name}`;
    const heading = `${prefix}${typeParameters ? `<${typeParameters}>` : ''}${heritage ? ` ${heritage}` : ''}`;
    const members = classShape(declaration, checker);
    return [members.length ? `${heading} {\n${members.map(member => `  ${member}`).join('\n')}\n}` : `${heading} {}`];
  }

  if (ts.isInterfaceDeclaration(declaration) || ts.isTypeAliasDeclaration(declaration) || ts.isEnumDeclaration(declaration)) {
    const declarations = symbol.declarations?.filter(node => node.kind === declaration.kind) ?? [declaration];
    const snippets = declarations.map(printed);
    if (name !== symbol.getName()) snippets.push(`export { ${symbol.getName()} as ${name} };`);
    return snippets;
  }

  if (ts.isModuleDeclaration(declaration)) return [`export namespace ${name}`];

  if (name === 'default') return [`export default ${checker.typeToString(type, declaration, typeFormat)}`];

  let keyword = 'const';
  if (ts.isVariableDeclaration(declaration) && ts.isVariableDeclarationList(declaration.parent)) {
    if (declaration.parent.flags & ts.NodeFlags.Let) keyword = 'let';
    else if (!(declaration.parent.flags & ts.NodeFlags.Const)) keyword = 'var';
  }
  return [`export ${keyword} ${name}: ${checker.typeToString(type, declaration, typeFormat)}`];
}

function readLink(
  parts: readonly ts.SymbolDisplayPart[],
  code: boolean,
  lookup: ReadonlyMap<string, string>,
  warn: (message: string) => void,
): DocPart {
  const name = parts.find(part => part.kind === 'linkName') as ts.JSDocLinkDisplayPart | undefined;
  const label = parts.find(part => part.kind === 'linkText')?.text.trim();
  if (name) {
    const target = lookup.get(declarationKey(name.target.fileName, name.target.textSpan.start));
    if (!target) warn(`JSDoc link target ${name.text} is outside the documented exports.`);
    return { text: label || name.text, code, link: target ? { symbol: target } : undefined };
  }

  const [target, ...words] = (label ?? '').split(/\s+/);
  if (/^https?:\/\//i.test(target)) {
    try {
      return { text: words.join(' ') || target, code, link: { url: new URL(target).href } };
    } catch {
      // Fall through to the unresolved-link diagnostic.
    }
  }
  warn(`Could not resolve JSDoc link ${target || '(empty link)'}.`);
  return { text: words.join(' ') || target, code };
}

function docParts(
  parts: readonly ts.SymbolDisplayPart[],
  lookup: ReadonlyMap<string, string>,
  warn: (message: string) => void,
): DocPart[] {
  const result: DocPart[] = [];
  for (let index = 0; index < parts.length; index++) {
    const part = parts[index];
    if (part.kind !== 'link' || !part.text.startsWith('{@')) {
      result.push({ text: part.text });
      continue;
    }
    let end = index + 1;
    while (end < parts.length && parts[end].kind !== 'link') end++;
    result.push(readLink(parts.slice(index + 1, end), part.text.startsWith('{@linkcode '), lookup, warn));
    index = end;
  }
  return result;
}

function docTags(
  entry: Export,
  checker: ts.TypeChecker,
  lookup: ReadonlyMap<string, string>,
  warn: (message: string, node?: ts.Node) => void,
): DocTag[] {
  const { symbol, declaration } = entry;
  const type = checker.getTypeOfSymbolAtLocation(symbol, declaration);
  const calls = type.getCallSignatures();
  const parameters = new Set(calls.flatMap(signature => signature.getParameters().map(param => param.getName())));
  const destructured = calls.some(signature => signature.getDeclaration()?.parameters.some(param => !ts.isIdentifier(param.name)));
  const jsDocTags = ts.getJSDocTags(declaration);
  const result: DocTag[] = [];

  for (const tag of symbol.getJsDocTags(checker)) {
    if (!['param', 'return', 'returns', 'throws', 'exception', 'example', 'deprecated', 'see', 'remarks'].includes(tag.name)) continue;
    const [first, ...rest] = tag.text ?? [];
    const parameter = tag.name === 'param' && first?.kind === 'parameterName' ? first.text : undefined;
    const body = docParts(parameter ? rest : tag.text ?? [], lookup, warn);
    if (parameter && calls.length && !destructured && !parameters.has(parameter.split('.')[0])) {
      const tagNode = jsDocTags.find(node => ts.isJSDocParameterTag(node) && node.name.getText() === parameter);
      warn(`@param ${parameter} does not match a parameter of ${entry.name}.`, tagNode);
    }
    result.push({ name: tag.name, body, parameter });
  }
  return result;
}

function unresolvedModules(program: ts.Program, checker: ts.TypeChecker, project: Project): Diagnostic[] {
  const diagnostics: Diagnostic[] = [];
  const options = program.getCompilerOptions();
  const cache = ts.createModuleResolutionCache(program.getCurrentDirectory(), file => file, options);
  for (const file of program.getSourceFiles()) {
    if (file.isDeclarationFile || program.isSourceFileFromExternalLibrary(file)) continue;
    for (const statement of file.statements) {
      if (!ts.isImportDeclaration(statement) && !ts.isExportDeclaration(statement)) continue;
      const module = statement.moduleSpecifier;
      if (!module || !ts.isStringLiteral(module)) continue;
      const moduleSymbol = checker.getSymbolAtLocation(module);
      if (!moduleSymbol && !isBuiltin(module.text) && !ts.resolveModuleName(module.text, file.fileName, options, ts.sys, cache,
        undefined, program.getModeForUsageLocation(file, module)).resolvedModule) {
        diagnostics.push({
          level: 'error',
          message: `Could not resolve module ${module.text}.`,
          location: sourceLocation(project.directory, file, module.getStart(file)),
        });
      }
      if (!moduleSymbol || !ts.isImportDeclaration(statement)) continue;
      const bindings = statement.importClause?.namedBindings;
      if (!bindings || !ts.isNamedImports(bindings)) continue;
      for (const specifier of bindings.elements) {
        const binding = checker.getSymbolAtLocation(specifier.name);
        if (!binding || checker.getAliasedSymbol(binding).declarations) continue;
        const imported = specifier.propertyName ?? specifier.name;
        diagnostics.push({
          level: 'error',
          message: `Module ${module.text} does not export ${imported.text}.`,
          location: sourceLocation(project.directory, file, imported.getStart(file)),
        });
      }
    }
  }
  return diagnostics;
}

function realdocsTags(tags: readonly ts.JSDocTag[] = []) {
  return tags.flatMap(node => {
    const namespace = node.tagName.text;
    if (namespace !== 'realdocs' && namespace !== 'livedocs') return [];
    if (node.getSourceFile().text[node.tagName.end] !== ':') return [];

    // TypeScript parses the namespace as the tag name and the suffix as comment text.
    const text = ts.getTextOfJSDocComment(node.comment) ?? '';
    const suffix = /^:([a-zA-Z][a-zA-Z0-9]*)(?=\s|$)/.exec(text);
    if (!suffix) return [];
    return [{ name: suffix[1], value: text.slice(suffix[0].length).trim(), bodyStart: node.tagName.end + suffix[0].length, node }];
  });
}

function tagLabelsFrom(tags: ReturnType<typeof realdocsTags>): string[] {
  return normalizeTagLabels(tags.filter(tag => tag.name === 'tag').map(tag => tag.value));
}

function symbolReferences(
  annotations: ReturnType<typeof realdocsTags>,
  error: (message: string, node: ts.Node) => void,
): { docId?: string; docUses?: string[] } {
  let docId: string | undefined;
  const uses = new Set<string>();
  const relationships = annotations.filter(tag => tag.name === 'docUses');
  for (const { name, value, node } of annotations) {
    if (name !== 'docId' && name !== 'docUses') continue;
    if (!/^[a-zA-Z][a-zA-Z0-9._-]*$/.test(value)) {
      error(`Invalid @realdocs:${name} identifier ${JSON.stringify(value)}. Use a letter followed by letters, digits, dots, hyphens, or underscores.`, node);
      continue;
    }
    if (name === 'docUses') uses.add(value);
    else if (docId && docId !== value) error(`A symbol can have only one @realdocs:docId. Found ${docId} and ${value}.`, node);
    else docId = value;
  }
  if (!docId && uses.size) error('Declare @realdocs:docId on a symbol with @realdocs:docUses.', relationships[0].node);
  return { docId, docUses: uses.size ? [...uses].sort() : undefined };
}

function fileOverview(file: ts.SourceFile): MarkdownContent | undefined {
  for (const range of ts.getLeadingCommentRanges(file.text, 0) ?? []) {
    if (range.kind !== ts.SyntaxKind.MultiLineCommentTrivia) continue;
    const comment = file.text.slice(range.pos, range.end);
    if (!comment.startsWith('/**') || !/@(?:realdocs|livedocs):file/.test(comment)) continue;

    // Parse the header by itself so a separate comment on the first declaration can coexist with it.
    const header = ts.createSourceFile(file.fileName, comment, {
      languageVersion: file.languageVersion,
      jsDocParsingMode: ts.JSDocParsingMode.ParseAll,
    }, true);
    const block = ts.getJSDocCommentsAndTags(header.endOfFileToken).find(ts.isJSDoc);
    const annotations = realdocsTags(block?.tags);
    const tag = annotations.find(item => item.name === 'file');
    if (!tag) continue;

    // The parsed JSDoc text trims indentation, which can change fenced Markdown content.
    const start = tag.node.getStart(header);
    const margin = comment.slice(comment.lastIndexOf('\n', start) + 1, start);
    const body = comment.slice(tag.bodyStart, Math.min(tag.node.end, comment.length - 2)).replace(/\r\n?/g, '\n');
    const text = /^[ \t]+$/.test(margin) ? body.replaceAll(`\n${margin}`, '\n') : body.replace(/\n[ \t]*\*[ \t]?/g, '\n');
    const leadingLines = text.match(/^\s*/)?.[0].split('\n').length ?? 1;
    return {
      markdown: text.trim(),
      sourceLine: file.getLineAndCharacterOfPosition(range.pos + start).line + leadingLines,
      tagLabels: tagLabelsFrom(annotations),
      zone: annotations.find(item => item.name === 'zone')?.value || undefined,
    };
  }
}

function extractFileGraph(program: ts.Program, project: Project, checker: ts.TypeChecker, modules: Documentation['modules']): FileGraph {
  const documented = new Map(modules.map(module => [module.name, module.overview]));
  const files = new Set(program.getSourceFiles().filter(file => {
    const path = projectPath(project.directory, file.fileName);
    return !path.startsWith('../') && path !== '..' && !path.split('/').includes('node_modules') &&
      !program.isSourceFileDefaultLibrary(file) && !program.isSourceFileFromExternalLibrary(file);
  }));
  const graph: FileGraph = { nodes: [], edges: [] };
  for (const file of files) {
    const source = projectPath(project.directory, file.fileName);
    const overview = documented.has(source) ? documented.get(source) : fileOverview(file);
    graph.nodes.push({ path: source, kind: 'code', zone: overview?.zone, documented: documented.has(source) });
    for (const statement of file.statements) {
      let specifier: ts.Expression | undefined;
      let kind: FileRelation;
      if (ts.isImportDeclaration(statement)) {
        specifier = statement.moduleSpecifier;
        const clause = statement.importClause;
        const bindings = clause?.namedBindings;
        const onlyTypes = !clause?.name && bindings && ts.isNamedImports(bindings) &&
          bindings.elements.length > 0 && bindings.elements.every(item => item.isTypeOnly);
        kind = clause?.isTypeOnly || onlyTypes ? 'type-only' : 'import';
      } else if (ts.isExportDeclaration(statement)) {
        specifier = statement.moduleSpecifier;
        const clause = statement.exportClause;
        const onlyTypes = clause && ts.isNamedExports(clause) && clause.elements.length > 0 && clause.elements.every(item => item.isTypeOnly);
        kind = statement.isTypeOnly || onlyTypes ? 'type-only' : 're-export';
      } else if (ts.isImportEqualsDeclaration(statement) && ts.isExternalModuleReference(statement.moduleReference)) {
        specifier = statement.moduleReference.expression;
        kind = statement.isTypeOnly ? 'type-only' : 'import';
      } else {
        continue;
      }
      if (!specifier || !ts.isStringLiteral(specifier)) continue;
      const target = checker.getSymbolAtLocation(specifier)?.declarations?.find(ts.isSourceFile);
      if (target && files.has(target)) graph.edges.push({ source, target: projectPath(project.directory, target.fileName), kind });
    }
  }
  return graph;
}

export function extractDocumentation(program: ts.Program, project: Project, withGraph = false): Documentation {
  const diagnostics = [
    ...program.getConfigFileParsingDiagnostics(),
    ...program.getOptionsDiagnostics(),
    ...program.getSyntacticDiagnostics(),
  ].map(item => compilerDiagnostic(project.directory, item));
  if (diagnostics.some(item => item.level === 'error')) return { modules: [], diagnostics };

  const checker = program.getTypeChecker();
  diagnostics.push(...unresolvedModules(program, checker, project));
  const lookup = new Map<string, string>();
  const primary = new Set<string>();
  const exportsByFile = new Map<ts.SourceFile, Export[]>();

  for (const entry of project.entries) {
    const file = program.getSourceFile(entry);
    if (!file) {
      diagnostics.push({ level: 'error', message: `Could not read entry file ${projectPath(project.directory, entry)}.` });
      continue;
    }
    const entries: Export[] = [];
    exportsByFile.set(file, entries);
    const module = checker.getSymbolAtLocation(file);
    if (!module) continue;

    const exported = [...checker.getExportsOfModule(module)];
    const assignment = module.exports?.get(ts.InternalSymbolName.ExportEquals);
    if (assignment && !exported.includes(assignment)) exported.push(assignment);
    exported.sort((a, b) => a.name < b.name ? -1 : a.name > b.name ? 1 : 0);
    for (const exposed of exported) {
      const name = exposed === assignment ? (file.fileName.endsWith('.cts') || file.fileName.endsWith('.ts') ? 'export =' : 'module.exports') : exposed.getName();
      const symbol = exposed.flags & ts.SymbolFlags.Alias ? checker.getAliasedSymbol(exposed) : exposed;
      const declaration = symbol.valueDeclaration ?? symbol.declarations?.[0];
      if (!declaration) {
        const alias = exposed.declarations?.[0];
        diagnostics.push({
          level: 'error',
          message: `Could not resolve export ${name}.`,
          location: sourceLocation(project.directory, alias?.getSourceFile() ?? file, alias?.getStart() ?? 0),
        });
        continue;
      }

      const id = JSON.stringify([projectPath(project.directory, file.fileName), name]);
      const alias = exposed.declarations?.find(ts.isExportSpecifier);
      const typeAlias = alias && (alias.isTypeOnly || alias.parent.parent.isTypeOnly) ? alias : undefined;
      entries.push({ name, symbol, declaration, id, typeAlias, assignment: exposed === assignment });
      const declaredInEntry = file === declaration.getSourceFile() && name === symbol.getName();
      for (const node of symbol.declarations ?? [declaration]) {
        const key = declarationKey(node.getSourceFile().fileName, node.getStart());
        if (!lookup.has(key) || (declaredInEntry && !primary.has(key))) lookup.set(key, id);
        if (declaredInEntry) primary.add(key);
      }
    }
  }

  const modules = [...exportsByFile].map(([file, entries]) => ({
    name: projectPath(project.directory, file.fileName),
    language: /\.[cm]?jsx?$/i.test(file.fileName) ? 'javascript' : 'typescript',
    overview: fileOverview(file),
    symbols: entries.map(entry => {
      const locate = (node: ts.Node): SourceLocation => sourceLocation(project.directory, node.getSourceFile(), node.getStart());
      const location = locate(entry.declaration);
      const warn = (message: string, node?: ts.Node): void => {
        diagnostics.push({ level: 'warning', message, location: node ? locate(node) : location });
      };
      const tags = (entry.symbol.declarations ?? [entry.declaration]).flatMap(declaration => ts.getJSDocTags(declaration));
      const annotations = realdocsTags(tags).filter(({ node }) => !ts.isJSDoc(node.parent) ||
        !realdocsTags(node.parent.tags).some(item => item.name === 'file'));
      const key = declarationKey(entry.declaration.getSourceFile().fileName, entry.declaration.getStart());
      const references = lookup.get(key) === entry.id ? symbolReferences(annotations, (message, node) => {
        diagnostics.push({ level: 'error', message, location: locate(node) });
      }) : {};
      return {
        id: entry.id,
        name: entry.name,
        signatures: signatures(entry, checker),
        description: docParts(entry.symbol.getDocumentationComment(checker), lookup, warn),
        tags: docTags(entry, checker, lookup, warn),
        tagLabels: tagLabelsFrom(annotations),
        ...references,
        location,
      };
    }),
  }));
  return { modules, diagnostics, fileGraph: withGraph ? extractFileGraph(program, project, checker, modules) : undefined };
}
