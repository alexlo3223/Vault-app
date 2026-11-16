import { test } from 'node:test';
import assert from 'node:assert/strict';
import { aggregate, filterRows, groupRows, parseDb, parseFilter, serializeDb, sortRows } from '../public/database.mjs';

const rows = [
  { name: 'Dune', props: { status: 'reading', pages: '412', author: 'Herbert' } },
  { name: 'Piranesi', props: { status: 'read', pages: '245', author: 'Clarke' } },
  { name: 'Emma', props: { status: 'todo', pages: '474', tags: ['classic', 'romance'] } },
  { name: 'Untitled', props: {} },
];

test('a block without separators is one table view (blocks written before views still work)', () => {
  const cfg = parseDb('source: Books\nview: table\nshow: author, status\ngroup: status');
  assert.equal(cfg.source, 'Books');
  assert.equal(cfg.views.length, 1);
  assert.equal(cfg.views[0].view, 'table');
  assert.deepEqual(cfg.views[0].show, ['author', 'status']);
  assert.equal(cfg.views[0].group, 'status');
});

test('separators split the block into several views, each with its own settings', () => {
  const cfg = parseDb('source: Books\nname: Reading\nview: gallery\nfilter: status = reading\n---\nname: Total\nview: number\nvalue: pages\nagg: sum');
  assert.deepEqual(
    cfg.views.map((v) => [v.name, v.view]),
    [
      ['Reading', 'gallery'],
      ['Total', 'number'],
    ],
  );
  assert.deepEqual(cfg.views[0].filter, [{ key: 'status', op: '=', value: 'reading' }]);
  assert.equal(cfg.views[1].agg, 'sum');
});

test('unknown view types and aggregates fall back to safe defaults', () => {
  const cfg = parseDb('view: pie\n---\nview: number\nagg: median');
  assert.equal(cfg.views[0].view, 'table');
  assert.equal(cfg.views[1].agg, '');
});

test('serializing and parsing again gives the same settings', () => {
  const text = 'source: Books\nname: Reading\nview: board\nfilter: status != todo\nfilter: pages > 300\nsort: pages desc\ngroup: status\n---\nname: Total\nview: donut\nvalue: pages\nagg: sum\nfit: contain';
  const cfg = parseDb(text);
  assert.deepEqual(parseDb(serializeDb(cfg)), cfg);
  assert.equal(serializeDb(cfg).split('\n').filter((l) => l === '---').length, 1);
});

test('filters read operators and words', () => {
  assert.deepEqual(parseFilter('pages > 300'), { key: 'pages', op: '>', value: '300' });
  assert.deepEqual(parseFilter('Total pages >= 10'), { key: 'Total pages', op: '>=', value: '10' });
  assert.deepEqual(parseFilter('status empty'), { key: 'status', op: 'empty', value: '' });
  assert.equal(parseFilter('no operator here'), null);
  assert.deepEqual(
    filterRows(rows, [{ key: 'pages', op: '>', value: '300' }]).map((r) => r.name),
    ['Dune', 'Emma'],
  );
  assert.deepEqual(
    filterRows(rows, [{ key: 'status', op: '!=', value: 'todo' }]).map((r) => r.name),
    ['Dune', 'Piranesi', 'Untitled'],
  );
  assert.deepEqual(
    filterRows(rows, [{ key: 'status', op: 'empty', value: '' }]).map((r) => r.name),
    ['Untitled'],
  );
  assert.deepEqual(
    filterRows(rows, [{ key: 'author', op: 'contains', value: 'HERB' }]).map((r) => r.name),
    ['Dune'],
  );
});

test('sorting uses numbers for numeric properties, and descending when asked', () => {
  assert.deepEqual(
    sortRows(rows, 'pages desc').map((r) => r.name),
    ['Emma', 'Dune', 'Piranesi', 'Untitled'],
  );
  assert.deepEqual(sortRows(rows, 'name').map((r) => r.name), ['Dune', 'Emma', 'Piranesi', 'Untitled']);
});

test('aggregates: count, sum, average, minimum and maximum of a numeric property', () => {
  assert.equal(aggregate(rows), 4);
  assert.equal(aggregate(rows, 'pages', 'sum'), 412 + 245 + 474);
  assert.equal(aggregate(rows, 'pages', 'max'), 474);
  assert.equal(aggregate(rows, 'pages', 'min'), 245);
  assert.equal(aggregate([], 'pages', 'sum'), 0);
});

test('groups keep first-seen order and put notes without the property in ""', () => {
  assert.deepEqual([...groupRows(rows, 'status').keys()], ['reading', 'read', 'todo', '']);
  assert.equal(groupRows(rows, 'tags').get('classic, romance')?.[0].name, 'Emma');
});

test('an embed names a database page and the view to start on; it round-trips', async () => {
  const { extractDatabase } = await import('../public/database.mjs');
  const cfg = parseDb('page: Book Library/Books\nuse: Reading');
  assert.equal(cfg.page, 'Book Library/Books');
  assert.equal(cfg.use, 'Reading');
  assert.equal(serializeDb(cfg), 'page: Book Library/Books\nuse: Reading');
});

test('the database block of a page is found, with ~~~ or ``` fences', async () => {
  const { extractDatabase } = await import('../public/database.mjs');
  assert.equal(extractDatabase('# Books\n\n~~~database\nsource: Books\nview: table\n~~~\n'), 'source: Books\nview: table');
  assert.equal(extractDatabase('```database\nsource: X\n```'), 'source: X');
  assert.equal(extractDatabase('# No database here\n\nplain text'), null);
});
