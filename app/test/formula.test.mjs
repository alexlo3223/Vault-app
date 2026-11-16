import { test } from 'node:test';
import assert from 'node:assert/strict';
import { FUNCTIONS, evaluate, formatDate, parse, renameInFormula, toDate, valueType } from '../public/formula.mjs';

const row = { 'Pages Read': 256, 'Page Count': 512, Genres: ['Fantasy', 'Sci-Fi'], Start: new Date(2026, 0, 31), Done: true, Author: 'Le Guin', Empty: null };
const env = (props = row) => ({
  prop: (name) => {
    if (!(name in props)) throw new Error(`no ${name}`);
    return props[name];
  },
});
const run = (src, props) => evaluate(src, env(props));
const val = (src, props) => {
  const out = run(src, props);
  assert.equal(out.error, undefined, `${src}: ${out.error}`);
  return out.value;
};

test('the formula from the user: pages read as a fraction rounded to two places', () => {
  const f = 'round(prop("Pages Read") / prop("Page Count") * 100) / 100';
  assert.equal(val(f), 0.5);
  assert.equal(val(f, { 'Pages Read': 0, 'Page Count': 512 }), 0);
  assert.equal(val(f, { 'Pages Read': 82, 'Page Count': 578 }), 0.14);
  // An empty number counts as 0, like Notion
  assert.equal(val(f, { 'Pages Read': null, 'Page Count': 512 }), 0);
});

test('operators follow the usual precedence', () => {
  assert.equal(val('1 + 2 * 3'), 7);
  assert.equal(val('(1 + 2) * 3'), 9);
  assert.equal(val('2 ^ 3 ^ 2'), 512);
  assert.equal(val('-2 ^ 2'), -4);
  assert.equal(val('10 % 4'), 2);
  assert.equal(val('1 + 2 > 2 and not false'), true);
  assert.equal(val('1 > 2 || 3 >= 3'), true);
  assert.equal(val('5 > 3 ? "big" : "small"'), 'big');
});

test('texts join with +, compare exactly, and work with text functions', () => {
  assert.equal(val('"Vol. " + 2'), 'Vol. 2');
  assert.equal(val('prop("Author") == "Le Guin"'), true);
  assert.equal(val('prop("Author") != "le guin"'), true);
  assert.equal(val('upper(prop("Author"))'), 'LE GUIN');
  assert.equal(val('length("Dune")'), 4);
  assert.equal(val('replaceAll("a-b-c", "-", "+")'), 'a+b+c');
  assert.equal(val('slice("Vault", 0, 2)'), 'Va');
  assert.equal(val('concat("a", "b", 1)'), 'ab1');
});

test('if, ifs, and empty choose between values', () => {
  assert.equal(val('if(prop("Done"), "✅", "⏳")'), '✅');
  assert.equal(val('ifs(prop("Page Count") > 1000, "long", prop("Page Count") > 300, "medium", "short")'), 'medium');
  assert.equal(val('ifs(false, 1)'), null);
  assert.equal(val('empty(prop("Empty"))'), true);
  assert.equal(val('empty(prop("Author"))'), false);
});

test('numbers: rounding, min/max/sum over lists', () => {
  assert.equal(val('round(3.14159, 2)'), 3.14);
  assert.equal(val('floor(4.7) + ceil(4.2)'), 9);
  assert.equal(val('max(4, 1, 9)'), 9);
  assert.equal(val('sum([1, 2, 3], 4)'), 10);
  assert.equal(val('mean(2, 4)'), 3);
  assert.equal(val('abs(-3) + sqrt(16)'), 7);
});

test('division by zero is empty instead of Infinity', () => {
  assert.equal(val('1 / 0'), null);
  assert.equal(val('prop("Pages Read") / 0'), null);
});

test('lists: length, contains, join', () => {
  assert.equal(val('length(prop("Genres"))'), 2);
  assert.equal(val('contains(prop("Genres"), "Fantasy")'), true);
  assert.equal(val('contains(prop("Genres"), "Horror")'), false);
  assert.equal(val('join(prop("Genres"), " · ")'), 'Fantasy · Sci-Fi');
});

test('dates: add, between, parts and formatting', () => {
  const later = val('dateAdd(prop("Start"), 10, "days")');
  assert.equal(later.getDate(), 10);
  assert.equal(later.getMonth(), 1);
  assert.equal(val('dateBetween(dateAdd(prop("Start"), 3, "weeks"), prop("Start"), "days")'), 21);
  // 31 Jan + 1 month is not a whole month later on 28 Feb… but dateBetween counts whole months only
  assert.equal(val('dateBetween(parseDate("2026-03-01"), prop("Start"), "months")'), 1);
  assert.equal(val('year(prop("Start"))'), 2026);
  assert.equal(val('month(prop("Start"))'), 1);
  assert.equal(val('formatDate(prop("Start"), "DD/MM/YYYY")'), '31/01/2026');
  assert.equal(val('day(parseDate("2026-11-16"))'), 1); // a Monday
});

test('a bare date is a local day, so it never shifts across time zones', () => {
  const d = toDate('2026-11-16');
  assert.deepEqual([d.getFullYear(), d.getMonth(), d.getDate(), d.getHours()], [2026, 10, 16, 0]);
});

test('errors are readable and never thrown', () => {
  assert.match(run('foo(1)').error, /No existe la función “foo”/);
  assert.match(run('1 +').error, /termina antes de tiempo/);
  assert.match(run('Pages').error, /Usa prop\("Pages"\)/);
  assert.match(run('round(1, 2, 3)').error, /round\(\) necesita de 1 a 2 argumentos/);
  assert.match(run('"unclosed').error, /sin cerrar/);
  assert.match(run('"a" * 2').error, /no es un número/);
  assert.match(run('prop("Missing")').error, /no Missing/);
  assert.match(run('').error, /vacía/);
});

test('the tree keeps property names exactly, spaces and quotes included', () => {
  assert.deepEqual(parse('prop("Page Count")'), { k: 'call', name: 'prop', args: [{ k: 'val', v: 'Page Count' }] });
  assert.equal(val('prop(\'Pages Read\')'), 256);
});

test('renaming a property rewrites only the matching prop() calls', () => {
  assert.equal(renameInFormula('prop("Page Count") + prop("Pages Read") + prop( "Page Count" )', 'Page Count', 'Pages'), 'prop("Pages") + prop("Pages Read") + prop("Pages")');
});

test('result types are named for the editor', () => {
  assert.deepEqual([valueType(1), valueType('a'), valueType(true), valueType(new Date()), valueType([1]), valueType(null)], ['número', 'texto', 'casilla', 'fecha', 'lista', 'vacío']);
});

test('every documented function exists', () => {
  for (const [name, , , example] of FUNCTIONS) {
    if (name === 'prop') continue;
    const src = example.split(' = ')[0];
    const out = evaluate(src, env({ ...row, Score: 7, Start: new Date(2026, 0, 1) }));
    assert.equal(out.error?.startsWith('Unknown function') ?? false, false, `${name}: ${out.error}`);
  }
});

test('the dot form reads like Notion: value.function(args) is function(value, args)', () => {
  const props = { Estado: 'Done', Genres: ['Fantasy', 'Sci-Fi'], n: -4, a: 'abcdef', Done: true };
  const e = (src) => {
    const out = evaluate(src, env(props));
    assert.equal(out.error, undefined, `${src}: ${out.error}`);
    return out.value;
  };
  // the user's formula
  assert.equal(e('if(prop("Estado").includes("Done"), "Hecho", "")'), 'Hecho');
  assert.equal(e('if(prop("Estado").includes("Leído"), "Hecho", "")'), '');
  // same result as the long form
  assert.equal(e('prop("Genres").length()'), e('length(prop("Genres"))'));
  assert.equal(e('prop("Genres").join(", ")'), e('join(prop("Genres"), ", ")'));
  assert.equal(e('prop("Genres").contains("Fantasy")'), e('contains(prop("Genres"), "Fantasy")'));
  assert.equal(e('round(1.25.round(1) + 1)'), e('round(round(1.25, 1) + 1)'));
  // chaining, and the NOTION-style names
  assert.equal(e('prop("Genres").join(" · ").toUpperCase()'), 'FANTASY · SCI-FI');
  assert.equal(e('prop("Estado").toLowerCase()'), 'done');
  // precedence: the call binds before ^ and unary minus
  assert.equal(e('-prop("n").abs()'), -4);
  assert.equal(e('2 ^ prop("n").abs()'), 16);
  // calls inside arguments
  assert.equal(e('prop("a").slice(0, prop("n").abs())'), 'abcd');
  // lazy functions keep working as receivers: only the chosen branch is evaluated
  assert.equal(e('prop("Done").if("sí", "no")'), 'sí');
  // numbers with dots are still numbers
  assert.equal(e('1.5 + .5'), 2);
  assert.equal(e('1.5.round()'), 2);
  assert.equal(e('.5.round()'), 1);
});

test('dot-form mistakes get a readable message', () => {
  assert.match(run('prop("Genres").').error, /Se esperaba el nombre de una función después de “\.”/);
  assert.match(run('prop("Genres").length').error, /Escribe \.length\(\) con paréntesis/);
  assert.match(run('prop("Genres").nada()').error, /No existe la función “nada”/);
});

test('renaming a property used with the dot form rewrites it too', () => {
  assert.equal(renameInFormula('prop("Estado").includes("Done")', 'Estado', 'Status'), 'prop("Status").includes("Done")');
});

test('a year typed digit by digit never becomes 1902: years below 100 stay what they say', () => {
  // the native date field reports 0002-11-16 after the first digit of the year; new Date(2, …) is 1902
  assert.equal(toDate('0002-11-16').getFullYear(), 2);
  assert.equal(toDate('0020-11-16').getFullYear(), 20);
  assert.equal(toDate('0202-11-16').getFullYear(), 202);
  assert.equal(formatDate(toDate('0002-11-16'), 'YYYY-MM-DD'), '0002-11-16');
});

test('only dates that exist are dates: nothing rolls into the next month', () => {
  for (const bad of ['2026-02-30', '2026-13-45', '2026-11-31', '2026-02-29', '2026-00-10', '2026-11-00', '31/04/2026', '2026-11-16 24:00', '2026-11-16 14:60']) assert.equal(toDate(bad), null, bad);
  assert.equal(toDate('2024-02-29').getDate(), 29); // a leap year
  assert.equal(toDate('2000-02-29').getDate(), 29);
  assert.equal(toDate('1900-02-29'), null); // not a leap year
});

test('dates are read in the usual formats, day first with slashes, and with an optional time', () => {
  const ymd = (d) => [d.getFullYear(), d.getMonth() + 1, d.getDate(), d.getHours(), d.getMinutes()];
  assert.deepEqual(ymd(toDate('2026-11-16')), [2026, 11, 16, 0, 0]);
  assert.deepEqual(ymd(toDate('2026/11/16')), [2026, 11, 16, 0, 0]);
  assert.deepEqual(ymd(toDate('16/11/2026')), [2026, 11, 16, 0, 0]);
  assert.deepEqual(ymd(toDate('16-11-2026')), [2026, 11, 16, 0, 0]);
  assert.deepEqual(ymd(toDate('16.11.2026')), [2026, 11, 16, 0, 0]);
  assert.deepEqual(ymd(toDate('1/2/2026')), [2026, 2, 1, 0, 0]); // 1 February, not 2 January
  assert.deepEqual(ymd(toDate('16/11/2026 14:30')), [2026, 11, 16, 14, 30]);
  assert.deepEqual(ymd(toDate('2026-11-16T09:05:30Z')), [2026, 11, 16, 9, 5]);
  assert.deepEqual(ymd(toDate('2026-11-16 14:30 +02:00')), [2026, 11, 16, 14, 30]);
  assert.deepEqual(ymd(toDate('  2026-11-16  ')), [2026, 11, 16, 0, 0]);
  // a half-typed or two-digit year is not a date
  for (const bad of ['2', '16/11', '16/11/2', '16/11/26', '16/11/202', 'nov 16', '', 'abc', '2026-11']) assert.equal(toDate(bad), null, bad);
});

test('parseDate() in a formula reads the same formats', () => {
  assert.equal(val('year(parseDate("16/11/2026"))'), 2026);
  assert.equal(val('month(parseDate("2026-02-28"))'), 2);
  assert.match(run('year(parseDate("2026-02-30"))').error, /vacía|no es una fecha/i);
});
