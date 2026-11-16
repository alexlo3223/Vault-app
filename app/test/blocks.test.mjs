import { test } from 'node:test';
import assert from 'node:assert/strict';
import { formatTable, listNumbers, newColumn, parse, parseImage, renderInline, renderedToRaw, serialize } from '../public/blocks.mjs';

const SAMPLE = [
  '---',
  'tags: [project]',
  '---',
  '# Title',
  'Intro line one',
  'intro line two',
  '',
  '## List',
  '- a',
  '  - nested',
  '    continuation',
  '- [ ] todo',
  '- [X] done',
  '1. one',
  '2. two',
  '',
  '> quote',
  '> more',
  '',
  '***',
  '',
  '```js',
  'const x = 1;',
  '',
  'console.log(x);',
  '```',
  '',
  '| a | b |',
  '|---|---|',
  '| 1 | 2 |',
  '',
  'Setext',
  '===',
  '#### small',
  'end',
  '',
].join('\n');

test('parse reads every block type', () => {
  const { frontmatter, blocks } = parse(SAMPLE);
  assert.equal(frontmatter, '---\ntags: [project]\n---\n');
  assert.deepEqual(
    blocks.map((b) => b.type),
    ['h1', 'text', 'h2', 'bullet', 'bullet', 'todo', 'todo', 'numbered', 'numbered', 'quote', 'divider', 'code', 'table', 'text'],
  );
  assert.equal(blocks[4].indent, '  ');
  assert.equal(blocks[4].text, 'nested\n    continuation');
  assert.equal(blocks[6].checked, true);
  assert.equal(blocks[9].text, 'quote\nmore');
  assert.equal(blocks[11].text, 'const x = 1;\n\nconsole.log(x);');
});

test('opening and saving a note leaves it byte-for-byte unchanged', () => {
  assert.equal(serialize(parse(SAMPLE)), SAMPLE);
  for (const md of ['', 'a', 'a\n', '\n\nx\n\n', '---\n---\nbody', '- a\n- b', '1) a\n2) b\n']) {
    assert.equal(serialize(parse(md)), md, JSON.stringify(md));
  }
});

test('CRLF files are read and saved with LF', () => {
  assert.equal(serialize(parse(SAMPLE.replace(/\n/g, '\r\n'))), SAMPLE);
});

test('numbered lists count from the first number and restart after other blocks', () => {
  const { blocks } = parse('3. a\n1. b\n- c\n1. d\n\npara\n5. e');
  assert.deepEqual([...listNumbers(blocks).values()], [3, 4, 1, 5]);
  assert.equal(serialize(parse('1. a\n1. b\n')), '1. a\n2. b\n');
});

test('renderInline formats Markdown and escapes HTML', () => {
  const html = renderInline('a **b** [[Note|alias]] #tag `x<y>` <script>');
  assert.match(html, /<strong>b<\/strong>/);
  assert.match(html, /<a class="wikilink" href="#" data-link="Note">alias<\/a>/);
  assert.match(html, /data-tag="tag">#tag<\/a>/);
  assert.match(html, /<code>x&lt;y&gt;<\/code>/);
  assert.match(html, /&lt;script&gt;/);
  assert.doesNotMatch(html, /<script/);
});

test('renderInline refuses unsafe link schemes and keeps word underscores', () => {
  assert.doesNotMatch(renderInline('[x](javascript:alert(1))'), /<a/);
  assert.match(renderInline('[doc](Other%20Note.md)'), /class="wikilink"/);
  assert.match(renderInline('see https://example.com/a.'), /href="https:\/\/example.com\/a" [^>]*>https:\/\/example.com\/a<\/a>\.$/);
  assert.doesNotMatch(renderInline('snake_case_name'), /<em>/);
});

test('renderedToRaw maps a click in rendered text to the Markdown source', () => {
  const raw = 'a **b** [[x|y]]';
  assert.equal(renderedToRaw(raw, 0), 0);
  assert.equal(renderedToRaw(raw, 2), 4); // before "b", after "**"
  assert.equal(renderedToRaw(raw, 4), 12); // before "y", after "[[x|"
  assert.equal(renderedToRaw(raw, 5), raw.length); // end of block: after the closing "]]"
});

test('tables, images and columns round-trip byte for byte', () => {
  const md = [
    'Intro',
    '',
    '| Name | Qty |',
    '|:-----|----:|',
    '| a \\| b | 2 |',
    '| short |',
    '',
    '![Cat](attachments/cat.png)',
    '',
    '![[photo.jpg|300]]',
    '',
    '<div class="columns">',
    '<div class="column">',
    '',
    '# Left',
    '- item',
    '',
    '</div>',
    '<div class="column">',
    '',
    'Right text',
    '',
    '</div>',
    '</div>',
    '',
    '<div class="note">',
    'other html stays text',
    '</div>',
    '',
  ].join('\n');
  const doc = parse(md);
  assert.deepEqual(doc.blocks.map((b) => b.type), ['text', 'table', 'image', 'image', 'columns', 'text']);
  const table = doc.blocks[1];
  assert.deepEqual(table.rows, [['Name', 'Qty'], ['a | b', '2'], ['short', '']]);
  assert.deepEqual(table.align, ['left', 'right']);
  const cols = doc.blocks[4].cols;
  assert.deepEqual(cols.map((c) => c.blocks.map((b) => b.type)), [['h1', 'bullet'], ['text']]);
  assert.equal(serialize(doc), md);
});

test('near-tables and nested divs stay raw text', () => {
  const md = '| not a table\nbecause no separator\n\n<div class="columns">\n<div class="column">\n<div>x</div>\n</div>\n</div>\n';
  const doc = parse(md);
  assert.ok(doc.blocks.every((b) => b.type === 'text'));
  assert.equal(serialize(doc), md);
});

test('formatTable pads cells, escapes pipes and keeps alignment', () => {
  assert.equal(
    formatTable([['A', 'Long header'], ['x|y', '']], ['center', '']),
    '| A    | Long header |\n| :--: | ----------- |\n| x\\|y |             |',
  );
  const again = parse(formatTable([['A', 'B'], ['1', '2']], ['', 'right'])).blocks[0];
  assert.deepEqual([again.type, again.rows, again.align], ['table', [['A', 'B'], ['1', '2']], ['', 'right']]);
});

test('new columns are written so Obsidian still sees Markdown inside', () => {
  const doc = { frontmatter: '', blocks: [{ id: 1, type: 'columns', text: '', cols: [newColumn(), newColumn()] }], trailing: 1 };
  doc.blocks[0].cols[0].blocks[0].text = 'left';
  const md = serialize(doc);
  assert.equal(md, '<div class="columns">\n<div class="column">\n\nleft\n\n</div>\n<div class="column">\n\n\n\n</div>\n</div>\n');
  assert.equal(serialize(parse(md)), md);
});

test('parseImage reads Markdown images and Obsidian embeds', () => {
  assert.deepEqual(parseImage('![a b](x/y.png)'), { alt: 'a b', src: 'x/y.png', embed: false });
  assert.deepEqual(parseImage('![[pic.png|240]]'), { alt: '', src: 'pic.png', width: 240, embed: true });
  assert.equal(parseImage('text ![a](b.png)'), null);
});
