import { posix } from 'node:path';
import { wikiPath, type PageExtension } from './markdown.js';
import type { Diagnostic, Documentation, DocumentationSection, MarkdownContent, NavGroup, NavPage, Route, SiteMap } from './model.js';

/** Top-level output names RealDocs writes itself, so no category may use them. */
export const reservedSlugs: readonly string[] = ['assets', 'pages', 'modules', 'sections', 'tags', 'index', 'file-map'];

const natural = new Intl.Collator(undefined, { numeric: true });

export function slugify(text: string): string {
  return text.normalize('NFC').toLowerCase().replace(/[^\p{L}\p{N}._-]+/gu, '-').replace(/^-+|-+$/g, '');
}

/** A path segment as authors wrote it, or a readable form of a plain slug such as `category-c`. */
export function segmentLabel(segment: string): string {
  const text = segment.trim();
  if (/[\p{Lu}\s]/u.test(text)) return text;
  const words = slugify(text).replaceAll('-', ' ');
  return words.charAt(0).toUpperCase() + words.slice(1);
}

/** Matches site-relative paths against a glob with `*`, `**`, and `?`. */
export function globToRegExp(pattern: string): RegExp {
  const glob = posix.normalize(pattern);
  let source = '';
  for (let index = 0; index < glob.length; index++) {
    const char = glob[index];
    if (char === '*' && glob[index + 1] === '*') {
      index++;
      if (glob[index + 1] === '/') {
        index++;
        source += '(?:.*/)?';
      } else source += '.*';
    } else if (char === '*') source += '[^/]*';
    else if (char === '?') source += '[^/]';
    else source += char.replace(/[\\^$.|+()[\]{}]/g, '\\$&');
  }
  return new RegExp(`^${source}$`);
}

/** The folders of a glob before its first wildcard segment. */
export function staticPrefix(pattern: string): string {
  const segments = posix.normalize(pattern).split('/');
  segments.pop();
  const wildcard = segments.findIndex(segment => /[*?]/.test(segment));
  return (wildcard === -1 ? segments : segments.slice(0, wildcard)).join('/');
}

interface Input {
  source: string;
  kind: 'pages' | 'modules';
  label: string;
  content?: MarkdownContent;
}

interface Placement {
  input: Input;
  category: string;
  slug: string;
  groups: string[];
  name: string;
}

function segments(path: string | undefined): string[] {
  return (path ?? '').split('/').map(segment => segment.trim()).filter(Boolean);
}

/**
 * Decides where every page and entry is written and builds the navigation tree. Placement comes from
 * in-file annotations, then the first categorized section that lists the file, then the first matching
 * rule. Unplaced inputs keep their source-mirroring URL.
 */
export function placeDocumentation(documentation: Documentation, extension: PageExtension): Documentation {
  const diagnostics: Diagnostic[] = [...documentation.diagnostics];
  const navigation = documentation.navigation;
  const sections = navigation?.sections ?? [];
  const rules = (navigation?.rules ?? []).map(rule => ({ ...rule, match: globToRegExp(rule.pattern), prefix: staticPrefix(rule.pattern) }));
  const error = (message: string, file?: string): void => {
    diagnostics.push({ level: 'error', message, ...(file && { location: { file, line: 1, column: 1 } }) });
  };

  const inputs: Input[] = [
    ...(documentation.pages ?? []).map(page => ({ source: page.name, kind: 'pages' as const, label: page.title, content: page })),
    ...documentation.modules.map(module => ({
      source: module.name, kind: 'modules' as const, label: posix.basename(module.name), content: module.overview,
    })),
  ].sort((a, b) => natural.compare(a.source, b.source));
  const pages = documentation.pages ?? [];
  const homeSource = navigation?.home ?? (pages.some(page => page.name === 'README.md') ? 'README.md' : undefined);
  const home = `index.${extension}`;
  const routes: Record<string, Route> = {};
  const placements: Placement[] = [];
  const unplaced: Input[] = [];

  for (const input of inputs) {
    const { source, content } = input;
    if (source === homeSource) {
      routes[source] = { file: home };
      continue;
    }
    const section = sections.find(item => item.category && (item.entries.includes(source) || item.pages.includes(source)));
    const rule = rules.find(item => item.match.test(source));
    const category = content?.category ?? section?.category ?? rule?.category;
    if (!category) {
      routes[source] = { file: wikiPath(source, input.kind, extension) };
      unplaced.push(input);
      continue;
    }
    let groups: string[];
    if (content?.path !== undefined || content?.category !== undefined) groups = segments(content.path).slice(0, -1);
    else if (section) groups = segments(section.group ?? section.id);
    else {
      const folder = posix.dirname(source);
      const relative = rule!.prefix ? posix.relative(rule!.prefix, folder) : folder === '.' ? '' : folder;
      groups = [...segments(rule!.group), ...segments(relative)];
    }
    const basename = posix.basename(source);
    const name = content?.path !== undefined ? segments(content.path).at(-1) ?? ''
      : /^(?:readme|index)\.md$/i.test(basename) ? 'index'
      : input.kind === 'pages' ? basename.replace(/\.md$/i, '') : basename;

    const slug = slugify(category);
    const unusable = [category, ...groups, name].find(text => !slugify(text));
    if (unusable !== undefined) {
      error(`"${unusable}" has no letters or digits to use in a URL.`, source);
      continue;
    }
    if (reservedSlugs.includes(slug)) {
      error(`Category "${category.trim()}" uses the reserved name ${slug}.`, source);
      continue;
    }
    placements.push({ input, category: category.trim(), slug, groups, name: slugify(name) });
  }

  // Categories merge by slug; a configured label wins, then the first source that names it.
  const labels = new Map<string, string>();
  for (const label of navigation?.categories ?? []) if (!labels.has(slugify(label))) labels.set(slugify(label), label);
  for (const placement of placements) if (!labels.has(placement.slug)) labels.set(placement.slug, placement.category);

  const owners = new Map<string, string>();
  const groupsByKey = new Map<string, NavGroup>();
  const overrides = navigation?.groups ?? {};
  const usedOverrides = new Set<string>();
  const group = (path: string[], label: string): NavGroup => {
    const key = path.join('/');
    let node = groupsByKey.get(key);
    if (!node) {
      usedOverrides.add(key);
      node = { kind: 'group', label: overrides[key] ?? label, key, file: `${key}/index.${extension}`, children: [] };
      groupsByKey.set(key, node);
      if (path.length > 1) group(path.slice(0, -1), segmentLabel(path.at(-2)!)).children.push(node);
    }
    return node;
  };
  const categoryGroups = new Map<string, NavGroup>();
  const categoryGroup = (slug: string): NavGroup => {
    const node = group([slug], labels.get(slug)!);
    categoryGroups.set(slug, node);
    return node;
  };
  // Section landing pages exist even when every file in the section is placed elsewhere.
  for (const section of sections) {
    if (!section.category) continue;
    const slug = slugify(section.category);
    if (!slugify(section.category) || reservedSlugs.includes(slug) || segments(section.group ?? section.id).some(text => !slugify(text))) continue;
    if (!labels.has(slug)) labels.set(slug, section.category);
    categoryGroup(slug);
    const path = [slug, ...segments(section.group ?? section.id).map(slugify)];
    // Intermediate groups get labels from their segments; the section's own group is named after it.
    for (let depth = 2; depth < path.length; depth++) group(path.slice(0, depth), segmentLabel(segments(section.group ?? section.id)[depth - 2]));
    const node = group(path, section.title);
    node.section ??= section.id;
  }

  for (const placement of placements) {
    const { input, slug, groups, name } = placement;
    categoryGroup(slug);
    for (let depth = 0; depth < groups.length; depth++) {
      group([slug, ...groups.slice(0, depth + 1).map(slugify)], segmentLabel(groups[depth]));
    }
    const parent = group([slug, ...groups.map(slugify)], segmentLabel(groups.at(-1) ?? labels.get(slug)!));
    const file = name === 'index' ? parent.file : `${parent.key}/${name}.${extension}`;
    const owner = owners.get(file);
    if (owner) {
      error(`Pages ${owner} and ${input.source} both resolve to ${file}.`, input.source);
      continue;
    }
    owners.set(file, input.source);
    routes[input.source] = { file, category: labels.get(slug) };
    if (name === 'index') parent.index = input.source;
    else parent.children.push({ kind: 'page', label: input.label, file, source: input.source, code: input.kind === 'modules' } satisfies NavPage);
  }

  const order = (node: NavGroup): void => {
    const groups = node.children.filter((child): child is NavGroup => child.kind === 'group').sort((a, b) => natural.compare(a.key, b.key));
    const leaves = node.children.filter((child): child is NavPage => child.kind === 'page').sort((a, b) => natural.compare(a.file, b.file));
    node.children = [...groups, ...leaves];
    for (const child of groups) order(child);
  };
  const configured = (navigation?.categories ?? []).map(slugify);
  const tree = [...categoryGroups.values()].sort((a, b) => {
    const left = configured.indexOf(a.key);
    const right = configured.indexOf(b.key);
    if (left !== right) return left === -1 ? 1 : right === -1 ? -1 : left - right;
    return natural.compare(a.label, b.label);
  });
  for (const node of tree) order(node);

  // Uncategorized sections and inputs keep today's URLs under two generated groups.
  const page = (input: Input): NavPage => ({
    kind: 'page', label: input.label, file: routes[input.source].file, source: input.source, code: input.kind === 'modules',
  });
  const unplacedBySource = new Map(unplaced.map(input => [input.source, input]));
  const listed = new Set<string>();
  const sectionGroups: NavGroup[] = [];
  for (const section of sections) {
    if (section.category) continue;
    const members = [...section.pages, ...section.entries].flatMap(source => {
      const input = unplacedBySource.get(source);
      return input ? [input] : [];
    });
    for (const input of members) listed.add(input.source);
    const key = `sections/${section.id}`;
    usedOverrides.add(key);
    sectionGroups.push({
      kind: 'group', label: overrides[key] ?? section.title, key, file: `${key}/index.${extension}`, section: section.id,
      children: members.map(page).sort((a, b) => natural.compare(a.file, b.file)),
    });
  }
  const loose = (kind: Input['kind']) => unplaced.filter(input => input.kind === kind && !listed.has(input.source)).map(page);
  const code = [...sectionGroups, ...loose('modules')];
  if (code.length) tree.push({ kind: 'group', label: 'Code reference', key: 'sections', file: `sections/index.${extension}`, children: code });
  const others = loose('pages');
  if (others.length) tree.push({ kind: 'group', label: 'Other pages', key: 'pages', file: `pages/index.${extension}`, children: others });
  for (const synthetic of tree.filter(node => node.key === 'sections' || node.key === 'pages')) {
    const clash = Object.entries(routes).find(([, route]) => route.file === synthetic.file);
    if (clash) error(`Page ${clash[0]} resolves to ${synthetic.file}, which is the ${synthetic.label} index.`, clash[0]);
  }

  for (const key of Object.keys(overrides)) {
    if (!usedOverrides.has(key)) diagnostics.push({ level: 'warning', message: `groups key ${key} matches no group.` });
  }
  for (const label of navigation?.categories ?? []) {
    if (!categoryGroups.has(slugify(label))) diagnostics.push({ level: 'warning', message: `categories entry ${label} is not used by any page.` });
  }

  const site: SiteMap = { home, ...(homeSource && { homeSource }), routes, tree };
  return { ...documentation, diagnostics, site };
}
