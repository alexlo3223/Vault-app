import { test } from 'node:test';
import assert from 'node:assert/strict';
import { aggregate, extractDatabase, filterRows, groupRows, newDatabasePage, parseDb, parseFilter, serializeDb, sortRows } from '../public/database.mjs';

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

test('a new database page reads back as one view on its own folder', async () => {
  const table = parseDb(extractDatabase(newDatabasePage('Prueba/Database', 'table')));
  assert.equal(table.source, 'Prueba/Database');
  assert.equal(table.views[0].view, 'table');
  const board = parseDb(extractDatabase(newDatabasePage('Prueba/Tareas', 'board')));
  assert.equal(board.views[0].view, 'board');
  assert.equal(board.views[0].group, 'status');
});

test('the property schema reads back exactly, formulas with | , : and quotes included', async () => {
  const { serializeDb: ser, renamePropInDb } = await import('../public/database.mjs');
  const text = [
    'source: Library/Books',
    'prop: Page Count',
    'type: number',
    'prop: Genres',
    'type: multi-select',
    'options: Fantasy=purple, Sci-Fi=red, Dark Academia=gray',
    'prop: Progress',
    'type: formula',
    'formula: if(prop("Page Count") > 0 || false, round(prop("Pages Read") / prop("Page Count") * 100) / 100, 0)',
    'format: percent',
    'display: bar',
    'color: purple',
    'prop: Quotes',
    'type: relation',
    'relation: Library/Quotes',
    'name: All',
    'view: table',
    'show: Page Count, Genres, Progress',
    'sort: Page Count desc',
    '---',
    'name: By genre',
    'view: board',
    'group: Genres',
  ].join('\n');
  const cfg = parseDb(text);
  assert.deepEqual(cfg.props.map((p) => [p.name, p.type]), [['Page Count', 'number'], ['Genres', 'multi-select'], ['Progress', 'formula'], ['Quotes', 'relation']]);
  assert.deepEqual(cfg.props[1].options, [{ name: 'Fantasy', color: 'purple' }, { name: 'Sci-Fi', color: 'red' }, { name: 'Dark Academia', color: 'gray' }]);
  assert.match(cfg.props[2].formula, /\|\| false/);
  assert.equal(cfg.props[2].display, 'bar');
  assert.equal(cfg.views.length, 2);
  assert.equal(cfg.views[0].name, 'All');
  assert.equal(ser(cfg), text);
  assert.equal(ser(parseDb(ser(cfg))), text);

  // renaming a property follows it into formulas, views, sorting and grouping
  renamePropInDb(cfg, 'Page Count', 'Pages');
  assert.equal(cfg.props[0].name, 'Pages');
  assert.match(cfg.props[2].formula, /prop\("Pages"\) > 0/);
  assert.equal(cfg.views[0].sort, 'Pages desc');
  assert.deepEqual(cfg.views[0].show, ['Pages', 'Genres', 'Progress']);
  renamePropInDb(cfg, 'Genres', '');
  assert.equal(cfg.props.some((p) => p.name === 'Genres'), false);
  assert.equal(cfg.views[1].group, '');
});

test('blocks without a schema still read as before, and a property line never leaks into a view', () => {
  const cfg = parseDb('source: Books\nview: table\nshow: author');
  assert.deepEqual(cfg.props, []);
  assert.deepEqual(cfg.views[0].show, ['author']);
  // "type:" outside a property is ignored
  assert.deepEqual(parseDb('source: Books\ntype: number\nview: list').props, []);
});

test('sorting works with property names that contain spaces', async () => {
  const { parseSort } = await import('../public/database.mjs');
  assert.deepEqual(parseSort('Page Count desc'), { key: 'Page Count', dir: 'desc' });
  assert.deepEqual(parseSort('Page Count'), { key: 'Page Count', dir: 'asc' });
  const books = [{ name: 'a', props: { 'Page Count': '10' } }, { name: 'b', props: { 'Page Count': '300' } }];
  assert.deepEqual(sortRows(books, 'Page Count desc').map((r) => r.name), ['b', 'a']);
  assert.deepEqual(filterRows(books, [parseFilter('Page Count >= 100')]).map((r) => r.name), ['b']);
});

test('replaceDatabase swaps only the first database block of a page', async () => {
  const { replaceDatabase } = await import('../public/database.mjs');
  const page = '# Books\n\n~~~database\nsource: Books\n~~~\n\ntext\n\n```database\npage: Other\n```\n';
  const next = replaceDatabase(page, 'source: Books\nprop: Pages\ntype: number');
  assert.equal(next, '# Books\n\n~~~database\nsource: Books\nprop: Pages\ntype: number\n~~~\n\ntext\n\n```database\npage: Other\n```\n');
  assert.equal(replaceDatabase('no block', 'x'), 'no block');
});

test('an embed can show one view, several (as tabs), or all', async () => {
  const { pickViews } = await import('../public/database.mjs');
  const views = ['Tabla', 'Leyendo', 'Leídos', 'Pendientes', 'Por estado'].map((name) => ({ name }));
  assert.deepEqual(pickViews('Leyendo', views), [1]);
  assert.deepEqual(pickViews('Leyendo, Leídos , Pendientes', views), [1, 2, 3]);
  assert.deepEqual(pickViews('Pendientes, Leyendo', views), [3, 1]); // in the order written
  assert.deepEqual(pickViews('Leyendo, Leyendo', views), [1]);
  assert.deepEqual(pickViews('Leyendo, No existe', views), [1]);
  // nothing named, or nothing that exists: every view
  assert.deepEqual(pickViews('', views), [0, 1, 2, 3, 4]);
  assert.deepEqual(pickViews(undefined, views), [0, 1, 2, 3, 4]);
  assert.deepEqual(pickViews('No existe', views), [0, 1, 2, 3, 4]);
});
