import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { test } from 'node:test';
import { globToRegExp, segmentLabel, slugify, staticPrefix } from '../dist/navigation.js';
import { fixture } from './fixture.mjs';

test('reads placement settings from realdocs.json and rejects invalid ones', t => {
  const project = fixture(t, {
    'README.md': '# Home\n',
    'docs/adr/0001-a.md': '# ADR 1\n',
    'realdocs.json': JSON.stringify({
      pages: ['docs/adr/0001-a.md'], home: 'README.md', categories: ['Decisions'],
      groups: { decisions: 'Architecture decisions' },
      rules: [{ files: 'docs/adr/*.md', category: 'Decisions' }],
      sections: { app: { title: 'App', category: 'Applications', group: 'apps/main', pages: ['docs/adr/0001-a.md'] } },
    }),
  });
  assert.match(project.run('check'), /and 2 Markdown page\(s\)/); // home is added as an input
  for (const [config, message] of [
    [{ pages: ['README.md'], rules: [{ files: 'docs/*.md' }] }, /rules\[0\]\.category must be a nonempty single-line string/],
    [{ pages: ['README.md'], rules: [{ files: '../x/*.md', category: 'X' }] }, /rules\[0\]\.files must be inside the config directory/],
    [{ pages: ['README.md'], rules: { files: 'x' } }, /rules must be an array/],
    [{ pages: ['README.md'], categories: 'Decisions' }, /categories must be an array of nonempty single-line strings/],
    [{ pages: ['README.md'], groups: { decisions: '' } }, /groups\.decisions must be a nonempty single-line string/],
    [{ pages: ['README.md'], sections: { a: { pages: ['README.md'], category: 5 } } }, /sections\.a\.category must be a nonempty single-line string/],
    [{ pages: ['README.md'], sections: { a: { pages: ['README.md'], group: '' } } }, /sections\.a\.group must be a nonempty single-line string/],
  ]) {
    project.write('realdocs.json', JSON.stringify(config));
    const result = project.result('check');
    assert.equal(result.status, 1, JSON.stringify(config));
    assert.match(result.stderr, message);
  }
});

test('reads category and path annotations and reports invalid ones at their source', t => {
  const project = fixture(t, {
    'docs/ok.md': '<!-- @livedocs:category Decisions -->\n<!-- @realdocs:path a/b -->\n# OK\n',
    'docs/a.md': '<!-- @realdocs:category Decisions -->\n<!-- @realdocs:category Other -->\n# A\n',
    'docs/b.md': '<!-- @realdocs:category -->\n# B\n',
    'src/index.ts': '/**\n * @realdocs:file Entry.\n * @realdocs:path a/b\n * @realdocs:path c\n */\nexport const x = 1;\n',
  });
  const args = ['--entry', 'src/index.ts', '--page', 'docs/ok.md', '--page', 'docs/a.md', '--page', 'docs/b.md'];
  const result = project.result('check', ...args);
  assert.equal(result.status, 1);
  assert.match(result.stderr, /docs\/a\.md:2:1: error: A file can have only one @realdocs:category\./);
  assert.match(result.stderr, /docs\/b\.md:1:1: error: @realdocs:category needs a value\./);
  assert.match(result.stderr, /src\/index\.ts:4:1: error: A file can have only one @realdocs:path\./);
  assert.doesNotMatch(result.stderr, /docs\/ok\.md/);
});

test('slugs, labels, and globs follow the placement rules', () => {
  assert.equal(slugify('Architecture Decisions'), 'architecture-decisions');
  assert.equal(slugify('  Ünïcode — Stuff!! '), 'ünïcode-stuff');
  assert.equal(slugify('0025-workspaces.summary'), '0025-workspaces.summary');
  assert.equal(slugify('!!!'), '');
  assert.equal(segmentLabel('category-c'), 'Category c');
  assert.equal(segmentLabel('Storage Layer'), 'Storage Layer');
  assert.ok(globToRegExp('docs/hld/**/*.md').test('docs/hld/data-service/README.md'));
  assert.ok(globToRegExp('docs/hld/**/*.md').test('docs/hld/0010-x.md'));
  assert.ok(!globToRegExp('docs/adr/*.md').test('docs/adr/summaries/x.md'));
  assert.ok(globToRegExp('docs/?.md').test('docs/a.md'));
  assert.equal(staticPrefix('docs/hld/**/*.md'), 'docs/hld');
  assert.equal(staticPrefix('*.md'), '');
});

test('places pages and entries by annotation, section, and rule, and rewrites links', t => {
  const project = fixture(t, {
    'README.md': '# Shop\n\nSee [ADR 21](docs/adr/0021-store.md#context).\n',
    'docs/adr/README.md': '# Decisions index\n',
    'docs/adr/0021-store.md': '<!-- @realdocs:path storage/category-c/0021-jsonb -->\n# ADR 21\n\n## Context\n\n[Runbook](../runbooks/deploy.md) [Notes](../notes.md)\n',
    'docs/adr/0025-workspaces.md': '# ADR 25\n',
    'docs/hld/data-service/README.md': '# Data service HLD\n',
    'docs/hld/tenant/README.md': '# Tenant HLD\n',
    'docs/runbooks/deploy.md': '# Deploy\n\n[Back](../adr/0021-store.md)\n',
    'docs/extra.md': '<!-- @realdocs:category  runbooks  -->\n# Extra\n',
    'docs/notes.md': '# Notes\n\n[ADR](adr/0021-store.md)\n',
    'src/main.ts': '/** @realdocs:file Boot. */\nexport const boot = () => 1;\n',
    'src/tools.ts': '/**\n * @realdocs:file Tools.\n * @realdocs:category Utilities\n */\nexport const tool = 1;\n',
    'realdocs.json': JSON.stringify({
      pages: ['README.md', 'docs/adr/README.md', 'docs/adr/0021-store.md', 'docs/adr/0025-workspaces.md',
        'docs/hld/data-service/README.md', 'docs/hld/tenant/README.md', 'docs/runbooks/deploy.md',
        'docs/extra.md', 'docs/notes.md'],
      rules: [
        { files: './docs/adr/*.md', category: 'Architecture Decisions' },
        { files: 'docs/hld/**/*.md', category: 'High-Level Designs' },
        { files: 'docs/runbooks/*.md', category: 'Runbooks' },
      ],
      sections: { app: { title: 'App', category: 'Applications', entries: ['src/main.ts', 'src/tools.ts'] } },
    }),
  });
  project.run('build', '--out', 'wiki');
  const exists = file => existsSync(join(project.cwd, 'wiki', file));
  for (const file of [
    'index.md',
    'architecture-decisions/index.md',
    'architecture-decisions/storage/category-c/0021-jsonb.md',
    'architecture-decisions/0025-workspaces.md',
    'high-level-designs/data-service/index.md',
    'high-level-designs/tenant/index.md',
    'runbooks/deploy.md',
    'runbooks/extra.md',
    'pages/docs/notes.md',
    'applications/app/main.ts.md',
    'utilities/tools.ts.md',
  ]) assert.ok(exists(file), file);
  assert.equal(exists('pages/README.md'), false);
  assert.match(project.read('wiki/index.md'), /\(architecture-decisions\/storage\/category-c\/0021-jsonb\.md#context\)/);
  assert.match(project.read('wiki/runbooks/deploy.md'), /\(\.\.\/architecture-decisions\/storage\/category-c\/0021-jsonb\.md\)/);
  const adr = project.read('wiki/architecture-decisions/storage/category-c/0021-jsonb.md');
  assert.match(adr, /\(\.\.\/\.\.\/\.\.\/runbooks\/deploy\.md\)/);
  assert.match(adr, /\(\.\.\/\.\.\/\.\.\/pages\/docs\/notes\.md\)/);
  assert.match(project.read('wiki/pages/docs/notes.md'), /\(\.\.\/\.\.\/architecture-decisions\/storage\/category-c\/0021-jsonb\.md\)/);
});

test('reports output collisions, reserved categories, and unused labels', t => {
  const project = fixture(t, {
    'docs/a.md': '<!-- @realdocs:category Guides -->\n<!-- @realdocs:path same -->\n# A\n',
    'docs/b.md': '<!-- @realdocs:category guides -->\n<!-- @realdocs:path same -->\n# B\n',
    'docs/c.md': '<!-- @realdocs:category Assets -->\n# C\n',
    'realdocs.json': JSON.stringify({
      pages: ['docs/a.md', 'docs/b.md', 'docs/c.md'],
      categories: ['Missing'], groups: { 'guides/nothing': 'X' },
    }),
  });
  const result = project.result('check');
  assert.equal(result.status, 1);
  assert.match(result.stderr, /docs\/b\.md:\d+:1: error: Pages docs\/a\.md and docs\/b\.md both resolve to guides\/same\.md\./);
  assert.match(result.stderr, /docs\/c\.md:1:1: error: Category "Assets" uses the reserved name assets\./);
  assert.match(result.stderr, /warning: groups key guides\/nothing matches no group\./);
  assert.match(result.stderr, /warning: categories entry Missing is not used by any page\./);
});

test('versioned manifests, impact reports, and the file map use placed routes', t => {
  const project = fixture(t, {
    '.gitignore': 'dist/\n',
    'realdocs.json': JSON.stringify({ pages: ['docs/guide.md'], rules: [{ files: 'docs/*.md', category: 'Guides' }],
      sections: { api: { category: 'API', entries: ['src/index.ts'] } } }),
    'src/index.ts': '/** @realdocs:docId app.hello */\nexport function hello() { return "world"; }',
    'docs/guide.md': '# Guide\n',
  });
  const git = (...args) => execFileSync('git', args, { cwd: project.cwd, encoding: 'utf8', stdio: 'pipe' });
  git('init', '-q');
  git('add', '.');
  git('-c', 'user.name=RealDocs Test', '-c', 'user.email=realdocs@example.invalid', '-c', 'commit.gpgsign=false', 'commit', '-qm', 'Base');
  project.run('build', '--version', '1.0.0');
  const release = JSON.parse(project.read('dist/realdocs-releases/1.0.0/release.json'));
  assert.equal(release.symbols[0].page, 'api/api/index.ts.md#doc-app.hello');
  project.write('docs/guide.md', '# Guide edited\n');
  const impact = JSON.parse(project.run('diff', '--base', 'HEAD', '--json'));
  assert.deepEqual(impact.affected.map(item => item.page), ['guides/guide.md']);
  project.run('build', '--graph', '--format', 'html', '--out', 'site');
  const data = JSON.parse(project.read('site/file-map.html').match(/id="file-map-data">(.*?)<\/script>/s)[1]);
  assert.deepEqual(data.nodes.find(node => node.path === 'docs/guide.md').zone, 'Guides');
});
