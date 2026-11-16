import { after, before, test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createApp } from '../server.mjs';
import { buttonLine, buttonParts, embedLine, embedSrc, embedUrl, isButton, isEmbed, parse, serialize } from '../public/blocks.mjs';
import { parseProps, setProp } from '../public/graph.mjs';

const roundTrip = (md) => serialize(parse(md));

test('embed and button lines are kept exactly as written', () => {
  const md = '<iframe src="https://example.com/clock"></iframe>\n\n<button data-new="Books">New book</button>\n';
  assert.equal(roundTrip(md), md);
  assert.deepEqual(
    parse(md).blocks.map((b) => b.type),
    ['embed', 'button'],
  );
});

test('columns keep their width weights through a round trip', () => {
  const md = '<div class="columns">\n<div class="column" data-ratio="16">\n\nA\n</div>\n<div class="column" data-ratio="61">\n\nB\n</div>\n<div class="column">\n\nC\n</div>\n</div>\n';
  assert.deepEqual(parse(md).blocks[0].cols.map((c) => c.ratio), [16, 61, undefined]);
  assert.equal(roundTrip(md), md);
});

test('embeds only accept https addresses', () => {
  assert.equal(isEmbed(embedLine('https://example.com/a')), true);
  assert.equal(isEmbed('<iframe src="http://example.com/a"></iframe>'), false);
  assert.equal(embedSrc(embedLine('https://example.com/a')), 'https://example.com/a');
});

test('YouTube links become embeddable, other links stay as they are', () => {
  assert.equal(embedUrl('https://www.youtube.com/watch?v=jfKfPfyJRdk'), 'https://www.youtube-nocookie.com/embed/jfKfPfyJRdk');
  assert.equal(embedUrl('https://youtu.be/jfKfPfyJRdk'), 'https://www.youtube-nocookie.com/embed/jfKfPfyJRdk');
  assert.equal(embedUrl('https://flocus.com/online-aura-clock/'), 'https://flocus.com/online-aura-clock/');
});

test('button helpers read back what they write', () => {
  assert.deepEqual(buttonParts(buttonLine('Books', 'New book')), { folder: 'Books', label: 'New book' });
  assert.equal(isButton(buttonLine('', 'Add')), true);
  assert.equal(buttonParts('<button>no folder</button>'), null);
});

test('setProp adds, replaces, quotes and removes frontmatter keys', () => {
  let fm = setProp('', 'cover', 'https://img.example/a.jpg');
  assert.equal(fm, '---\ncover: "https://img.example/a.jpg"\n---\n');
  assert.equal(parseProps(fm)[0].value, 'https://img.example/a.jpg');
  fm = setProp(fm, 'icon', '📚');
  fm = setProp(fm, 'cover', 'https://img.example/b.jpg');
  assert.deepEqual(
    parseProps(fm).map((r) => [r.key, r.value]),
    [
      ['cover', 'https://img.example/b.jpg'],
      ['icon', '📚'],
    ],
  );
  assert.equal(setProp(fm, 'icon', ''), '---\ncover: "https://img.example/b.jpg"\n---\n');
  assert.equal(setProp('---\ntitle: Hi\n---\n', 'status', 'done'), '---\ntitle: Hi\nstatus: done\n---\n');
});

let server;
let base;
let vaultRoot;
before(async () => {
  const root = await mkdtemp(join(tmpdir(), 'vault-features-'));
  vaultRoot = root;
  await mkdir(join(root, 'Books', 'Deep'), { recursive: true });
  await writeFile(join(root, 'Books', 'Dune.md'), '---\nauthor: Herbert\nstatus: read\n---\n# Dune\n');
  await writeFile(join(root, 'Books', 'Deep', 'Hidden.md'), 'not a direct child');
  server = createApp({ root });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  base = `http://127.0.0.1:${server.address().port}`;
});
after(() => server.close());

test('database rows list the notes directly inside a folder, with their properties', async () => {
  const res = await fetch(`${base}/api/db?folder=Books`);
  assert.equal(res.status, 200);
  const { rows } = await res.json();
  assert.deepEqual(
    rows.map((r) => [r.name, r.props]),
    [['Dune', { author: 'Herbert', status: 'read' }]],
  );
});

test('database rows refuse folders outside the vault', async () => {
  const res = await fetch(`${base}/api/db?folder=..`);
  assert.equal(res.status, 400);
});

test('every browser module in public/ is served (a missing route breaks the whole app)', async () => {
  const { readdir } = await import('node:fs/promises');
  const { fileURLToPath } = await import('node:url');
  const dir = fileURLToPath(new URL('../public/', import.meta.url));
  for (const f of (await readdir(dir)).filter((n) => /\.(m?js|css)$/.test(n))) {
    assert.equal((await fetch(`${base}/${f}`)).status, 200, `${f} is not served`);
  }
});

test('the database menu lists only pages that hold a database block', async () => {
  await writeFile(join(vaultRoot, 'Books', 'Library.md'), '~~~database\nsource: Books/Library\nview: table\n~~~\n');
  await writeFile(join(vaultRoot, 'Books', 'Embedding.md'), '```database\npage: Books/Library\n```\n');
  try {
    const { databases } = await (await fetch(`${base}/api/databases`)).json();
    assert.deepEqual(databases, [{ path: 'Books/Library.md', name: 'Library', source: 'Books/Library' }]);
  } finally {
    await rm(join(vaultRoot, 'Books', 'Library.md'));
    await rm(join(vaultRoot, 'Books', 'Embedding.md'));
  }
});

test('database rows carry a creation time', async () => {
  const { rows } = await (await fetch(`${base}/api/db?folder=Books`)).json();
  assert.ok(rows[0].ctime > 0);
});

test('a property is renamed, then removed, in every row of a database', async () => {
  const post = (body) => fetch(`${base}/api/db/prop`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
  await writeFile(join(vaultRoot, 'Books', 'Emma.md'), '---\nauthor: Austen\nstatus: todo\n---\n# Emma\n');
  try {
    let res = await post({ folder: 'Books', from: 'author', to: 'Writer' });
    assert.equal(res.status, 200);
    assert.deepEqual(await res.json(), { changed: 2 });
    const read = async (name) => (await fetch(`${base}/api/page?path=${encodeURIComponent(`Books/${name}.md`)}`).then((r) => r.json())).content;
    assert.equal(await read('Emma'), '---\nWriter: Austen\nstatus: todo\n---\n# Emma\n');
    assert.match(await read('Dune'), /^---\nWriter: Herbert\nstatus: read\n---\n# Dune/);
    // the note in a sub-folder is not a row of this database
    assert.equal(await fetch(`${base}/api/page?path=${encodeURIComponent('Books/Deep/Hidden.md')}`).then((r) => r.json()).then((d) => d.content), 'not a direct child');

    res = await post({ folder: 'Books', from: 'Writer', to: '' });
    assert.deepEqual(await res.json(), { changed: 2 });
    assert.equal(await read('Emma'), '---\nstatus: todo\n---\n# Emma\n');

    // names that would break the frontmatter, and folders outside the vault, are refused
    assert.equal((await post({ folder: 'Books', from: 'status', to: 'a: b' })).status, 400);
    assert.equal((await post({ folder: '..', from: 'status', to: 'x' })).status, 400);
  } finally {
    await rm(join(vaultRoot, 'Books', 'Emma.md'));
    await writeFile(join(vaultRoot, 'Books', 'Dune.md'), '---\nauthor: Herbert\nstatus: read\n---\n# Dune\n');
  }
});

test('saving a note keeps its creation time (Created time must not become the last edit)', async () => {
  const put = (content, baseMtime) => fetch(`${base}/api/page`, { method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ path: 'Books/Kept.md', content, baseMtime }) }).then((r) => r.json());
  const ctime = async () => (await (await fetch(`${base}/api/db?folder=Books`)).json()).rows.find((r) => r.name === 'Kept').ctime;
  try {
    const first = await put('one', null);
    const before = await ctime();
    await new Promise((r) => setTimeout(r, 60));
    await put('two', first.mtime);
    assert.equal(await ctime(), before);
    assert.equal(await fetch(`${base}/api/page?path=Books%2FKept.md`).then((r) => r.json()).then((d) => d.content), 'two');
  } finally {
    await rm(join(vaultRoot, 'Books', 'Kept.md'));
  }
});
