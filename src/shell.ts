import { createRequire } from 'node:module';
import { posix } from 'node:path';
import { crumbsFor, encodeHrefComponent, href, type PageContext } from './markdown.js';
import type { Documentation, NavItem, SiteMap } from './model.js';

const require = createRequire(import.meta.url);
const version = (require('../package.json') as { version: string }).version;

export const bootstrapStyle = 'assets/bootstrap.min.css';
export const bootstrapScript = 'assets/bootstrap.bundle.min.js';

const entities: Record<string, string> = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };

export function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, char => entities[char]);
}

function link(from: string, to: string): string {
  return escapeHtml(href(from, to) || encodeHrefComponent(posix.basename(to)));
}

/** Layout styles for the shell. Content styles stay with the HTML renderer. */
export const shellStyle = `
  :root[data-bs-theme="dark"] {
    --bs-body-bg: var(--wiki-page);
    --bs-body-color: var(--wiki-ink);
    --bs-emphasis-color: var(--wiki-ink);
    --bs-heading-color: var(--wiki-ink);
    --bs-secondary-color: var(--wiki-muted);
    --bs-tertiary-bg: var(--wiki-surface);
    --bs-border-color: var(--wiki-line);
    --bs-link-color: var(--wiki-accent);
    --bs-link-color-rgb: 166, 223, 195;
    --bs-link-hover-color: var(--wiki-ink);
    --bs-link-hover-color-rgb: 232, 239, 233;
    --bs-code-color: #e9c98f;
    --bs-body-font-family: system-ui, sans-serif;
    --bs-body-line-height: 1.65;
    --wiki-header-height: 3.5rem;
  }
  body { min-height: 100vh; display: flex; flex-direction: column }
  .wiki-skip { position: absolute; z-index: 1100; inset-inline-start: 1rem; top: .5rem; padding: .4rem .8rem; background: var(--wiki-surface) }
  .wiki-header { position: sticky; top: 0; z-index: 1030; min-height: var(--wiki-header-height); background: var(--wiki-surface); border-bottom: 1px solid var(--wiki-line) }
  .wiki-header .navbar-brand { font-family: var(--wiki-heading); color: var(--wiki-ink); min-width: 0; overflow: hidden; text-overflow: ellipsis }
  .wiki-header .nav-link { color: var(--wiki-muted) }
  .wiki-header .nav-link:hover { color: var(--wiki-ink) }
  .wiki-toggle { border: 1px solid var(--wiki-line); border-radius: var(--wiki-radius); background: none; color: var(--wiki-ink); padding: .2rem .6rem; margin-inline-end: .5rem }
  .wiki-layout { flex: 1; display: block }
  .wiki-sidebar { --bs-offcanvas-bg: var(--wiki-page); --bs-offcanvas-width: min(22rem, 88vw) }
  .wiki-sidebar .offcanvas-body { padding: 1rem .75rem 2rem }
  @media (min-width: 992px) {
    .wiki-layout { display: grid; grid-template-columns: minmax(15rem, 19rem) minmax(0, 1fr) }
    .wiki-sidebar { position: sticky; top: var(--wiki-header-height); height: calc(100vh - var(--wiki-header-height)); overflow-y: auto; border-inline-end: 1px solid var(--wiki-line) }
  }
  .wiki-tree, .wiki-tree ul { list-style: none; margin: 0; padding: 0 }
  .wiki-tree ul { margin-inline-start: .45rem; padding-inline-start: .55rem; border-inline-start: 1px solid var(--wiki-line) }
  .wiki-tree a { display: block; padding: .18rem .45rem; border-radius: .3rem; color: var(--wiki-muted); text-decoration: none; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; font-size: .92rem }
  .wiki-tree a:hover { color: var(--wiki-ink); background: var(--wiki-surface) }
  .wiki-tree a[aria-current="page"] { color: var(--wiki-accent); background: var(--wiki-surface); font-weight: 600 }
  .wiki-tree summary { display: flex; align-items: center; list-style: none; cursor: pointer }
  .wiki-tree summary::-webkit-details-marker { display: none }
  .wiki-tree summary::before { content: '▸'; flex: none; width: 1rem; color: var(--wiki-muted); transition: transform .15s }
  .wiki-tree details[open] > summary::before { transform: rotate(90deg) }
  .wiki-tree summary > a { flex: 1; min-width: 0; color: var(--wiki-ink) }
  .wiki-tree > li > details > summary > a { font-weight: 600 }
  .wiki-tree > li > a { color: var(--wiki-ink); padding-inline-start: 1.45rem }
  .wiki-content { min-width: 0; padding: clamp(1.25rem, 3.5vw, 2.75rem); overflow-wrap: anywhere }
  .wiki-content > :not(.file-map) { max-width: 84ch }
  .wiki-content .breadcrumb { --bs-breadcrumb-divider: '›'; --bs-breadcrumb-margin-bottom: 1.5rem; font-size: .9rem }
  /* Bootstrap's reboot floats and enlarges legends; the file map filters expect plain ones. */
  .file-map legend { float: none; width: auto; margin: 0; font-size: inherit; line-height: inherit }
  .wiki-footer { padding: 1rem clamp(1.25rem, 3.5vw, 2.75rem); border-top: 1px solid var(--wiki-line); color: var(--wiki-muted); font-size: .85rem }
`;

function isOpen(node: NavItem, open: ReadonlySet<string>): boolean {
  return node.kind === 'group' && open.has(node.file);
}

/** The navigation tree as nested lists; the current page's branch is open and the page is marked. */
export function renderSidebar(site: SiteMap, file: string): string {
  const open = new Set([file, ...crumbsFor(site, file).map(crumb => crumb.file)]);
  const current = (target: string) => target === file ? ' aria-current="page"' : '';
  const item = (node: NavItem): string => {
    const label = escapeHtml(node.label);
    if (node.kind === 'page') return `<li><a href="${link(file, node.file)}"${current(node.file)} title="${label}">${label}</a></li>`;
    const children = node.children.map(item).join('\n');
    return `<li><details${isOpen(node, open) ? ' open' : ''}>
<summary><a href="${link(file, node.file)}"${current(node.file)}>${label}</a></summary>
${children ? `<ul>\n${children}\n</ul>` : ''}
</details></li>`;
  };
  return `<ul class="wiki-tree">
<li><a href="${link(file, site.home)}"${current(site.home)}>Home</a></li>
${site.tree.map(item).join('\n')}
</ul>`;
}

export interface ShellOptions {
  page: PageContext;
  content: string;
  head: string;
  documentation: Documentation;
  hasTags: boolean;
}

export function renderShell({ page, content, head, documentation, hasTags }: ShellOptions): string {
  const { file } = page;
  const site: SiteMap = documentation.site ?? { home: 'index.html', routes: {}, tree: [] };
  const project = documentation.navigation?.title ?? 'Project documentation';
  const title = file === site.home ? project : `${page.title} · ${project}`;
  const source = documentation.navigation?.sourceUrl ?? documentation.release?.repository;
  const links = [
    hasTags ? `<li class="nav-item"><a class="nav-link" href="${link(file, 'tags.html')}">Tags</a></li>` : '',
    documentation.fileGraph ? `<li class="nav-item"><a class="nav-link" href="${link(file, 'file-map.html')}">File map</a></li>` : '',
    source ? `<li class="nav-item"><a class="nav-link" href="${escapeHtml(source)}">Source ↗</a></li>` : '',
  ].filter(Boolean).join('\n');
  const crumbs = page.crumbs.length ? `<nav aria-label="breadcrumb">
<ol class="breadcrumb">
${page.crumbs.map(crumb => `<li class="breadcrumb-item"><a href="${link(file, crumb.file)}">${escapeHtml(crumb.label)}</a></li>`).join('\n')}
<li class="breadcrumb-item active" aria-current="page">${escapeHtml(page.title)}</li>
</ol>
</nav>
` : '';
  const { release } = documentation;
  const footer = [escapeHtml(project), release ? `${escapeHtml(release.version)} (${release.commit.slice(0, 7)})` : '', `Generated by RealDocs ${version}`]
    .filter(Boolean).join(' · ');
  return `<!doctype html>
<html lang="en" data-bs-theme="dark">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>${escapeHtml(title)}</title>
  <link rel="stylesheet" href="${link(file, bootstrapStyle)}">
  <style>${shellStyle}</style>
  <script defer src="${link(file, bootstrapScript)}"></script>${head}
</head>
<body>
<a class="wiki-skip visually-hidden-focusable" href="#content">Skip to content</a>
<header class="wiki-header navbar navbar-expand px-3">
  <button class="wiki-toggle d-lg-none" type="button" data-bs-toggle="offcanvas" data-bs-target="#wiki-sidebar" aria-controls="wiki-sidebar" aria-label="Show navigation">☰</button>
  <a class="navbar-brand" href="${link(file, site.home)}">${escapeHtml(project)}</a>
  ${links ? `<ul class="navbar-nav ms-auto">\n${links}\n</ul>` : ''}
</header>
<div class="wiki-layout">
<nav id="wiki-sidebar" class="wiki-sidebar offcanvas-lg offcanvas-start" tabindex="-1" aria-label="Documentation">
<div class="offcanvas-header d-lg-none">
  <span class="offcanvas-title">${escapeHtml(project)}</span>
  <button type="button" class="btn-close" data-bs-dismiss="offcanvas" data-bs-target="#wiki-sidebar" aria-label="Close navigation"></button>
</div>
<div class="offcanvas-body d-block">
${renderSidebar(site, file)}
</div>
</nav>
<main id="content" class="wiki-content">
${crumbs}${content}</main>
</div>
<footer class="wiki-footer">${footer}</footer>
</body>
</html>
`;
}
