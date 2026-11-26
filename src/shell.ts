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

/**
 * Bootstrap has no sidebar layout, so the shell adds only what positions it: a sticky, scrolling
 * column below the navbar, and the chevron that turns when a group opens. Colours and type are
 * Bootstrap's defaults.
 */
export const shellStyle = `
  @media (min-width: 992px) {
    .wiki-sidebar { position: sticky; top: 3.5rem; max-height: calc(100vh - 3.5rem); overflow-y: auto }
  }
  .wiki-sidebar .nav-link { padding: .2rem .5rem }
  .wiki-chevron { display: inline-block; transition: transform .15s }
  [aria-expanded="true"] > .wiki-chevron { transform: rotate(90deg) }
`;

/** The navigation tree as Bootstrap nav lists; the current page's branch is expanded and marked. */
export function renderSidebar(site: SiteMap, file: string): string {
  const open = new Set([file, ...crumbsFor(site, file).map(crumb => crumb.file)]);
  let groups = 0;
  const navLink = (target: string, label: string, title = false): string => {
    const current = target === file;
    return `<a class="nav-link${current ? ' active' : ''}" href="${link(file, target)}"${current ? ' aria-current="page"' : ''}${title ? ` title="${label}"` : ''}>${label}</a>`;
  };
  const item = (node: NavItem): string => {
    const label = escapeHtml(node.label);
    if (node.kind === 'page') return `<li class="nav-item">${navLink(node.file, label, true)}</li>`;
    const id = `wiki-nav-${++groups}`;
    const expanded = open.has(node.file);
    const children = node.children.map(item).join('\n');
    return `<li class="nav-item">
<div class="d-flex align-items-center">
<button class="btn btn-sm btn-link px-1 text-body-secondary" type="button" data-bs-toggle="collapse" data-bs-target="#${id}" aria-expanded="${expanded}" aria-controls="${id}"><span class="wiki-chevron" aria-hidden="true">▸</span><span class="visually-hidden">Toggle ${label}</span></button>
${navLink(node.file, label)}
</div>
<div class="${expanded ? 'collapse show' : 'collapse'}" id="${id}">
<ul class="nav nav-pills flex-column ms-3 border-start">
${children}
</ul>
</div>
</li>`;
  };
  return `<ul class="nav nav-pills flex-column">
<li class="nav-item">${navLink(site.home, 'Home')}</li>
${site.tree.map(item).join('\n')}
</ul>`;
}

// Applied in <head> so a saved light choice shows without a dark flash.
const themeLoader = `try { const theme = localStorage.getItem('realdocs-theme'); if (theme === 'light' || theme === 'dark') document.documentElement.dataset.bsTheme = theme; } catch {}`;

// Diagrams and the file map read colours once, so a page that has them reloads after a switch.
const themeSwitcher = `(() => {
  const root = document.documentElement;
  const button = document.getElementById('wiki-theme');
  const sync = () => {
    const dark = root.dataset.bsTheme === 'dark';
    const label = dark ? 'Switch to light theme' : 'Switch to dark theme';
    button.textContent = dark ? '☀' : '☾';
    button.setAttribute('aria-label', label);
    button.title = label;
  };
  sync();
  button.addEventListener('click', () => {
    const theme = root.dataset.bsTheme === 'dark' ? 'light' : 'dark';
    root.dataset.bsTheme = theme;
    try { localStorage.setItem('realdocs-theme', theme); } catch {}
    sync();
    if (document.querySelector('pre > code.language-mermaid, .mermaid-diagram, section.file-map')) location.reload();
  });
})();`;

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
    '<li class="nav-item"><button class="nav-link" id="wiki-theme" type="button" aria-label="Switch to light theme" title="Switch to light theme">☀</button></li>',
  ].join('\n');
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
  <script>${themeLoader}</script>
  <link rel="stylesheet" href="${link(file, bootstrapStyle)}">
  <style>${shellStyle}</style>
  <script defer src="${link(file, bootstrapScript)}"></script>${head}
</head>
<body>
<a class="visually-hidden-focusable position-absolute p-2" href="#content">Skip to content</a>
<header class="navbar navbar-expand bg-body-tertiary border-bottom sticky-top">
<div class="container-fluid">
  <button class="btn btn-outline-secondary btn-sm d-lg-none me-2" type="button" data-bs-toggle="offcanvas" data-bs-target="#wiki-sidebar" aria-controls="wiki-sidebar" aria-label="Show navigation"><span class="navbar-toggler-icon"></span></button>
  <a class="navbar-brand text-truncate" href="${link(file, site.home)}">${escapeHtml(project)}</a>
  <ul class="navbar-nav flex-row gap-3 ms-auto text-nowrap">\n${links}\n</ul>
</div>
</header>
<div class="container-fluid">
<div class="row">
<nav class="col-lg-3 col-xl-2 p-0 border-end" aria-label="Documentation">
<div class="wiki-sidebar offcanvas-lg offcanvas-start" tabindex="-1" id="wiki-sidebar" aria-labelledby="wiki-sidebar-title">
<div class="offcanvas-header">
  <h2 class="offcanvas-title h5" id="wiki-sidebar-title">${escapeHtml(project)}</h2>
  <button type="button" class="btn-close" data-bs-dismiss="offcanvas" data-bs-target="#wiki-sidebar" aria-label="Close navigation"></button>
</div>
<div class="offcanvas-body d-block p-3">
${renderSidebar(site, file)}
</div>
</div>
</nav>
<main id="content" class="col-lg-9 col-xl-10 px-4 py-4">
${crumbs}${content}</main>
</div>
</div>
<footer class="border-top py-3 px-4 text-body-secondary small">${footer}</footer>
<script>${themeSwitcher}</script>
</body>
</html>
`;
}
