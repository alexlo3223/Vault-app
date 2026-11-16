import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { buildIndex, parseQuery, search } from '../lib/search.mjs';

const FIXTURE = {
  'cats.md': '# Cats\n\nCats purr.\n\nDogs bark.',
  'dogs.md': 'Dogs bark loudly.\n\n## Notes\nCats and dogs.\n#pets/dogs',
  'sub/notes.md': 'Dogs and cats together on one line.\n\nSeparate block about birds.\n#work',
  'code.md': '```\n#fakeTag\ncats\n```\nno tags',
  '.obsidian/hidden.md': 'cats cats cats',
};

async function vault() {
  const root = await mkdtemp(join(tmpdir(), 'vault-search-'));
  for (const [rel, body] of Object.entries(FIXTURE)) {
    const full = join(root, rel);
    await mkdir(join(full, '..'), { recursive: true });
    await writeFile(full, body);
  }
  return buildIndex(root);
}

const paths = (hits) => hits.map((h) => h.doc.path).sort();

test('buildIndex skips dot-folders and reads .md only', async () => {
  const docs = await vault();
  assert.deepEqual(paths(docs.map((doc) => ({ doc }))), ['cats.md', 'code.md', 'dogs.md', 'sub/notes.md']);
});

test('parseQuery reads phrases, groups, negation and match-case', () => {
  const { clauses, matchCase } = parseQuery('match-case: "dogs and cats" -tag:#work line:(a b) word');
  assert.equal(matchCase, true);
  assert.deepEqual(clauses, [
    { field: 'content', neg: false, together: true, needles: ['dogs and cats'] },
    { field: 'tag', neg: true, together: false, needles: ['work'] },
    { field: 'line', neg: false, together: true, needles: ['a', 'b'] },
    { field: 'content', neg: false, together: false, needles: ['word'] },
  ]);
});

test('plain words match content across the vault', async () => {
  const docs = await vault();
  assert.deepEqual(paths(search(docs, 'cats')), ['cats.md', 'code.md', 'dogs.md', 'sub/notes.md']);
});

test('negation excludes files containing the term', async () => {
  const docs = await vault();
  assert.deepEqual(paths(search(docs, 'cats -dogs')), ['code.md']);
});

test('tag: matches nested tags and ignores tags inside code', async () => {
  const docs = await vault();
  assert.deepEqual(paths(search(docs, 'tag:pets')), ['dogs.md']);
  assert.deepEqual(paths(search(docs, 'tag:fakeTag')), []);
});

test('tag: also reads tags from the YAML frontmatter', async () => {
  const root = await mkdtemp(join(tmpdir(), 'vault-fm-'));
  await writeFile(join(root, 'a.md'), '---\ntags: [alpha, "beta"]\n---\nBody');
  await writeFile(join(root, 'b.md'), '---\ntags:\n  - gamma\n  - "#delta"\n---\nBody');
  const indexed = await buildIndex(root);
  assert.deepEqual(paths(search(indexed, 'tag:beta')), ['a.md']);
  assert.equal(search(indexed, 'tag:beta')[0].snippet, 'Body'); // not the "---" frontmatter fence
  assert.deepEqual(paths(search(indexed, 'tag:delta')), ['b.md']);
  assert.deepEqual(paths(search(indexed, 'tag:gamma')), ['b.md']);
});

test('block: needs both terms in one block', async () => {
  const docs = await vault();
  assert.deepEqual(paths(search(docs, 'block:(birds dogs)')), []);
  assert.deepEqual(paths(search(docs, 'block:(dogs cats)')), ['dogs.md', 'sub/notes.md']);
});

test('line: and section: scope terms to one line or heading section', async () => {
  const docs = await vault();
  assert.deepEqual(paths(search(docs, 'line:(dogs purr)')), []);
  assert.deepEqual(paths(search(docs, 'section:(notes cats)')), ['dogs.md']);
});

test('file: and path: match name and folder', async () => {
  const docs = await vault();
  assert.deepEqual(paths(search(docs, 'file:dogs')), ['dogs.md']);
  assert.deepEqual(paths(search(docs, 'path:sub')), ['sub/notes.md']);
});

test('phrases and match-case are exact', async () => {
  const docs = await vault();
  assert.deepEqual(paths(search(docs, '"dogs and cats"')), ['sub/notes.md']);
  assert.deepEqual(paths(search(docs, 'match-case: Cats')), ['cats.md', 'dogs.md']);
});

test('relevance boosts title hits; modified sort orders by mtime', async () => {
  const docs = await vault();
  assert.equal(search(docs, 'dogs')[0].doc.path, 'dogs.md');
  const byTime = search(docs, 'cats', { sort: 'modified' });
  for (let i = 1; i < byTime.length; i++) {
    assert.ok(byTime[i - 1].doc.mtime >= byTime[i].doc.mtime);
  }
});
