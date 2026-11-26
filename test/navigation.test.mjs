import assert from 'node:assert/strict';
import { test } from 'node:test';
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
