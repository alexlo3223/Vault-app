import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createLayout, parseProps } from '../public/graph.mjs';

const ring = (n) => ({
  nodes: Array.from({ length: n }, (_, i) => ({ id: `n${i}` })),
  edges: Array.from({ length: n }, (_, i) => ({ source: `n${i}`, target: `n${(i + 1) % n}` })),
});
const dist = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);

test('layout gives every node finite coordinates and is deterministic', () => {
  const run = () => {
    const { nodes, edges } = ring(12);
    createLayout(nodes, edges).run(200);
    return nodes.map((n) => [Math.round(n.x), Math.round(n.y)]);
  };
  const a = run();
  assert.ok(a.flat().every(Number.isFinite));
  assert.deepEqual(run(), a);
});

test('linked nodes end up closer than unlinked ones, and isolated nodes stay apart', () => {
  const { nodes, edges } = ring(10);
  nodes.push({ id: 'alone' }, { id: 'alone2' });
  createLayout(nodes, edges).run(300);
  const linked = edges.map((e) => dist(nodes.find((n) => n.id === e.source), nodes.find((n) => n.id === e.target)));
  const avgLinked = linked.reduce((s, d) => s + d, 0) / linked.length;
  const opposite = dist(nodes[0], nodes[5]);
  assert.ok(avgLinked < opposite, `${avgLinked} < ${opposite}`);
  assert.ok(dist(nodes[10], nodes[11]) > 20);
});

test('layout copes with empty and single-node graphs and unknown edge ids', () => {
  createLayout([], []).run(10);
  const nodes = [{ id: 'a' }];
  createLayout(nodes, [{ source: 'a', target: 'missing' }]).run(10);
  assert.ok(Number.isFinite(nodes[0].x));
});

test('parseProps reads flat frontmatter and returns null for nested YAML', () => {
  const fm = '---\nstatus: fleeting\ncreated: 2024-10-18 14:32\ntags: [ai, "heuristics"]\naliases:\n  - A\n  - B\nempty:\n---\n';
  assert.deepEqual(parseProps(fm), [
    { key: 'status', value: 'fleeting' },
    { key: 'created', value: '2024-10-18 14:32' },
    { key: 'tags', value: '', list: ['ai', 'heuristics'] },
    { key: 'aliases', value: '', list: ['A', 'B'] },
  ]);
  assert.deepEqual(parseProps(''), []);
  assert.equal(parseProps('---\nouter:\n  inner: 1\n---\n'), null);
  assert.equal(parseProps('---\ntext: |\n  block\n---\n'), null);
});

test('setProp writes lists, booleans and numbers, and replaces block lists whole', async () => {
  const { setProp: set, parseProps: read } = await import('../public/graph.mjs');
  let fm = set('', 'Genres', ['Fantasy', 'Sci-Fi', 'Dark, Academia']);
  assert.equal(fm, '---\nGenres: [Fantasy, Sci-Fi, "Dark, Academia"]\n---\n');
  assert.deepEqual(read(fm)[0].list, ['Fantasy', 'Sci-Fi', 'Dark, Academia']);
  fm = set(fm, 'Owned', false);
  fm = set(fm, 'Pages', 512);
  fm = set(fm, 'Quotes', ['[[Quote 1]]']);
  assert.equal(fm, '---\nGenres: [Fantasy, Sci-Fi, "Dark, Academia"]\nOwned: false\nPages: 512\nQuotes: ["[[Quote 1]]"]\n---\n');
  assert.deepEqual(read(fm).find((r) => r.key === 'Quotes').list, ['[[Quote 1]]']);
  assert.equal(set(fm, 'Genres', []).includes('Genres'), false);
  // a negative number stays a number in YAML
  assert.equal(set('', 'Delta', '-5'), '---\nDelta: -5\n---\n');
  // an Obsidian-style block list is replaced with all its lines
  assert.equal(set('---\ntags:\n  - a\n  - b\ntitle: x\n---\n', 'tags', ['c']), '---\ntags: [c]\ntitle: x\n---\n');
});

test('renameProp renames or removes a key with its list lines', async () => {
  const { renameProp } = await import('../public/graph.mjs');
  const fm = '---\nPage Count: 512\ntags:\n  - a\n  - b\nauthor: X\n---\n';
  assert.equal(renameProp(fm, 'Page Count', 'Pages'), '---\nPages: 512\ntags:\n  - a\n  - b\nauthor: X\n---\n');
  assert.equal(renameProp(fm, 'tags', ''), '---\nPage Count: 512\nauthor: X\n---\n');
  assert.equal(renameProp(fm, 'missing', 'x'), fm);
  assert.equal(renameProp('---\nonly: 1\n---\n', 'only', ''), '');
  // "Page" must not match "Page Count"
  assert.equal(renameProp(fm, 'Page', 'P'), fm);
});

test('a text with line breaks, tabs or quotes is written as one quoted value and read back as it was', async () => {
  const { setProp: set, parseProps: read } = await import('../public/graph.mjs');
  for (const text of ['primera línea\nsegunda línea', 'a\r\nb', 'con\ttabulador', 'una "comilla" y\nsalto', '\nempieza con salto', 'termina con salto\n']) {
    const fm = set('---\nstatus: todo\n---\n', 'Notas', text);
    const rows = read(fm);
    assert.notEqual(rows, null, `the frontmatter must stay readable: ${JSON.stringify(text)}`);
    assert.equal(rows.find((r) => r.key === 'Notas').value, text);
    assert.equal(rows.find((r) => r.key === 'status').value, 'todo'); // the other keys are not disturbed
    assert.equal(fm.split('\n').filter((l) => l.trim()).length, 4, 'one line for the value, no stray lines');
  }
  // plain text is still written plain
  assert.equal(set('', 'Notas', 'simple'), '---\nNotas: simple\n---\n');
});

test('dates, numbers and lists written by the properties read back from the frontmatter', async () => {
  const { setProp: set, parseProps: read } = await import('../public/graph.mjs');
  let fm = set('', 'Started', '2026-11-16T14:30');
  fm = set(fm, 'Pages', '412');
  fm = set(fm, 'Delta', '-3.5');
  fm = set(fm, 'Tags', ['uno', 'dos, tres', 'cua"tro']);
  const rows = Object.fromEntries(read(fm).map((r) => [r.key, r.list ?? r.value]));
  assert.deepEqual(rows, { Started: '2026-11-16T14:30', Pages: '412', Delta: '-3.5', Tags: ['uno', 'dos, tres', 'cua"tro'] });
});

test('ISO dates, with or without a time, are written plain so Obsidian reads them as dates', async () => {
  const { setProp: set, parseProps: read } = await import('../public/graph.mjs');
  assert.equal(set('', 'Started', '2026-11-16'), '---\nStarted: 2026-11-16\n---\n');
  assert.equal(set('', 'Started', '2026-11-16T14:30'), '---\nStarted: 2026-11-16T14:30\n---\n');
  assert.equal(read(set('', 'Started', '2026-11-16T14:30'))[0].value, '2026-11-16T14:30');
  // anything else with a colon is still quoted
  assert.equal(set('', 'Web', 'https://example.com'), '---\nWeb: "https://example.com"\n---\n');
  assert.equal(set('', 'Note', 'date: 2026-11-16'), '---\nNote: "date: 2026-11-16"\n---\n');
});
