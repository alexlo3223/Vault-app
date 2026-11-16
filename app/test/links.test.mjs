import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { buildIndex } from '../lib/search.mjs';
import { backlinks, buildLinkGraph, extractLinks } from '../lib/links.mjs';

const FIXTURE = {
  'Dogs.md': '# Dogs\nGood boys. See [[Cats|the cats]] and [[Missing note]].\n![[photo.png]]',
  'Cats.md': 'Cats ignore [[dogs#Training]] twice: [[Dogs]].\n```\n[[Code link]]\n```',
  'sub/Cats.md': 'Other cats note, links [vault dogs](../Dogs.md).',
  'sub/walk.md': 'Took the dogs for a walk. [[Cats]]',
  'notes.md': 'I like hotdogs.',
  'path.md': '[[sub/Cats]] and [[nowhere/Cats]]',
};

async function setup() {
  const root = await mkdtemp(join(tmpdir(), 'vault-links-'));
  for (const [rel, body] of Object.entries(FIXTURE)) {
    const full = join(root, rel);
    await mkdir(join(full, '..'), { recursive: true });
    await writeFile(full, body);
  }
  const docs = await buildIndex(root);
  return { docs, graph: buildLinkGraph(docs) };
}

test('extractLinks reads wikilinks, aliases, headings and .md links; skips code, urls, attachments', () => {
  assert.deepEqual(
    extractLinks('[[A|x]] [[B#h]] ![[C]] [[#self]] [t](d/E%20F.md#x) [w](https://x.md) ![[i.png]]\n`[[G]]`'),
    ['A', 'B', 'C', 'd/E F.md'],
  );
});

test('links resolve same folder first, then shortest path; folder links must match', async () => {
  const { graph } = await setup();
  assert.equal(graph.resolveLink('Cats', 'Dogs.md'), 'Cats.md');
  assert.equal(graph.resolveLink('Cats', 'sub/walk.md'), 'sub/Cats.md');
  assert.equal(graph.resolveLink('cats', 'other/x.md'), 'Cats.md');
  assert.equal(graph.resolveLink('sub/Cats', 'path.md'), 'sub/Cats.md');
  assert.equal(graph.resolveLink('nowhere/Cats', 'path.md'), null);
});

test('graph counts resolved and unresolved links per source', async () => {
  const { graph } = await setup();
  assert.deepEqual(graph.resolved['Cats.md'], { 'Dogs.md': 2 });
  assert.deepEqual(graph.resolved['sub/Cats.md'], { 'Dogs.md': 1 });
  assert.deepEqual(graph.unresolved, {
    'Dogs.md': { 'Missing note': 1 },
    'path.md': { 'nowhere/Cats': 1 },
  });
});

test('backlinks split linked and unlinked mentions', async () => {
  const { docs, graph } = await setup();
  const dogs = backlinks(docs, graph, 'Dogs.md');
  assert.deepEqual(dogs.linked, [
    { path: 'Cats.md', count: 2 },
    { path: 'sub/Cats.md', count: 1 },
  ]);
  assert.deepEqual(dogs.unlinked.map((u) => u.path), ['sub/walk.md']);

  const subCats = backlinks(docs, graph, 'sub/Cats.md');
  assert.deepEqual(subCats.linked.map((l) => l.path), ['path.md', 'sub/walk.md']);
  assert.deepEqual(subCats.unlinked.map((u) => u.path), ['Cats.md']);
});
