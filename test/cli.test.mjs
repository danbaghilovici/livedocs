import assert from 'node:assert/strict';
import { execFileSync, spawn, spawnSync } from 'node:child_process';
import { once } from 'node:events';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { test } from 'node:test';
import { setTimeout as delay } from 'node:timers/promises';
import { fileURLToPath } from 'node:url';

const cli = fileURLToPath(new URL('../dist/cli.js', import.meta.url));

function fixture(t, files) {
  const cwd = mkdtempSync(join(tmpdir(), 'realdocs-test-'));
  t.after(() => rmSync(cwd, { recursive: true, force: true }));
  const write = (file, contents) => {
    mkdirSync(dirname(join(cwd, file)), { recursive: true });
    writeFileSync(join(cwd, file), contents);
  };
  write('package.json', '{"type":"module"}');
  for (const [file, contents] of Object.entries(files)) write(file, contents);

  return {
    cwd,
    write,
    read: file => readFileSync(join(cwd, file), 'utf8'),
    run: (...args) => execFileSync(process.execPath, [cli, ...args], { cwd, encoding: 'utf8', stdio: 'pipe' }),
    result: (...args) => spawnSync(process.execPath, [cli, ...args], { cwd, encoding: 'utf8' }),
    withPreload: (...args) => spawnSync(process.execPath, ['--require', './preload.cjs', cli, ...args], { cwd, encoding: 'utf8' }),
  };
}

test('install-skill adds both skills and preserves an existing local edit', t => {
  const project = fixture(t, {});
  const skillPath = '.agents/skills/realdocs-c4/SKILL.md';
  const bootstrapPath = '.agents/skills/realdocs-bootstrap/SKILL.md';
  const bundled = path => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');

  assert.match(project.run('install-skill'), /Installed realdocs-c4/);
  assert.equal(project.read(skillPath), bundled(skillPath));
  assert.equal(project.read(bootstrapPath), bundled(bootstrapPath));
  assert.match(project.run('install-skill'), /already installed/);

  rmSync(join(project.cwd, bootstrapPath));
  project.write(skillPath, '# Project-specific C4 instructions\n');
  const conflict = project.result('install-skill');
  assert.equal(conflict.status, 1);
  assert.match(conflict.stderr, /differs from the bundled skill/);
  assert.equal(project.read(skillPath), '# Project-specific C4 instructions\n');
  assert.equal(project.read(bootstrapPath), bundled(bootstrapPath));
  assert.equal(existsSync(join(project.cwd, 'realdocs.json')), false);
  assert.equal(existsSync(join(project.cwd, 'AGENTS.md')), false);

  project.run('install-skill', '--skills-dir', '.claude/skills');
  assert.equal(project.read('.claude/skills/realdocs-c4/SKILL.md'), bundled(skillPath));
  assert.equal(project.read('.claude/skills/realdocs-bootstrap/SKILL.md'), bundled(bootstrapPath));
  assert.equal(project.result('install-skill', '--skills-dir=').status, 1);
  assert.equal(project.result('install-skill', '--out', 'unused').status, 1);
  assert.match(project.result('init', '--skills-dir', 'unused').stderr, /--skills-dir/);
});

test('install-skill can add documentation maintenance to existing or new agent instructions', t => {
  const original = '# Existing rules\r\n\r\nKeep these instructions.';
  const project = fixture(t, { 'AGENTS.md': original });
  const template = readFileSync(new URL('../.agents/realdocs-instructions.md', import.meta.url), 'utf8');

  project.run('install-skill');
  assert.equal(project.read('AGENTS.md'), original);
  project.run('install-skill', '--instructions-file', 'AGENTS.md');
  const updated = project.read('AGENTS.md');
  assert.equal(updated, original + '\r\n\r\n' + template.replace(/\n/g, '\r\n'));

  const customized = updated.replace('Before completing', 'Before merging');
  project.write('AGENTS.md', customized);
  project.run('install-skill', '--instructions-file', 'AGENTS.md');
  assert.equal(project.read('AGENTS.md'), customized);

  project.run('install-skill', '--skills-dir', '.claude/skills', '--instructions-file', 'CLAUDE.md');
  assert.equal(project.read('CLAUDE.md'), template);
  assert.equal(project.result('install-skill', '--instructions-file=').status, 1);
  assert.match(project.result('init', '--instructions-file', 'README.md').stderr, /--instructions-file/);
});

test('diff reports source, Markdown, and diagram dependencies against a Git revision', t => {
  const project = fixture(t, {
    'realdocs.json': JSON.stringify({ pages: ['docs/architecture.md', 'docs/runbook.md', 'docs/unrelated.md'], sections: {
      orders: { entries: ['src/orders.ts'] },
    } }),
    'src/orders.ts': "/** @realdocs:docId orders.create */\nexport function createOrder() {}",
    'src/logic.ts': 'export const quantity = 1;',
    'docs/architecture.md': '# Architecture\n\n```mermaid\nC4Component\nComponent(order, "{{ symbol(\'orders.create\').name }}", "TS", "Creates orders")\n```\n',
    'docs/runbook.md': '# Runbook\n\n[Architecture](architecture.md)',
    'docs/unrelated.md': '# Unrelated',
  });
  project.write('src/orders.ts', "import { quantity } from './logic.js';\n/** @realdocs:docId orders.create */\nexport function createOrder() { return quantity; }");
  const git = (...args) => execFileSync('git', args, { cwd: project.cwd, encoding: 'utf8', stdio: 'pipe' });
  git('init', '-q');
  git('add', '.');
  git('-c', 'user.name=RealDocs Test', '-c', 'user.email=realdocs@example.invalid', '-c', 'commit.gpgsign=false', 'commit', '-qm', 'Base');
  const base = git('rev-parse', 'HEAD').trim();
  project.write('src/logic.ts', 'export const quantity = 2;');
  project.write('notes with spaces.md', '# Untracked');

  const result = JSON.parse(project.run('diff', '--base', 'HEAD', '--json', '--format', 'html', '--out', 'unused'));
  assert.equal(result.base, base);
  assert.deepEqual(result.changes, [
    { path: 'notes with spaces.md', status: 'added' },
    { path: 'src/logic.ts', status: 'modified' },
  ]);
  assert.deepEqual(result.affected, [
    { input: 'docs/architecture.md', page: 'pages/docs/architecture.html', reasons: ['src/logic.ts'] },
    { input: 'docs/runbook.md', page: 'pages/docs/runbook.html', reasons: ['src/logic.ts'] },
    { input: 'src/orders.ts', page: 'modules/src/orders.ts.html', reasons: ['src/logic.ts'] },
  ]);
  assert.equal(existsSync(join(project.cwd, 'unused')), false);

  project.write('docs/runbook.md', '# Edited runbook');
  git('add', 'docs/runbook.md');
  const staged = JSON.parse(project.run('diff', '--base', 'HEAD', '--json'));
  assert.deepEqual(staged.affected.find(page => page.input === 'docs/runbook.md')?.reasons, ['docs/runbook.md']);
  const badBase = project.result('diff', '--base', 'missing-ref');
  assert.notEqual(badBase.status, 0);
  assert.match(badBase.stderr, /Could not resolve Git base/);
  rmSync(join(project.cwd, 'docs/architecture.md'));
  const removed = project.result('diff', '--base', 'HEAD', '--json');
  assert.equal(removed.status, 1);
  assert.match(removed.stderr, /Could not read Markdown page docs\/architecture\.md/);
  assert.deepEqual(JSON.parse(removed.stdout).affected.find(page => page.input === 'docs/architecture.md')?.reasons, ['docs/architecture.md']);
});

test('builds an immutable versioned wiki pinned to the checked-out commit', t => {
  const project = fixture(t, {
    '.gitignore': 'dist/\n',
    'realdocs.json': '{"sections":{"api":{"entries":["src/index.ts"]}}}',
    'src/index.ts': '/** @realdocs:docId app.hello */\nexport function hello() { return "world"; }',
  });
  const git = (...args) => execFileSync('git', args, { cwd: project.cwd, encoding: 'utf8', stdio: 'pipe' });
  const commit = message => {
    git('add', '.');
    git('-c', 'user.name=RealDocs Test', '-c', 'user.email=realdocs@example.invalid', '-c', 'commit.gpgsign=false', 'commit', '-qm', message);
    return git('rev-parse', 'HEAD').trim();
  };
  git('init', '-q');
  git('remote', 'add', 'origin', 'https://github.com/example/project.git');
  const base = commit('Release source');
  const output = 'dist/realdocs-releases/1.0.0';

  project.run('build', '--version', '1.0.0');
  const text = project.read(output + '/release.json');
  const release = JSON.parse(text);
  assert.equal(release.version, '1.0.0');
  assert.equal(release.commit, base);
  assert.equal(release.symbols[0].id, 'app.hello');
  assert.equal(release.symbols[0].page, 'modules/src/index.ts.md#doc-app.hello');
  assert.match(release.files['modules/src/index.ts.md'], /^[a-f0-9]{64}$/);
  assert.match(project.read(output + '/modules/src/index.ts.md'), new RegExp('/blob/' + base + '/src/index.ts#L2'));
  assert.match(project.run('build', '--version', '1.0.0'), /\(0 written\)/);

  project.write('src/index.ts', 'export function hello() { return "later"; }');
  assert.match(project.result('build', '--version', '2.0.0').stderr, /uncommitted/);
  commit('Update source');
  const conflict = project.result('build', '--version', '1.0.0');
  assert.notEqual(conflict.status, 0);
  assert.match(conflict.stderr, /immutable/);
  assert.equal(project.read(output + '/release.json'), text);
});

test('init discovers projects and Markdown, and preserves an existing config', t => {
  const project = fixture(t, {
    'ARCHITECTURE.md': '# Architecture guide',
    'docs/design.md': '# Design guide',
    'eslint.config.mjs': 'export default [];',
    'node_modules/ignored/README.md': '# Dependency',
    'dist/old/index.md': '# Generated docs',
    'wiki/.realdocs-manifest.json': '{}',
    'wiki/index.md': '# Generated docs in a custom output directory',
    'services/orders/tsconfig.app.json': '{}',
    'services/orders/src/main.ts': "import './orders.module.js';",
    'services/orders/src/orders.module.ts': 'export class OrdersModule {}',
    'services/orders/docs/operations.md': '# Operations',
    'packages/contracts/tsconfig.json': '{}',
    'packages/contracts/src/index.ts': 'export interface Order {}',
  });

  const preview = JSON.parse(project.run('init', '--print'));
  assert.equal(existsSync(join(project.cwd, 'realdocs.json')), false);
  assert.deepEqual(preview.pages, ['ARCHITECTURE.md', 'docs/design.md']);
  assert.deepEqual(Object.keys(preview.sections), ['contracts', 'orders']);
  assert.equal(preview.sections.orders.project, 'services/orders/tsconfig.app.json');
  assert.deepEqual(preview.sections.orders.entries, ['services/orders/src/main.ts', 'services/orders/src/orders.module.ts']);
  assert.deepEqual(preview.sections.orders.pages, ['services/orders/docs/operations.md']);
  assert.deepEqual(preview.sections.contracts.entries, ['packages/contracts/src/index.ts']);

  project.run('init');
  assert.deepEqual(JSON.parse(project.read('realdocs.json')), preview);
  project.write('realdocs.json', '{"pages":["ARCHITECTURE.md"]}\n');
  const overwrite = project.result('init');
  assert.notEqual(overwrite.status, 0);
  assert.match(overwrite.stderr, /realdocs\.json already exists/);
  assert.equal(project.read('realdocs.json'), '{"pages":["ARCHITECTURE.md"]}\n');
});

test('init follows TypeScript project references without assuming a source folder name', t => {
  const project = fixture(t, {
    'tsconfig.json': '{"files":[],"references":[{"path":"components/search/compiler.json"}]}',
    'components/search/compiler.json': '{"include":["implementation/**/*.ts"]}',
    'components/search/implementation/query.ts': 'export function query() {}',
    'components/search/implementation/query.test.ts': 'export function testQuery() {}',
    'components/search/guide.md': '# Search guide',
  });
  const config = JSON.parse(project.run('init', '--print'));
  assert.deepEqual(config.sections.search, {
    title: 'search',
    project: 'components/search/compiler.json',
    entries: ['components/search/implementation/query.ts'],
    pages: ['components/search/guide.md'],
  });
});

test('init leaves out test code, fixtures, end-to-end suites, and agent instructions', t => {
  const project = fixture(t, {
    'AGENTS.md': '# Agent instructions',
    'CLAUDE.md': '# Claude instructions',
    'services/orders/AGENTS.md': '# Nested agent instructions',
    'services/orders/tsconfig.app.json': '{}',
    'services/orders/src/main.ts': 'export {};',
    'services/orders/test/README.md': '# Test notes',
    'services/orders/e2e/tsconfig.json': '{"include":["**/*.ts"]}',
    'services/orders/e2e/fixtures/session.ts': 'export const session = 1;',
    'scripts/fixtures/libs/contracts/src/index.ts': 'export const fixture = 1;',
    'scripts/tests/README.md': '# Script tests',
    'docs/guide.md': '# Guide',
  });
  const config = JSON.parse(project.run('init', '--print'));
  assert.deepEqual(config.pages, ['docs/guide.md']);
  assert.deepEqual(Object.keys(config.sections), ['orders']);
  assert.deepEqual(config.sections.orders.entries, ['services/orders/src/main.ts']);
  assert.equal(config.sections.orders.pages, undefined);
});

test('builds section indexes with cross-project links and one page per source file', t => {
  const settings = {
    compilerOptions: { module: 'NodeNext', baseUrl: '../..', paths: { '#orders': ['lib/contracts/index.ts'] } },
  };
  const project = fixture(t, {
    'package.json': '{"name":"orders-platform","type":"module"}',
    'realdocs.json': JSON.stringify({
      pages: ['ARCHITECTURE.md'],
      sections: {
        http: { title: 'Orders API', project: 'services/http/tsconfig.json', entries: ['services/http/index.ts', 'lib/contracts/index.ts'] },
        contracts: { title: 'Order contracts', project: 'lib/contracts/tsconfig.json', entries: ['lib/contracts/index.ts'], pages: ['lib/contracts/README.md'] },
        jobs: { title: 'Maintenance', project: 'jobs/tsconfig.json', entries: ['jobs/index.ts'] },
      },
    }),
    'ARCHITECTURE.md': '# Architecture\n\nArchitecture-only text.\n\n[Order](lib/contracts/index.ts#Order)\n\n```mermaid\nC4Context\nSystem(orders, "Orders API", "Manages orders")\n```\n',
    'services/http/tsconfig.json': JSON.stringify(settings),
    'services/http/index.ts': "import type { Order } from '#orders';\n/** Receives an {@link Order}. */\nexport function accept(order: Order) {}",
    'lib/contracts/tsconfig.json': '{"compilerOptions":{"module":"NodeNext"}}',
    'lib/contracts/index.ts': 'export interface Order { id: number }',
    'lib/contracts/README.md': '# Contracts guide\n\n[API](../../services/http/index.ts#accept)\n',
    'jobs/tsconfig.json': '{"compilerOptions":{"module":"NodeNext"}}',
    'jobs/index.ts': 'export function cleanUp() {}',
    'notes.md': '# Added after init',
  });

  assert.match(project.run('check', '--strict'), /Checked 3 module\(s\) and 2 Markdown page\(s\)/);
  project.run('build', '--strict', '--graph', '--out', 'wiki');
  const root = project.read('wiki/index.md');
  assert.match(root, /^# orders-platform/m);
  assert.match(root, /\[Orders API\]\(sections\/http\/index\.md\)/);
  assert.match(root, /\[Architecture\]\(pages\/ARCHITECTURE\.md\)/);
  assert.doesNotMatch(root, /Architecture-only text|Added after init/);
  assert.match(project.read('wiki/modules/services/http/index.ts.md'), /contracts\/index\.ts\.md#symbol-Order/);
  assert.match(project.read('wiki/sections/contracts/index.md'), /\[Contracts guide\]\(\.\.\/\.\.\/pages\/lib\/contracts\/README\.md\)/);
  assert.match(project.read('wiki/sections/http/index.md'), /\.\.\/\.\.\/modules\/lib\/contracts\/index\.ts\.md/);
  assert.doesNotMatch(project.read('wiki/sections/http/index.md'), /jobs\/index\.ts/);

  project.run('build', '--strict', '--graph', '--format', 'html', '--out', 'site');
  const section = project.read('site/sections/http/index.html');
  const graph = JSON.parse(section.match(/id="file-map-data">(.*?)<\/script>/s)[1]);
  assert.equal(graph.nodes.find(node => node.path === 'lib/contracts/index.ts').href, '../../modules/lib/contracts/index.ts.html');
  assert.equal(graph.nodes.some(node => node.path === 'jobs/index.ts'), false);
  assert.match(section, /src="\.\.\/\.\.\/assets\/cytoscape\.min\.js"/);
  assert.match(project.read('site/pages/ARCHITECTURE.html'), /C4Context/);
});

test('uses a Markdown-only config and reports invalid section paths', t => {
  const project = fixture(t, {
    'README.md': '# Root guide',
    'realdocs.json': '{"pages":["README.md"]}',
    'extra.md': '# Extra guide',
  });
  project.run('build', '--out', 'wiki');
  assert.match(project.read('wiki/index.md'), /\[Root guide\]\(pages\/README\.md\)/);
  project.run('build', '--page', 'extra.md', '--out', 'wiki');
  assert.match(project.read('wiki/index.md'), /\[Extra guide\]\(pages\/extra\.md\)/);

  project.write('realdocs.json', '{"sections":{"guide":{"pages":["../outside.md"]}}}');
  const invalid = project.result('check');
  assert.notEqual(invalid.status, 0);
  assert.match(invalid.stderr, /sections\.guide\.pages.*inside the config directory/);
});

test('uses the root compiler config for sections without a project override', t => {
  const project = fixture(t, {
    'tsconfig.json': '{"compilerOptions":{"module":"NodeNext","paths":{"#value":["./common/value.ts"]}}}',
    'realdocs.json': '{"sections":{"api":{"entries":["services/api.ts"]}}}',
    'common/value.ts': 'export const value = 1;',
    'services/api.ts': "export { value } from '#value';",
  });
  assert.match(project.run('check', '--strict'), /Checked 1 module\(s\)/);
});

test('builds one repo-wide wiki and standalone wikis from the same app configs', t => {
  const project = fixture(t, {
    'package.json': '{"name":"platform","type":"module"}',
    'realdocs.json': JSON.stringify({
      pages: ['ARCHITECTURE.md'],
      sections: {
        orders: { title: 'Orders API', config: 'apps/orders/realdocs.json' },
        billing: { title: 'Billing API', config: 'apps/billing/realdocs.json' },
      },
    }),
    'ARCHITECTURE.md': '# Platform architecture\n\n[Orders](apps/orders/README.md) · [Billing](apps/billing/src/index.ts#billing)',
  });
  for (const app of ['orders', 'billing']) {
    const dir = `apps/${app}`;
    const compiler = app === 'orders' ? 'tsconfig.json' : 'tsconfig.app.json';
    project.write(`${dir}/package.json`, JSON.stringify({ name: app, type: 'module' }));
    project.write(`${dir}/realdocs.json`, JSON.stringify({
      pages: ['README.md'],
      sections: { api: { entries: ['src/index.ts'], pages: ['docs/runbook.md'],
        ...(app === 'billing' && { project: compiler }) } },
    }));
    project.write(`${dir}/${compiler}`, '{"compilerOptions":{"module":"NodeNext","paths":{"#local":["./src/value.ts"]}}}');
    project.write(`${dir}/src/index.ts`, `export { value as ${app} } from '#local';`);
    project.write(`${dir}/src/value.ts`, 'export const value = 1;');
    project.write(`${dir}/README.md`, `# ${app} guide\n\n[API](src/index.ts#${app})`);
    project.write(`${dir}/docs/runbook.md`, `# ${app} runbook`);
  }

  assert.match(project.run('check', '--strict'), /Checked 2 module\(s\) and 5 Markdown page\(s\)/);
  project.run('build', '--strict', '--format', 'html');
  const wiki = 'dist/realdocs';
  const home = project.read(`${wiki}/index.html`);
  const architecture = project.read(`${wiki}/pages/ARCHITECTURE.html`);
  assert.match(architecture, /href="apps\/orders\/README\.html"/);
  assert.match(architecture, /href="\.\.\/modules\/apps\/billing\/src\/index\.ts\.html#symbol-billing"/);

  for (const app of ['orders', 'billing']) {
    assert.ok(home.includes(`href="sections/${app}/index.html"`));
    const section = project.read(`${wiki}/sections/${app}/index.html`);
    assert.ok(section.includes(`../../modules/apps/${app}/src/index.ts.html`));
    assert.ok(section.includes(`../../pages/apps/${app}/README.html`));
    assert.ok(section.includes(`../../pages/apps/${app}/docs/runbook.html`));

    const cwd = join(project.cwd, 'apps', app);
    execFileSync(process.execPath, [cli, 'build', '--strict'], { cwd, stdio: 'pipe' });
    const appWiki = `apps/${app}/${wiki}`;
    const appHome = project.read(`${appWiki}/index.md`);
    assert.ok(appHome.startsWith(`# ${app}\n`));
    assert.match(appHome, /\[api\]\(sections\/api\/index\.md\)/);
    assert.match(project.read(`${appWiki}/pages/README.md`), /\.\.\/modules\/src\/index\.ts\.md#symbol-/);
    assert.equal(existsSync(join(project.cwd, appWiki, 'pages/ARCHITECTURE.md')), false);
  }
});

test('reports invalid app config includes with the declaring config path', t => {
  const project = fixture(t, {
    'realdocs.json': '{"sections":{"app":{"config":"apps/example/realdocs.json"}}}',
  });

  assert.match(project.result('check').stderr, /Could not read apps\/example\/realdocs\.json/);
  project.write('apps/example/realdocs.json', '{"pages":["../../README.md"]}');
  assert.match(project.result('check').stderr, /apps\/example\/realdocs\.json: pages.*inside the config directory/);
  project.write('apps/example/realdocs.json', '{"sections":{"loop":{"config":"realdocs.json"}}}');
  assert.match(project.result('check').stderr, /Circular config include.*apps\/example\/realdocs\.json/);
  project.write('realdocs.json', '{"sections":{"app":{"config":"apps/example/realdocs.json","entries":[]}}}');
  assert.match(project.result('check').stderr, /sections\.app\.config cannot be combined with entries, pages, or project/);
});

test('keeps standalone compiler contexts for included apps without compiler configs', t => {
  const ordersEntry = 'apps/orders/src/index.ts';
  const project = fixture(t, {
    'realdocs.json': JSON.stringify({ sections: {
      repo: { entries: ['src/globals.ts', ordersEntry] },
      billing: { config: 'apps/billing/realdocs.json' },
      orders: { config: 'apps/orders/realdocs.json' },
    } }),
    'src/globals.ts': 'export {}; declare global { interface Window { identity: "repo" } }',
  });
  for (const app of ['billing', 'orders']) {
    project.write(`apps/${app}/realdocs.json`, '{"sections":{"api":{"entries":["src/index.ts"]}}}');
    project.write(`apps/${app}/src/index.ts`, `declare global { interface Window { identity: "${app}" } }\nexport function appIdentity() { return window.identity; }`);
  }

  project.run('build', '--strict');
  assert.match(project.read(`dist/realdocs/modules/${ordersEntry}.md`), /appIdentity\(\): "orders"/);
  assert.match(project.read('dist/realdocs/modules/apps/billing/src/index.ts.md'), /appIdentity\(\): "billing"/);
});

test('tracks included app configs in repo-wide diffs and release manifests', t => {
  const config = '{"pages":["README.md"]}';
  const appConfig = 'apps/orders/realdocs.json';
  const project = fixture(t, {
    '.gitignore': 'dist/\n',
    'realdocs.json': '{"sections":{"platform":{"config":"apps/realdocs.json"}}}',
    'apps/realdocs.json': '{"sections":{"orders":{"config":"orders/realdocs.json"}}}',
    [appConfig]: config,
    'apps/orders/README.md': '# Orders guide',
  });
  const git = (...args) => execFileSync('git', args, { cwd: project.cwd, stdio: 'pipe' });
  git('init', '-q');
  git('add', '.');
  git('-c', 'user.name=RealDocs Test', '-c', 'user.email=realdocs@example.invalid', '-c', 'commit.gpgsign=false', 'commit', '-qm', 'Base');

  project.run('build', '--version', '1.0.0');
  const { sources } = JSON.parse(project.read('dist/realdocs-releases/1.0.0/release.json'));
  for (const file of ['realdocs.json', 'apps/realdocs.json', appConfig]) assert.match(sources[file], /^[a-f0-9]{64}$/);

  project.write(appConfig, `${config}\n`);
  const { affected } = JSON.parse(project.run('diff', '--base', 'HEAD', '--json'));
  assert.deepEqual(affected, [{
    input: 'apps/orders/README.md', page: 'pages/apps/orders/README.md', reasons: [appConfig],
  }]);
});

test('reports changes to the target of a symlinked app config', { skip: process.platform === 'win32' }, t => {
  const config = '{"pages":["README.md"]}';
  const target = 'apps/orders/wiki.json';
  const project = fixture(t, {
    'realdocs.json': '{"sections":{"orders":{"config":"apps/orders/realdocs.json"}}}',
    [target]: config,
    'apps/orders/README.md': '# Orders guide',
  });
  symlinkSync('wiki.json', join(project.cwd, 'apps/orders/realdocs.json'));
  const git = (...args) => execFileSync('git', args, { cwd: project.cwd, stdio: 'pipe' });
  git('init', '-q');
  git('add', '.');
  git('-c', 'user.name=RealDocs Test', '-c', 'user.email=realdocs@example.invalid', '-c', 'commit.gpgsign=false', 'commit', '-qm', 'Base');

  project.write(target, `${config}\n`);
  const { affected } = JSON.parse(project.run('diff', '--base', 'HEAD', '--json'));
  assert.deepEqual(affected, [{
    input: 'apps/orders/README.md', page: 'pages/apps/orders/README.md', reasons: [target],
  }]);
});

test('generates a NestJS monorepo wiki from discovered apps and a shared library', t => {
  const apps = {
    'admin-api': { folder: 'admin', entry: 'bootstrap', module: 'AdminModule' },
    'orders-api': { folder: 'orders', entry: 'main', module: 'OrdersModule' },
    'customer-portal': { folder: 'portal', entry: 'main', module: 'PortalModule' },
  };
  const nestProjects = {
    contracts: {
      type: 'library', root: 'libs/contracts', sourceRoot: 'libs/contracts/src', entryFile: 'index',
      compilerOptions: { tsConfigPath: 'libs/contracts/tsconfig.lib.json' },
    },
  };
  const files = {
    'package.json': '{"name":"order-platform","type":"module"}',
    'tsconfig.json': JSON.stringify({ compilerOptions: {
      module: 'NodeNext', experimentalDecorators: true,
      baseUrl: '.', paths: { '@platform/contracts': ['libs/contracts/src/index.ts'] },
    } }),
    'libs/contracts/tsconfig.lib.json': '{"extends":"../../tsconfig.json","include":["src/**/*"]}',
    'libs/contracts/src/index.ts': '/** Public order contract. */\nexport interface Order { id: string }',
    'ARCHITECTURE.md': `# Order platform architecture

The platform handles orders and customer requests.

[Orders API module](apps/orders/src/orders.module.ts#OrdersModule)

\`\`\`mermaid
C4Container
System_Boundary(platform, "Order platform") {
  Container(orders, "Orders API", "NestJS", "Manages orders")
  Container(portal, "Customer Portal", "NestJS", "Displays order status")
}
Rel(portal, orders, "Reads order status", "HTTP")
\`\`\`
`,
    'apps/orders/README.md': '# Orders API guide\n\n[Shared order contract](../../libs/contracts/src/index.ts#Order)\n',
  };
  for (const [id, { folder, entry, module }] of Object.entries(apps)) {
    const root = `apps/${folder}`;
    const sourceRoot = `${root}/src`;
    const tsConfigPath = `${root}/tsconfig.app.json`;
    nestProjects[id] = { type: 'application', root, sourceRoot, entryFile: entry, compilerOptions: { tsConfigPath } };
    files[tsConfigPath] = '{"extends":"../../tsconfig.json","include":["src/**/*"]}';
    files[`${sourceRoot}/${entry}.ts`] = `import { ${module} } from './${folder}.module.js';\nvoid ${module};\n`;
    files[`${sourceRoot}/${folder}.module.ts`] = `import type { Order } from '@platform/contracts';
/** Reads an {@link Order}. */
export class ${module} { read(id: string): Order { return { id }; } }
`;
  }
  files['nest-cli.json'] = JSON.stringify({ monorepo: true, projects: nestProjects });
  const project = fixture(t, files);

  project.run('init');
  const config = JSON.parse(project.read('realdocs.json'));
  assert.deepEqual(Object.keys(config.sections).sort(), ['admin-api', 'contracts', 'customer-portal', 'orders-api']);
  assert.ok(config.sections['admin-api'].entries.includes('apps/admin/src/bootstrap.ts'));
  assert.deepEqual(config.sections['orders-api'].pages, ['apps/orders/README.md']);
  assert.deepEqual(config.pages, ['ARCHITECTURE.md']);

  project.run('check', '--strict');
  project.run('build', '--strict', '--format', 'html', '--graph', '--out', 'wiki');
  const home = project.read('wiki/index.html');
  assert.match(home, /<h1>order-platform<\/h1>/);
  assert.doesNotMatch(home, /The platform handles orders/);
  for (const id of Object.keys(config.sections)) {
    assert.ok(home.includes(`href="sections/${id}/index.html"`));
    assert.match(project.read(`wiki/sections/${id}/index.html`), /id="file-map-data"/);
  }
  assert.match(home, /href="pages\/ARCHITECTURE\.html"/);
  const architecture = project.read('wiki/pages/ARCHITECTURE.html');
  assert.match(architecture, /C4Container/);
  assert.match(architecture, /href="\.\.\/modules\/apps\/orders\/src\/orders\.module\.ts\.html#symbol-OrdersModule"/);
  assert.match(project.read('wiki/sections/orders-api/index.html'), /href="\.\.\/\.\.\/pages\/apps\/orders\/README\.html"/);
  for (const { folder } of Object.values(apps)) {
    const modulePage = project.read(`wiki/modules/apps/${folder}/src/${folder}.module.ts.html`);
    assert.match(modulePage, /href="\.\.\/\.\.\/\.\.\/libs\/contracts\/src\/index\.ts\.html#symbol-Order"/);
  }
  assert.match(project.read('wiki/modules/libs/contracts/src/index.ts.html'), /id="symbol-Order"/);
});

test('builds a linked wiki from JavaScript JSDoc and TypeScript exports without templates', t => {
  const project = fixture(t, {
    'tsconfig.json': JSON.stringify({
      compilerOptions: { module: 'NodeNext', paths: { '#counts': ['./src/counts.js'] } },
      include: ['src'],
    }),
    'src/counts.js': `
/** The fallback count. */
export const fallback = 0;
/**
 * Convert text to a number. See {@link fallback | the default count}.
 * @param {string} text The input text.
 * @returns {number} The parsed count.
 * @example parseCount("4")
 * @deprecated Use a decimal parser in new code.
 */
export function parseCount(text) { return Number(text); }
/** Internal implementation. */
function internalHelper() {}
`,
    'src/index.ts': `
export { parseCount as parse } from '#counts';
/** A labeled result. */
export interface Result { label: string }
export function label(value: string): string;
export function label(value: number): string;
export function label(value: string | number) { return String(value); }
`,
  });

  project.run('build', '--entry', 'src/index.ts', '--entry', 'src/counts.js');

  const home = project.read('dist/realdocs/index.md');
  assert.match(home, /\]\(modules\/src\/index\.ts\.md\)/);
  const page = project.read('dist/realdocs/modules/src/index.ts.md');
  assert.match(page, /export function parse\(text: string\): number/);
  assert.match(page, /\[the default count\]\(counts\.js\.md#symbol-fallback\)/);
  assert.match(page, /The input text\./);
  assert.match(page, /The parsed count\./);
  assert.match(page, /parseCount\("4"\)/);
  assert.match(page, /Deprecated.*Use a decimal parser/);
  assert.match(page, /export interface Result \{\s+label: string;?\s*\}/);
  assert.match(page, /export function label\(value: string\): string/);
  assert.match(page, /export function label\(value: number\): string/);
  assert.doesNotMatch(page, /label\(value: string \| number\)/);
  assert.doesNotMatch(project.read('dist/realdocs/modules/src/counts.js.md'), /internalHelper|Internal implementation/);
});

test('renders leading @realdocs:file documentation before the exports of each entry point', t => {
  const project = fixture(t, {
    'index.ts': `/**
 * @realdocs:file Overview of the **public API**.
 *
 * Use this entry point for new applications.
 *
 * \`\`\`mermaid
 * ---
 * config:
 *   theme: forest
 * ---
 * flowchart TD
 *   Source --> Wiki
 * \`\`\`
 */
/** Version of the protocol. */
export const version = 1;
`,
    'rates.cjs': `#!/usr/bin/env node
/** @livedocs:file Legacy rate service. */
/** Returns the flat fee. */
module.exports = function flatFee() { return 450; };
/** @realdocs:file This comment occurs after a declaration. */
`,
  });

  project.run('build', '--entry', 'index.ts', '--entry', 'rates.cjs', '--out', 'wiki');

  const api = project.read('wiki/modules/index.ts.md');
  assert.match(api, /^# `index\.ts`\n\nOverview of the \*\*public API\*\*\.\n\nUse this entry point/);
  assert.match(api, /```mermaid\n---\nconfig:\n  theme: forest\n---\nflowchart TD\n  Source --> Wiki\n```/);
  assert.match(api, /## `version`[\s\S]*Version of the protocol\./);
  assert.equal(api.match(/Overview of the/g)?.length, 1);
  assert.doesNotMatch(api, /@realdocs:file/);

  const legacy = project.read('wiki/modules/rates.cjs.md');
  assert.match(legacy, /^# `rates\.cjs`\n\nLegacy rate service\./);
  assert.match(legacy, /## `module\.exports`[\s\S]*Returns the flat fee\./);
  assert.doesNotMatch(legacy, /This comment occurs after a declaration/);
});

test('groups tagged pages and exports in both wiki formats', t => {
  const project = fixture(t, {
    'src/stock.ts': `/**
 * @realdocs:file Stock operations.
 * @realdocs:tag Inventory
 * @realdocs:tag Architecture
 * @realdocs:tag inventory
 */
export const defaultStock = 10;
/**
 * Verify current stock.
 * @realdocs:tag inventory
 * @realdocs:tag Stock Checks
 */
export function inspectStock() { return defaultStock; }
`,
    'docs/guide.md': '<!-- @realdocs:tag inventory -->\n<!-- @livedocs:tag Architecture -->\n\n# Stock guide\n',
  });
  const args = ['--entry', 'src/stock.ts', '--page', 'docs/guide.md', '--strict'];
  project.run('build', ...args, '--out', 'wiki');
  project.run('build', ...args, '--out', 'site', '--format', 'html');

  assert.match(project.read('wiki/index.md'), /\[Tags\]\(tags\.md\)/);
  const tags = project.read('wiki/tags.md');
  assert.match(tags, /id="tag-architecture"/);
  assert.match(tags, /id="tag-inventory"/);
  assert.match(tags, /id="tag-stock-checks"/);
  assert.equal(tags.match(/id="tag-inventory"/g)?.length, 1);
  assert.match(tags, /\(pages\/docs\/guide\.md\)/);
  assert.match(tags, /\(modules\/src\/stock\.ts\.md\)/);
  assert.match(tags, /\(modules\/src\/stock\.ts\.md#symbol-inspectStock\)/);
  assert.doesNotMatch(tags, /#symbol-defaultStock/);

  assert.match(project.read('wiki/modules/src/stock.ts.md'), /\(\.\.\/\.\.\/tags\.md#tag-stock-checks\)/);
  const guide = project.read('site/pages/docs/guide.html');
  assert.match(guide, /href="\.\.\/\.\.\/tags\.html#tag-inventory"/);
  assert.match(guide, /href="\.\.\/\.\.\/tags\.html#tag-architecture"/);
  assert.doesNotMatch(guide, /@(?:realdocs|livedocs):tag/);
  assert.match(project.read('site/tags.html'), /href="modules\/src\/stock\.ts\.html#symbol-inspectStock"/);
});

test('builds a linked HTML wiki with a local Mermaid runtime', t => {
  const project = fixture(t, {
    'src/index.ts': `/**
 * @realdocs:file **Fulfillment** example.
 *
 * \`\`\`mermaid
 * flowchart TD
 *   Order --> Shipment
 * \`\`\`
 */
import { shipment } from './shipping.js';
/** Prepares a {@link shipment}. */
export const prepare = () => shipment;
`,
    'src/shipping.ts': `/**
 * @realdocs:file Shipping reference.
 *
 * <script>window.exampleMarker = 1;</script>
 *
 * <a id="unsafe" onmouseover="example()"></a> <a id="safe"></a>
 *
 * [Unsafe page](javascript:example())
 */
/** A shipment record. */
export const shipment = { ready: true };
`,
  });
  const args = ['--entry', 'src/index.ts', '--entry', 'src/shipping.ts', '--out', 'wiki'];
  project.run('build', ...args);
  project.run('build', ...args, '--format', 'html');

  const home = project.read('wiki/index.html');
  assert.match(home, /^<!doctype html>/i);
  assert.match(home, /href="modules\/src\/index\.ts\.html"/);
  assert.doesNotMatch(home, /<script/);
  assert.equal(existsSync(join(project.cwd, 'wiki/index.md')), false);
  assert.equal(existsSync(join(project.cwd, 'wiki/modules/src/index.ts.md')), false);

  const main = project.read('wiki/modules/src/index.ts.html');
  assert.match(main, /<strong>Fulfillment<\/strong>/);
  assert.match(main, /href="\.\.\/\.\.\/index\.html"/);
  assert.match(main, /href="shipping\.ts\.html#symbol-shipment"/);
  assert.match(main, /class="language-mermaid">flowchart TD\n  Order --&gt; Shipment/);
  assert.match(main, /src="\.\.\/\.\.\/assets\/mermaid\.min\.js"/);
  assert.ok(statSync(join(project.cwd, 'wiki/assets/mermaid.min.js')).size > 0);
  assert.match(project.read('wiki/assets/render-mermaid.js'), /layout: 'dagre', look: 'classic',\s+flowchart: \{ wrappingWidth: 200 \}/);

  const shipping = project.read('wiki/modules/src/shipping.ts.html');
  assert.match(shipping, /id="symbol-shipment"/);
  assert.match(shipping, /&lt;script&gt;window\.exampleMarker/);
  assert.doesNotMatch(shipping, /<script|href="javascript:|onmouseover="/);
  assert.match(shipping, /&lt;a id=&quot;unsafe&quot; onmouseover=/);
  assert.match(shipping, /<a id="safe"><\/a>/);

  project.run('build', ...args, '--format', 'markdown');
  assert.equal(existsSync(join(project.cwd, 'wiki/index.html')), false);
  assert.equal(existsSync(join(project.cwd, 'wiki/assets')), false);
  assert.match(project.read('wiki/index.md'), /modules\/src\/index\.ts\.md/);
});

test('updates diagram labels and links after a symbol is renamed and moved', t => {
  const source = name => `/**
 * Create an invoice.
 * @realdocs:docId billing.create
 * @realdocs:docUses billing.validate
 */
export function ${name}() { return validateInvoice(); }
/** @livedocs:docId billing.validate */
export function validateInvoice() { return true; }
`;
  const diagram = `# Billing workflow

\`\`\`mermaid
flowchart LR
  Create["{{ symbol('billing.create').name }}"] --> Check["{{ symbol('billing.validate').name }}"]
  {{ diagram.link('Create', 'billing.create') }}
\`\`\`

## Declared dependencies

{{ diagram.dependencies("billing.create") }}
`;
  const project = fixture(t, { 'src/billing.ts': source('createInvoice'), 'docs/flow.md': diagram });
  const options = ['--page', 'docs/flow.md', '--out', 'wiki', '--strict'];
  project.run('build', '--entry', 'src/billing.ts', ...options);
  const original = project.read('wiki/pages/docs/flow.md');
  assert.match(original, /Create\["createInvoice"\]/);
  assert.match(original, /s0 --> s1/);
  assert.match(original, /billing\.ts\.md#doc-billing\.create/);

  project.write('src/invoices.ts', source('issueInvoice'));
  rmSync(join(project.cwd, 'src/billing.ts'));
  project.run('build', '--entry', 'src/invoices.ts', ...options, '--format', 'html');
  const moved = project.read('wiki/pages/docs/flow.html');
  assert.match(moved, /Create\[&quot;issueInvoice&quot;\]/);
  assert.match(moved, /invoices\.ts\.html#doc-billing\.create/);
  const invoices = project.read('wiki/modules/src/invoices.ts.html');
  assert.match(invoices, /id="doc-billing\.create"/);
  assert.match(invoices, /id="symbol-issueInvoice"/);
  assert.doesNotMatch(moved, /createInvoice|\{\{\s*(?:symbol|diagram)/);
  assert.equal(project.read('docs/flow.md'), diagram);
});

test('keeps unusual export names inside a single Mermaid label', t => {
  const project = fixture(t, {
    'src/billing.ts': `/** @realdocs:docId billing.special */
const original = 1;
export { original as 'quoted"<item>' };
`,
    'docs/flow.md': `# Diagram

\`\`\`mermaid
flowchart LR
  A["{{ symbol('billing.special').name }}"]
\`\`\`
`,
  });
  project.run('build', '--entry', 'src/billing.ts', '--page', 'docs/flow.md', '--out', 'wiki');
  assert.match(project.read('wiki/pages/docs/flow.md'), /A\["quoted#34;#60;item#62;"\]/);
});

test('check rejects duplicate IDs and reports unresolved diagram references at their source', t => {
  const project = fixture(t, {
    'src/billing.ts': `/**
 * @realdocs:docId billing.create
 * @realdocs:docUses billing.missing
 */
export function createInvoice() {}
/** @realdocs:docId billing.create */
export function otherInvoice() {}
`,
    'docs/flow.md': `# Diagram

\`\`\`mermaid
flowchart LR
  A["{{ symbol('billing.gone').name }}"]
\`\`\`
`,
  });
  const result = project.result('check', '--entry', 'src/billing.ts', '--page', 'docs/flow.md', '--out', 'wiki');
  assert.equal(result.status, 1, result.stderr);
  assert.match(result.stderr, /error: Duplicate @realdocs:docId billing\.create/);
  assert.match(result.stderr, /error: .*billing\.missing/);
  assert.match(result.stderr, /docs\/flow\.md:5:\d+: error: .*billing\.gone/);
  assert.equal(existsSync(join(project.cwd, 'wiki')), false);
});

test('check reports unfinished and misplaced diagram directives', t => {
  const project = fixture(t, {
    'src/billing.ts': '/** @realdocs:docId billing.create */\nexport function createInvoice() {}',
    'docs/flow.md': `# Diagram

\`\`\`mermaid
flowchart LR
  A["{{ symbol('billing.create').name }} {{ symbol('billing.create').name"]
  click A href "https://example.com/{{ symbol('billing.create').name }}"
\`\`\`

Put the graph here {{ diagram.dependencies('billing.create') }}.

\`{{ diagram.dependencies('billing.create') }}\` is a literal example.

\\{{ diagram.dependencies('billing.create') }} is also literal.
`,
  });
  const result = project.result('check', '--entry', 'src/billing.ts', '--page', 'docs/flow.md');
  assert.equal(result.status, 1, result.stderr);
  assert.match(result.stderr, /docs\/flow\.md:5:\d+: error: Unterminated Mermaid reference/);
  assert.match(result.stderr, /docs\/flow\.md:6:\d+: error: .*double-quoted Mermaid label/);
  assert.match(result.stderr, /docs\/flow\.md:9:\d+: error: .*diagram\.dependencies/);
  assert.doesNotMatch(result.stderr, /docs\/flow\.md:(11|13):/);
});

test('keeps HTML navigation and symbol anchors outside the authored overview', t => {
  const project = fixture(t, {
    'index.ts': `/**
 * @realdocs:file Overview with an incomplete example.
 *
 * <div id="symbol-count"></div>
 *
 * \`\`\`text
 * This code fence has no closing line.
 */
export const count = 1;
`,
  });
  project.run('build', '--entry', 'index.ts', '--out', 'wiki', '--format', 'html');

  const page = project.read('wiki/modules/index.ts.html');
  assert.match(page, /&lt;div id=&quot;symbol-count&quot;&gt;/);
  assert.match(page, /<pre><code class="language-text">This code fence has no closing line\.\n<\/code><\/pre>/);
  assert.match(page, /href="\.\.\/index\.html"/);
  assert.equal(page.match(/id="symbol-count"/g)?.length, 1);
  assert.match(page, /<h2(?: [^>]*)?><code>count<\/code><\/h2>/);
});

test('embeds the file map and its relationships in both wiki indexes', t => {
  const project = fixture(t, {
    'src/index.ts': "export { prepare } from './workflow.js';",
    'src/workflow.ts': `/**
 * @realdocs:file Coordinates stock. See the [guide](../docs/guide.md).
 * @realdocs:zone Operations
 */
import type { Order } from './model/order.js';
import { stock } from './inventory.js';
export function prepare(order: Order) { return stock(order.quantity); }
`,
    'src/model/order.ts': 'export interface Order { quantity: number }',
    'src/inventory.ts': 'export const stock = (quantity: number) => quantity > 0;',
    'docs/guide.md': '<!-- @realdocs:zone Architecture -->\n# Guide\n\n[Workflow](../src/workflow.ts#prepare)\n',
  });
  const args = ['--entry', 'src/index.ts', '--entry', 'src/workflow.ts', '--page', 'docs/guide.md', '--graph'];
  project.run('build', ...args, '--out', 'wiki');
  const graph = project.read('wiki/index.md');
  assert.match(graph, /^## File map\n\n```mermaid\nflowchart/m);
  assert.match(graph, /\(pages\/docs\/guide\.md\)/);
  assert.equal(existsSync(join(project.cwd, 'wiki/graph.md')), false);
  assert.match(graph, /Architecture/);
  assert.match(graph, /src\/model\/order\.ts/);

  project.run('build', ...args, '--out', 'site', '--format', 'html');
  const html = project.read('site/index.html');
  assert.match(html, /<section[^>]*aria-labelledby="file-map-title"/);
  assert.match(html, /<h2 id="file-map-title">File map<\/h2>/);
  assert.equal(existsSync(join(project.cwd, 'site/graph.html')), false);
  assert.match(html, /src="assets\/cytoscape\.min\.js"/);
  assert.doesNotMatch(project.read('site/modules/src/index.ts.html'), /file-map-data|cytoscape/);
  const data = JSON.parse(html.match(/<script type="application\/json" id="file-map-data">(.*?)<\/script>/s)[1]);
  assert.deepEqual(data.nodes.map(node => [node.path, node.zone, node.href ?? null]), [
    ['docs/guide.md', 'Architecture', 'pages/docs/guide.html'],
    ['src/index.ts', 'src', 'modules/src/index.ts.html'],
    ['src/inventory.ts', 'src', null],
    ['src/model/order.ts', 'src/model', null],
    ['src/workflow.ts', 'Operations', 'modules/src/workflow.ts.html'],
  ]);
  assert.deepEqual(data.edges.map(({ source, target, kind }) => [source, target, kind]), [
    ['docs/guide.md', 'src/workflow.ts', 'doc-link'],
    ['src/index.ts', 'src/workflow.ts', 're-export'],
    ['src/workflow.ts', 'docs/guide.md', 'doc-link'],
    ['src/workflow.ts', 'src/inventory.ts', 'import'],
    ['src/workflow.ts', 'src/model/order.ts', 'type-only'],
  ]);

  project.run('build', ...args.filter(arg => arg !== '--graph'), '--out', 'site', '--format', 'html');
  assert.doesNotMatch(project.read('site/index.html'), /file-map-data|cytoscape/);
  assert.equal(existsSync(join(project.cwd, 'site/assets/cytoscape.min.js')), false);
});

test('includes explicitly selected Markdown and resolves links in both wiki formats', t => {
  const project = fixture(t, {
    'README.md': '# Fulfillment\n\n[Design][architecture]\n\n[architecture]: docs/architecture.md#shipment-flow\n',
    'docs/architecture.md': `# Architecture

## Shipment flow

[Read the overview](../README.md#fulfillment) and [prepare a shipment](../src/index.ts#prepareShipment).

[See the decision](#decision-notes).

> ### Decision notes ###

\`\`\`md
[Literal reference](../src/index.ts#example)
\`\`\`
`,
    'src/index.ts': '/** @realdocs:file See the [shipment flow](../docs/architecture.md#shipment-flow). */\nexport function prepareShipment() {}',
    'notes.md': '# Private notes',
  });
  const args = ['--entry', 'src/index.ts', '--page', 'README.md', '--page', 'docs/architecture.md', '--strict'];
  project.run('build', ...args, '--out', 'wiki');
  project.run('build', ...args, '--out', 'site', '--format', 'html');

  assert.match(project.read('wiki/index.md'), /\[Fulfillment\]\(pages\/README\.md\)/);
  assert.match(project.read('wiki/modules/src/index.ts.md'), /\(\.\.\/\.\.\/pages\/docs\/architecture\.md#shipment-flow\)/);
  const architecture = project.read('wiki/pages/docs/architecture.md');
  assert.match(architecture, /id="shipment-flow"/);
  assert.match(architecture, /\(\.\.\/\.\.\/modules\/src\/index\.ts\.md#symbol-prepareShipment\)/);
  assert.match(architecture, /\[Literal reference\]\(\.\.\/src\/index\.ts#example\)/);
  assert.match(architecture, /^> ### Decision notes <a id="decision-notes"><\/a> ###$/m);
  assert.equal(existsSync(join(project.cwd, 'wiki/pages/notes.md')), false);

  assert.match(project.read('site/index.html'), /href="pages\/docs\/architecture\.html"/);
  assert.match(project.read('site/pages/README.html'), /href="docs\/architecture\.html#shipment-flow"/);
  const html = project.read('site/pages/docs/architecture.html');
  assert.match(html, /<h2 id="shipment-flow">Shipment flow<\/h2>/);
  assert.match(html, /href="\.\.\/README\.html#fulfillment"/);
  assert.match(html, /href="\.\.\/\.\.\/modules\/src\/index\.ts\.html#symbol-prepareShipment"/);
  assert.match(html, /<h3 id="decision-notes">Decision notes<\/h3>/);
});

test('preserves query values when a Markdown link is rewritten', t => {
  const project = fixture(t, {
    'README.md': '# Guide\n\n<div>\n## Literal heading\n[Filtered guide](other.md?filter=foo\\)&amp;copy;#linked-guide)\n</div>\n',
    'other.md': '# Linked guide',
  });
  project.run('build', '--page', 'README.md', '--page', 'other.md', '--strict', '--out', 'wiki', '--format', 'html');
  const html = project.read('wiki/pages/README.html');
  assert.match(html, /href="other\.html\?filter=foo%29&amp;copy;#linked-guide"/);
  assert.match(html, /id="literal-heading"/);

  project.run('build', '--page', 'README.md', '--page', 'other.md', '--strict', '--out', 'markdown');
  const markdown = project.read('markdown/pages/README.md');
  assert.match(markdown, /<div>\n## Literal heading\n/);
  assert.doesNotMatch(markdown, /id="literal-heading"/);
});

test('checks links in Markdown-only projects and reports missing targets at the source line', t => {
  const project = fixture(t, {
    'README.md': '# Guide\n\n[Missing guide](other.md)\n\n[Missing section](#missing)\n',
    'other.md': '# Linked guide',
  });
  const result = project.result('check', '--page', 'README.md', '--strict', '--out', 'wiki');
  assert.equal(result.status, 1, result.stderr);
  assert.match(result.stderr, /README\.md:3:\d+: warning: .*other\.md/);
  assert.match(result.stderr, /README\.md:5:\d+: warning: .*missing/);
  assert.equal(existsSync(join(project.cwd, 'wiki')), false);

  project.write('README.md', '# Guide\n\n[Linked guide](other.md)\n\n[unused]: missing.md\n');
  project.run('build', '--page', 'README.md', '--page', 'other.md', '--strict', '--out', 'wiki');
  assert.match(project.read('wiki/pages/README.md'), /\[Linked guide\]\(other\.md\)/);
});

test('resolves GitHub heading slugs, explicit anchors, and line fragments in both formats', t => {
  const project = fixture(t, {
    'README.md': `# Guide

[Appendix](#8-appendix--source-notes) · [Phases](#deploy-phases) · [Body](guide.md#L9) · [Intro](guide.md#L4-L5)
[Top](guide.md#L1C2) · [Export](src/index.ts#L4)

<a id="deploy-phases"></a>
Deploy phases.

## 8. Appendix — source notes
`,
    'guide.md': `<!-- @realdocs:tag guides -->

# Guide

Intro.

## Second

Body.
`,
    'src/index.ts': '/** First. */\nexport const first = 1;\n/** Second. */\nexport function second() {}\n',
  });
  const args = ['--entry', 'src/index.ts', '--page', 'README.md', '--page', 'guide.md', '--strict'];
  project.run('build', ...args, '--out', 'wiki');
  const markdown = project.read('wiki/pages/README.md');
  assert.match(markdown, /<a id="8-appendix--source-notes"><\/a>/);
  assert.match(markdown, /\[Appendix\]\(#8-appendix--source-notes\)/);
  assert.match(markdown, /\[Phases\]\(#deploy-phases\)/);
  assert.match(markdown, /^<a id="deploy-phases"><\/a>$/m);
  assert.match(markdown, /\[Body\]\(guide\.md#second\)/);
  assert.match(markdown, /\[Intro\]\(guide\.md#guide\)/);
  assert.match(markdown, /\[Top\]\(guide\.md\)/);
  assert.match(markdown, /\[Export\]\(\.\.\/modules\/src\/index\.ts\.md#symbol-second\)/);

  project.run('build', ...args, '--out', 'site', '--format', 'html');
  const html = project.read('site/pages/README.html');
  assert.match(html, /<h2 id="8-appendix--source-notes">/);
  assert.match(html, /<a id="deploy-phases"><\/a>/);
  assert.doesNotMatch(html, /&lt;a id=/);
  assert.match(html, /href="guide\.html#second"/);

  project.write('README.md', '# Guide\n\n[Code](#in-code)\n\n```html\n<a id="in-code"></a>\n```\n\n`<a id="in-span"></a>` [Span](#in-span)\n');
  const code = project.result('check', '--page', 'README.md', '--strict');
  assert.equal(code.status, 1);
  assert.match(code.stderr, /#in-code has no matching heading/);
  assert.match(code.stderr, /#in-span has no matching heading/);
});

test('separates missing link targets from files outside the wiki, and links those to their source', t => {
  const project = fixture(t, {
    'README.md': `# Guide

[Missing](src/missing.ts) · [Helper](src/helper.ts#L2) · [Script](scripts/setup.sh) · [Folder](scripts/)
[Outside](../elsewhere.md)
`,
    'realdocs.json': '{"pages":["README.md"]}',
    'src/helper.ts': 'export const one = 1;\nexport const two = 2;\n',
    'scripts/setup.sh': 'echo setup\n',
  });
  const unconfigured = project.result('check', '--strict');
  assert.equal(unconfigured.status, 1);
  assert.match(unconfigured.stderr, /README\.md:3:\d+: warning: Documentation link src\/missing\.ts points to src\/missing\.ts, which does not exist\./);
  assert.match(unconfigured.stderr, /src\/helper\.ts#L2 points to an input that is not included\..*sourceUrl/);
  assert.match(unconfigured.stderr, /\.\.\/elsewhere\.md points to \.\.\/elsewhere\.md, which does not exist/);
  assert.doesNotMatch(unconfigured.stderr, /setup\.sh|scripts\//);

  project.write('realdocs.json', '{"sourceUrl":"https://example.com/repo/blob/main/","pages":["README.md"]}');
  const configured = project.result('check', '--strict');
  assert.equal(configured.status, 1);
  assert.match(configured.stderr, /src\/missing\.ts, which does not exist/);
  assert.doesNotMatch(configured.stderr, /not included/);

  project.write('README.md', '# Guide\n\n[Helper](src/helper.ts#L2) · [Script](scripts/setup.sh?raw=1) · [Folder](scripts/) · [Spaced](notes/a%20b.md)\n');
  project.write('notes/a b.md', '# Notes');
  project.run('build', '--strict', '--out', 'wiki');
  const markdown = project.read('wiki/pages/README.md');
  assert.match(markdown, /\[Helper\]\(https:\/\/example\.com\/repo\/blob\/main\/src\/helper\.ts#L2\)/);
  assert.match(markdown, /\[Script\]\(https:\/\/example\.com\/repo\/blob\/main\/scripts\/setup\.sh\?raw=1\)/);
  assert.match(markdown, /\[Folder\]\(https:\/\/example\.com\/repo\/blob\/main\/scripts\/\)/);
  assert.match(markdown, /\[Spaced\]\(https:\/\/example\.com\/repo\/blob\/main\/notes\/a%20b\.md\)/);

  for (const value of ['"github.com/repo"', '"ftp://example.com/repo"', '"https://example.com/repo#main"', '42']) {
    project.write('realdocs.json', `{"sourceUrl":${value},"pages":["README.md"]}`);
    assert.match(project.result('check').stderr, /realdocs\.json: sourceUrl must be an http\(s\) URL/);
  }
});

test('links files outside a versioned wiki at the release commit', t => {
  const project = fixture(t, {
    '.gitignore': 'dist/\n',
    'README.md': '# Guide\n\n[Script](scripts/setup.sh#L1)\n',
    'realdocs.json': '{"sourceUrl":"https://example.com/repo/blob/main","pages":["README.md"]}',
    'scripts/setup.sh': 'echo setup\n',
  });
  const git = (...args) => execFileSync('git', args, { cwd: project.cwd, encoding: 'utf8', stdio: 'pipe' });
  git('init', '-q');
  git('remote', 'add', 'origin', 'https://github.com/example/project.git');
  git('add', '.');
  git('-c', 'user.name=RealDocs Test', '-c', 'user.email=realdocs@example.invalid', '-c', 'commit.gpgsign=false', 'commit', '-qm', 'Source');
  const commit = git('rev-parse', 'HEAD').trim();

  project.run('build', '--out', 'latest');
  assert.match(project.read('latest/pages/README.md'), /\(https:\/\/example\.com\/repo\/blob\/main\/scripts\/setup\.sh#L1\)/);
  project.run('build', '--version', '1.0.0');
  assert.match(project.read('dist/realdocs-releases/1.0.0/pages/README.md'),
    new RegExp(`\\(https://github\\.com/example/project/blob/${commit}/scripts/setup\\.sh#L1\\)`));
});

test('watch updates a standalone page and recovers after it is restored', { timeout: 15_000 }, async t => {
  const project = fixture(t, { 'README.md': '# Guide\n\nOriginal guide.\n' });
  const child = spawn(process.execPath, [cli, 'watch', '--page', 'README.md', '--out', 'wiki', '--format', 'html'], {
    cwd: project.cwd,
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  const exited = once(child, 'exit');
  let output = '';
  for (const stream of [child.stdout, child.stderr]) stream.setEncoding('utf8').on('data', chunk => { output += chunk; });
  const waitFor = async (pattern, start = 0) => {
    const deadline = Date.now() + 6_000;
    while (!pattern.test(output.slice(start)) && child.exitCode === null && Date.now() < deadline) await delay(20);
    assert.match(output.slice(start), pattern, output);
  };

  try {
    const page = 'wiki/pages/README.html';
    await waitFor(/Watching for source changes/);
    const original = project.read(page);
    assert.match(original, /Original guide\./);

    const beforeRemoval = output.length;
    rmSync(join(project.cwd, 'README.md'));
    await waitFor(/Could not read Markdown page README\.md/, beforeRemoval);
    assert.equal(project.read(page), original);

    const beforeRestore = output.length;
    project.write('README.md', '# Guide\n\nUpdated guide.\n');
    await waitFor(/Generated 2 wiki page\(s\).*\(1 written\)/, beforeRestore);
    assert.match(project.read(page), /Updated guide\./);
  } finally {
    child.kill();
    await exited;
  }
});

test('reads compiler configs that use options the bundled TypeScript deprecates', t => {
  const project = fixture(t, {
    'tsconfig.json': '{"compilerOptions":{"module":"commonjs","strict":true}}',
    'runner/tsconfig.json': '{"compilerOptions":{"module":"commonjs","moduleResolution":"node","ignoreDeprecations":"5.0"}}',
    'src/value.ts': 'export const value = 1;',
    'src/index.ts': "import { value } from './value';\n/** The value. */\nexport const doubled = value * 2;",
    'runner/index.ts': "export { value } from '../src/value';",
  });
  assert.match(project.run('check', '--entry', 'src/index.ts', '--strict'), /Checked 1 module\(s\)/);
  assert.match(project.run('check', '--entry', 'runner/index.ts', '--project', 'runner/tsconfig.json', '--strict'), /Checked 1 module\(s\)/);
});

test('resolves untyped JS dependencies but rejects missing named imports', t => {
  const project = fixture(t, {
    'node_modules/plain/package.json': '{"main":"index.js"}',
    'node_modules/plain/index.js': 'module.exports = 1;',
    'start.js': "import value from 'plain'; import { basename } from 'node:path'; export const read = () => basename(value);",
    'broken.ts': "import { gone } from './local.js'; export const value = gone;",
    'local.ts': 'export const actual = 1;',
  });
  project.run('build', '--entry', 'start.js', '--out', 'wiki');
  const missing = project.result('check', '--entry', 'broken.ts');
  assert.equal(missing.status, 1, missing.stderr);
  assert.match(missing.stderr, /broken\.ts:1:\d+: error: .*gone/);
});

test('shows public class members and all parts of a merged interface', t => {
  const project = fixture(t, {
    'index.ts': `
export class Counter {
  private count = 0;
  constructor(readonly name: string) {}
  increment(by: number) { this.count += by; return this.count; }
  private reset() { this.count = 0; }
}
export interface Options { minimum: number }
export interface Options { maximum?: number }
`,
  });
  project.run('build', '--entry', 'index.ts', '--out', 'wiki');
  const page = project.read('wiki/modules/index.ts.md');
  assert.match(page, /constructor\(readonly name: string\)/);
  assert.match(page, /increment\(by: number\): number/);
  assert.doesNotMatch(page, /reset\(|private count/);
  assert.match(page, /minimum: number/);
  assert.match(page, /maximum\?: number/);
});

test('documents export assignments and distinguishes type-only re-exports', t => {
  const project = fixture(t, {
    'public.cjs': '/** Runs the task. */\nmodule.exports = function run(value) { return value === 1; };',
    'types.ts': 'function run(value: number) { return value; }\nexport type { run as Run };',
  });
  project.run('build', '--entry', 'public.cjs', '--entry', 'types.ts', '--out', 'wiki');
  const common = project.read('wiki/modules/public.cjs.md');
  assert.match(common, /module\.exports/);
  assert.match(common, /Runs the task/);
  const types = project.read('wiki/modules/types.ts.md');
  assert.match(types, /export type \{ run as Run \}/);
  assert.doesNotMatch(types, /export function Run/);
});

test('checks stale parameter docs and unresolved links without writing output', t => {
  const project = fixture(t, {
    'index.ts': `/**
 * See {@link Missing}.
 * @param former Former parameter.
 */
export function count(current: number) { return current; }
`,
  });

  const result = project.result('check', '--entry', 'index.ts', '--strict', '--out', 'wiki');

  assert.equal(result.status, 1, result.stderr);
  assert.match(result.stderr, /index\.ts:\d+:\d+: warning: .*@param.*former/);
  assert.match(result.stderr, /index\.ts:\d+:\d+: warning: .*link.*Missing/i);
  assert.equal(existsSync(join(project.cwd, 'wiki')), false);
});

test('refreshes changed facts and removes pages for removed entry points', t => {
  const project = fixture(t, {
    'index.ts': '/** Original explanation. */\nexport function count(n: number) { return n; }',
    'extra.ts': 'export const extra = 1;',
  });
  const currentPage = 'wiki/modules/index.ts.md';
  project.run('build', '--entry', 'index.ts', '--entry', 'extra.ts', '--out', 'wiki');
  assert.match(project.read(currentPage), /Original explanation/);

  project.write('index.ts', '/** Current explanation. */\nexport function count(n: string) { return n.length; }');
  project.run('build', '--entry', 'index.ts', '--out', 'wiki');

  const contents = project.read(currentPage);
  assert.match(contents, /count\(n: string\): number/);
  assert.match(contents, /Current explanation/);
  assert.doesNotMatch(contents, /Original explanation/);
  assert.deepEqual(readdirSync(join(project.cwd, 'wiki/modules')), ['index.ts.md']);
  const modified = statSync(join(project.cwd, currentPage)).mtimeMs;
  project.run('build', '--entry', 'index.ts', '--out', 'wiki');
  assert.equal(project.read(currentPage), contents);
  assert.equal(statSync(join(project.cwd, currentPage)).mtimeMs, modified);
});

test('keeps the last successful wiki when a re-export breaks', t => {
  const project = fixture(t, { 'index.ts': 'export const count = 1;' });
  project.run('build', '--entry', 'index.ts', '--out', 'wiki');
  const currentPage = 'wiki/modules/index.ts.md';
  const original = project.read(currentPage);
  project.write('index.ts', "export * from './missing.js';");

  const result = project.result('build', '--entry', 'index.ts', '--out', 'wiki');

  assert.equal(result.status, 1, result.stderr);
  assert.match(result.stderr, /index\.ts:1:\d+: error: .*missing\.js/);
  assert.equal(project.read(currentPage), original);
});

test('preserves an existing output directory that contains user files', t => {
  const project = fixture(t, {
    'index.ts': 'export const count = 1;',
    'wiki/manual.md': 'A manually maintained page.',
  });

  const result = project.result('build', '--entry', 'index.ts', '--out', 'wiki');

  assert.equal(result.status, 1, result.stderr);
  assert.match(result.stderr, /contains files RealDocs does not manage/);
  assert.deepEqual(readdirSync(join(project.cwd, 'wiki')), ['manual.md']);
  assert.equal(project.read('wiki/manual.md'), 'A manually maintained page.');
});

test('preserves a manual file added between staging and publishing', t => {
  const project = fixture(t, {
    'index.ts': 'export const count = 1;',
    'preload.cjs': `
const fs = require('node:fs');
const path = require('node:path');
const rename = fs.renameSync;
fs.renameSync = (from, to) => {
  if (path.basename(from) === 'wiki') fs.writeFileSync(path.join(from, 'manual.md'), 'Keep this.');
  return rename(from, to);
};
require('node:module').syncBuiltinESMExports();
`,
  });
  project.run('build', '--entry', 'index.ts', '--out', 'wiki');
  const original = project.read('wiki/modules/index.ts.md');
  project.write('index.ts', 'export const count = 2;');

  const result = project.withPreload('build', '--entry', 'index.ts', '--out', 'wiki');

  assert.equal(result.status, 1, result.stderr);
  assert.equal(project.read('wiki/manual.md'), 'Keep this.');
  assert.equal(project.read('wiki/modules/index.ts.md'), original);
});

test('recovers an interrupted output swap on the next build', { skip: process.platform === 'win32' }, t => {
  const project = fixture(t, {
    'index.ts': 'export const count = 1;',
    'preload.cjs': `
const fs = require('node:fs');
const path = require('node:path');
const rename = fs.renameSync;
fs.renameSync = (from, to) => {
  if (path.basename(from) === 'next' && path.basename(to) === 'wiki') process.kill(process.pid, 'SIGKILL');
  return rename(from, to);
};
require('node:module').syncBuiltinESMExports();
`,
  });
  project.run('build', '--entry', 'index.ts', '--out', 'wiki');
  project.write('index.ts', 'export const count = 2;');

  assert.equal(project.withPreload('build', '--entry', 'index.ts', '--out', 'wiki').signal, 'SIGKILL');
  project.run('build', '--entry', 'index.ts', '--out', 'wiki');
  assert.match(project.read('wiki/modules/index.ts.md'), /const count: 2/);
});

test('watch keeps the last successful wiki when code and a Markdown page change together', { timeout: 45_000 }, async t => {
  const project = fixture(t, {
    'tsconfig.json': '{"include":["src"]}',
    'README.md': '# Guide\n\nOriginal guide.\n',
    'src/index.ts': "export { count } from './counts.js';",
    'src/counts.ts': '/** Original description. */\nexport function count(value: number) { return value; }',
  });
  const inputs = ['--entry', 'src/index.ts', '--page', 'README.md'];
  const child = spawn(process.execPath, [cli, 'watch', ...inputs, '--out', 'wiki', '--timings'], {
    cwd: project.cwd,
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  const exited = once(child, 'exit');
  let output = '';
  for (const stream of [child.stdout, child.stderr]) {
    stream.setEncoding('utf8').on('data', chunk => { output += chunk; });
  }
  const waitForOutput = async (pattern, start = 0) => {
    const deadline = Date.now() + 12_000;
    while (!pattern.test(output.slice(start)) && child.exitCode === null && Date.now() < deadline) await delay(20);
    assert.match(output.slice(start), pattern, output);
  };

  try {
    const page = 'wiki/modules/src/index.ts.md';
    const guide = 'wiki/pages/README.md';
    await waitForOutput(/Watching for source changes/);
    const original = project.read(page);
    const originalGuide = project.read(guide);
    assert.match(original, /Original description/);

    const beforeError = output.length;
    project.write('README.md', '# Guide\n\nUpdated guide.\n');
    project.write('src/counts.ts', 'export function count(');
    await waitForOutput(/counts\.ts:\d+:\d+: error:/, beforeError);
    assert.equal(project.read(page), original);
    assert.equal(project.read(guide), originalGuide);

    const beforeRecovery = output.length;
    project.write('src/counts.ts', '/** Updated description. */\nexport function count(value: string) { return value.length; }');
    await waitForOutput(/Compiler and extraction \d+ ms, Markdown \d+ ms, output \d+ ms/, beforeRecovery);
    const updated = project.read(page);
    assert.match(updated, /Updated description/);
    assert.match(updated, /count\(value: string\): number/);
    assert.match(project.read(guide), /Updated guide\./);

    project.run('build', ...inputs, '--out', 'clean-wiki');
    assert.equal(project.read('clean-wiki/modules/src/index.ts.md'), updated);
  } finally {
    child.kill();
    await exited;
  }
});
