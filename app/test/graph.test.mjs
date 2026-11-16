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
