import { test } from 'node:test';
import assert from 'node:assert/strict';
import { barFraction, computeRows, flatRows, formatNumber, fullSchema, inferType, newProp, readValue, rollupValue, validPropName, writeValue } from '../public/properties.mjs';

const P = (name, type, extra = {}) => ({ ...newProp(name, type), ...extra });

test('values are read as their property type, leniently', () => {
  assert.equal(readValue(P('n', 'number'), '512'), 512);
  assert.equal(readValue(P('n', 'number'), 'abc'), 'abc'); // not a number: kept as text, so it still shows
  assert.deepEqual(readValue(P('g', 'multi-select'), 'Fantasy'), ['Fantasy']);
  assert.deepEqual(readValue(P('g', 'multi-select'), ['Fantasy', 'Sci-Fi']), ['Fantasy', 'Sci-Fi']);
  assert.equal(readValue(P('t', 'text'), ['a', 'b']), 'a, b');
  assert.equal(readValue(P('c', 'checkbox'), 'true'), true);
  assert.equal(readValue(P('c', 'checkbox'), 'false'), false);
  assert.equal(readValue(P('c', 'checkbox'), undefined), false);
  assert.equal(readValue(P('d', 'date'), '2026-11-16').getDate(), 16);
  assert.deepEqual(readValue(P('r', 'relation'), ['[[Quote 1]]', '[[Quotes/Quote 2|Second]]']), ['Quote 1', 'Quotes/Quote 2']);
});

test('values are written back the way the frontmatter keeps them', () => {
  assert.deepEqual(writeValue(P('g', 'multi-select'), ['Fantasy', '']), ['Fantasy']);
  assert.deepEqual(writeValue(P('r', 'relation'), ['Quote 1']), ['[[Quote 1]]']);
  assert.equal(writeValue(P('c', 'checkbox'), 1), true);
  assert.equal(writeValue(P('n', 'number'), 12.5), '12.5');
  assert.equal(writeValue(P('n', 'number'), null), '');
  assert.equal(writeValue(P('d', 'date'), new Date(2026, 10, 16)), '2026-11-16');
});

test('keys without a schema get a guessed type', () => {
  assert.equal(inferType(['412', '245']), 'number');
  assert.equal(inferType(['true', 'false']), 'checkbox');
  assert.equal(inferType([['a'], 'b']), 'multi-select');
  assert.equal(inferType(['2026-01-02']), 'date');
  assert.equal(inferType(['Frank Herbert', '12']), 'text');
  assert.equal(inferType([]), 'text');
});

test('property names that would break YAML or view lists are refused', () => {
  assert.equal(validPropName('Page Count'), true);
  assert.equal(validPropName('Num. Pag. Restantes'), true);
  for (const bad of ['', ' x', 'a:b', 'a,b', 'a=b', '[x]', 'a#b', 'a|b', '"x"', '-x']) assert.equal(validPropName(bad), false, bad);
});

test('numbers are formatted: percent, decimals, commas and currency', () => {
  assert.equal(formatNumber(0.5, { format: 'percent' }), '50%');
  assert.equal(formatNumber(0.1634, { format: 'percent', decimals: '1' }), '16.3%');
  assert.equal(formatNumber(1234.5, { format: 'comma' }), '1,234.5');
  assert.equal(formatNumber(1234.5, { format: 'dollar', decimals: '2' }), '$1,234.50');
  assert.equal(formatNumber(-3, { format: 'dollar' }), '-$3');
  assert.equal(formatNumber(10, { format: 'euro' }), '10 €');
  assert.equal(formatNumber(82, {}), '82');
  assert.equal(formatNumber(null, {}), '');
});

test('bars fill to 1 for percents and to 100 (or "divide by") for numbers', () => {
  assert.equal(barFraction(0.5, { format: 'percent' }), 0.5);
  assert.equal(barFraction(82, {}), 0.82);
  assert.equal(barFraction(5, { max: '10' }), 0.5);
  assert.equal(barFraction(300, {}), 1);
  assert.equal(barFraction(-1, {}), 0);
});

test('rollups count, add and average the related values', () => {
  assert.equal(rollupValue('count', ['a', 'b'], 2), 2);
  assert.equal(rollupValue('count values', ['a', '', ['b', 'c']]), 3);
  assert.equal(rollupValue('sum', ['2', 3, 'x']), 5);
  assert.equal(rollupValue('avg', [2, 4]), 3);
  assert.equal(rollupValue('min', [2, 4]), 2);
  assert.equal(rollupValue('max', []), null);
  assert.equal(rollupValue('percent checked', ['true', 'false', 'true', 'true'], 4), 0.75);
  assert.deepEqual(rollupValue('list', ['a', ['b']]), ['a', 'b']);
});

test('rows get typed, computed values: formulas using formulas, rollups, created/edited', () => {
  const schema = [
    P('Page Count', 'number'),
    P('Pages Read', 'number'),
    P('Progress', 'formula', { formula: 'round(prop("Pages Read") / prop("Page Count") * 100) / 100', format: 'percent', display: 'bar' }),
    P('Label', 'formula', { formula: 'prop("Name") + ": " + format(prop("Progress") * 100) + "%"' }),
    P('Quotes', 'relation', { relation: 'Lib/Quotes' }),
    P('Quote count', 'rollup', { rollup: 'Quotes', calc: 'count' }),
    P('Quote likes', 'rollup', { rollup: 'Quotes', target: 'likes', calc: 'sum' }),
    P('Created', 'created'),
  ];
  const rows = [{ path: 'Lib/Books/Dune.md', name: 'Dune', mtime: 2000, ctime: 1000, props: { 'Page Count': '512', 'Pages Read': '256', Quotes: ['[[Quote 1]]', '[[Lib/Quotes/Quote 2]]', '[[Nope]]'], author: 'Herbert' } }];
  const related = new Map([['Lib/Quotes', [
    { path: 'Lib/Quotes/Quote 1.md', name: 'Quote 1', props: { likes: '3' } },
    { path: 'Lib/Quotes/Quote 2.md', name: 'Quote 2', props: { likes: '4' } },
  ]]]);
  const [r] = computeRows(rows, schema, related);
  assert.equal(r.values.Progress, 0.5);
  assert.equal(r.values.Label, 'Dune: 50%');
  assert.equal(r.values['Quote count'], 2);
  assert.equal(r.values['Quote likes'], 7);
  assert.equal(r.values.Created.getTime(), 1000);
  assert.equal(r.values.author, 'Herbert'); // a key outside the schema is still there (guessed as text)
  assert.deepEqual(r.errors, {});
  const [flat] = flatRows([r]);
  assert.equal(flat.props.Progress, '0.5');
  assert.deepEqual(flat.props.Quotes, ['Quote 1', 'Lib/Quotes/Quote 2', 'Nope']);
});

test('a formula error stays in its own cell; cycles are caught', () => {
  const schema = [P('A', 'formula', { formula: 'prop("B") + 1' }), P('B', 'formula', { formula: 'prop("A") + 1' }), P('C', 'formula', { formula: 'prop("Missing")' }), P('D', 'formula', { formula: '2 * 2' })];
  const [r] = computeRows([{ path: 'x.md', name: 'x', props: {} }], schema);
  assert.match(r.errors.A, /depends on itself/);
  assert.ok(r.errors.B);
  assert.match(r.errors.C, /There is no property “Missing”/);
  assert.equal(r.values.D, 4);
});

test('the full schema lists schema properties first, then guessed ones, never page keys', () => {
  const props = fullSchema([P('Status', 'status')], [{ props: { status: 'read', pages: '12', icon: '📕', cover: 'x.png', Tags: ['a'] } }]);
  assert.deepEqual(props.map((p) => [p.name, p.type]), [['Status', 'status'], ['pages', 'number'], ['Tags', 'multi-select']]);
});

test('a date is read from the formats people type, and text that is not a date stays visible', () => {
  const D = P('d', 'date');
  assert.equal(readValue(D, '16/11/2026').getDate(), 16);
  assert.equal(readValue(D, '2026-11-16T14:30').getHours(), 14);
  assert.equal(readValue(D, ''), null);
  assert.equal(readValue(D, undefined), null);
  // not a date: kept as the text it is, so the cell shows it and it can be corrected
  assert.equal(readValue(D, 'next friday'), 'next friday');
  assert.equal(readValue(D, '2026-02-30'), '2026-02-30');
  assert.equal(readValue(D, ['2026-11-16', 'x']).getDate(), 16);
});

test('a date is written as YYYY-MM-DD, with the time only when there is one', () => {
  const D = P('d', 'date');
  assert.equal(writeValue(D, new Date(2026, 10, 16)), '2026-11-16');
  assert.equal(writeValue(D, new Date(2026, 10, 16, 14, 30)), '2026-11-16T14:30');
  assert.equal(writeValue(D, new Date(2026, 10, 16, 0, 5)), '2026-11-16T00:05');
  assert.equal(writeValue(D, readValue(D, '16/11/2026 09:05')), '2026-11-16T09:05');
  const early = new Date(2000, 0, 1);
  early.setFullYear(2, 10, 16);
  assert.equal(writeValue(D, early), '0002-11-16'); // four digits, never "2-11-16"
  assert.equal(writeValue(D, null), '');
  assert.equal(writeValue(D, 'not a date'), '');
  assert.equal(writeValue(D, new Date(NaN)), '');
  // what is written reads back as the same moment
  for (const text of ['2026-11-16', '2026-11-16T14:30', '2024-02-29']) assert.equal(writeValue(D, readValue(D, text)), text);
});

test('dates sort and compare as text in the views: YYYY-MM-DD[THH:mm], once, with no repeated time', () => {
  const D = P('Started', 'date');
  const [a, b] = computeRows(
    [
      { path: 'a.md', name: 'a', props: { Started: '2026-11-16T14:30' } },
      { path: 'b.md', name: 'b', props: { Started: '2026-11-02' } },
    ],
    [D],
  );
  const [fa, fb] = flatRows([a, b]);
  assert.equal(fa.props.Started, '2026-11-16T14:30');
  assert.equal(fb.props.Started, '2026-11-02');
  assert.ok(fb.props.Started < fa.props.Started);
});

test('numbers are plain decimals: hexadecimal and binary text are not numbers', () => {
  const N = P('n', 'number');
  // text that is not a number is kept as the text it is (the cell shows it, marked); empty stays empty
  for (const bad of ['0x10', '0b11', '0o7', '12abc', '1,5', 'Infinity', '--3', '1e']) assert.equal(readValue(N, bad), bad, bad);
  assert.equal(readValue(N, '  0x10 '), '0x10');
  for (const empty of ['', ' ', undefined, null]) assert.equal(readValue(N, empty), null, String(empty));
  for (const [text, n] of [['512', 512], ['-3', -3], ['+4', 4], ['.5', 0.5], ['5.', 5], ['1e3', 1000], ['2.5E-1', 0.25], [' 7 ', 7], ['0', 0]]) assert.equal(readValue(N, text), n, text);
  assert.equal(readValue(N, 12.5), 12.5);
  assert.equal(inferType(['0x10']), 'text');
  assert.equal(inferType(['12', '-3.5']), 'number');
});

test('slash-format dates are guessed as dates too', () => {
  assert.equal(inferType(['16/11/2026', '2026-01-02']), 'date');
  assert.equal(inferType(['16/11/2026', 'soon']), 'text');
});
