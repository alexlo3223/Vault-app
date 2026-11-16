import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdir, readFile, stat } from 'node:fs/promises';
import { basename, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parse, serialize } from '../public/blocks.mjs';
import { parseProps } from '../public/graph.mjs';
import { extractDatabase, parseDb } from '../public/database.mjs';
import { coverSrc, isImageRef } from '../public/cover.mjs';
import { buildIndex } from '../lib/search.mjs';
import { makeResolver } from '../lib/links.mjs';

// The tutorial notes in notes/ are content the app ships with: a broken link, a missing picture or a database page
// that names a view that is not there would be seen by every new user, so they are checked like code.
const ROOT = fileURLToPath(new URL('../../notes', import.meta.url));

async function walk(dir, rel = '') {
  const out = [];
  for (const name of await readdir(join(dir, rel))) {
    if (name.startsWith('.')) continue;
    const r = rel ? `${rel}/${name}` : name;
    if ((await stat(join(dir, r))).isDirectory()) out.push(...(await walk(dir, r)));
    else out.push(r);
  }
  return out;
}

const files = await walk(ROOT);
const notes = files.filter((f) => f.endsWith('.md'));
const read = (f) => readFile(join(ROOT, f), 'utf8');
const frontmatter = (md) => md.match(/^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/)?.[0] ?? '';
const props = (md) => Object.fromEntries((parseProps(frontmatter(md)) ?? []).map((r) => [r.key, r.list ?? r.value]));
const withoutCode = (md) => md.replace(/^(`{3,}|~{3,}).*\n[\s\S]*?\n\1[ \t]*$/gm, '').replace(/`[^`\n]*`/g, '');

test('the tutorial is there: an index, the notes, and the pictures they use', () => {
  assert.ok(notes.includes('Tutorial.md'));
  assert.ok(notes.filter((n) => /^Tutorial\/\d\d /.test(n)).length >= 11);
  assert.ok(files.some((f) => f.startsWith('attachments/')));
});

test('every note has a frontmatter the app can read', async () => {
  for (const n of notes) {
    const fm = frontmatter(await read(n));
    if (fm) assert.notEqual(parseProps(fm), null, `${n}: the frontmatter is not readable (a stray line?)`);
  }
});

test('every [[link]] leads to a note that exists', async () => {
  const docs = await buildIndex(ROOT);
  const resolve = makeResolver(docs);
  for (const d of docs) {
    // links in the text (code is left out), and the links a relation property keeps in the frontmatter
    const text = withoutCode(await read(d.path));
    for (const m of text.matchAll(/\[\[([^\]|#]+)(?:#[^\]|]*)?(?:\|[^\]]*)?\]\]/g)) {
      assert.ok(resolve(m[1].trim(), d.path), `${d.path}: [[${m[1]}]] does not lead anywhere`);
    }
  }
});

test('every database block points to a database that exists, and to views that exist', async () => {
  let seen = 0;
  for (const n of notes) {
    const md = await read(n);
    for (const m of md.matchAll(/^(`{3,}|~{3,})database[ \t]*\n([\s\S]*?)\n\1[ \t]*$/gm)) {
      const cfg = parseDb(m[2]);
      if (cfg.page) {
        seen++;
        assert.ok(notes.includes(`${cfg.page}.md`), `${n}: the database page "${cfg.page}" does not exist`);
        const target = parseDb(extractDatabase(await read(`${cfg.page}.md`)) ?? '');
        assert.ok(target.source, `${n}: "${cfg.page}" has no database block with a source`);
        for (const name of (cfg.use ?? '').split(',').map((s) => s.trim()).filter(Boolean)) {
          assert.ok(target.views.some((v) => v.name === name), `${n}: "${cfg.page}" has no view called "${name}"`);
        }
      } else if (cfg.source) {
        assert.ok(notes.some((f) => f.startsWith(`${cfg.source}/`)), `${n}: the source folder "${cfg.source}" has no notes`);
      }
    }
  }
  assert.ok(seen >= 4, 'the dashboards embed databases');
});

test('every picture a note names (banner, icon, cover of a row) is a file that exists', async () => {
  const names = new Set(files.map((f) => basename(f)));
  const exists = (ref) => names.has(basename(ref.replace(/^!?\[\[|\]\]$/g, '')));
  let banners = 0;
  for (const n of notes) {
    const p = props(await read(n));
    if (p.cover) {
      banners++;
      assert.notEqual(coverSrc(p.cover, n), '', `${n}: the banner "${p.cover}" is not an image`);
      if (!/^https:/i.test(p.cover)) assert.ok(exists(p.cover), `${n}: the banner file "${p.cover}" is missing`);
    }
    if (p.icon && isImageRef(p.icon) && !/^https:/i.test(p.icon)) assert.ok(exists(p.icon), `${n}: the icon file "${p.icon}" is missing`);
    if (p.Portada) assert.ok(exists(p.Portada), `${n}: the cover file "${p.Portada}" is missing`);
  }
  assert.ok(banners >= 12, 'the tutorial notes have banners');
});

test('the banner framing in every note is within its limits', async () => {
  const { readCover } = await import('../public/cover.mjs');
  for (const n of notes) {
    const p = props(await read(n));
    if (!p.cover) continue;
    const c = readCover(p);
    for (const [key, value] of Object.entries({ cover_x: c.x, cover_y: c.y, cover_zoom: c.zoom, cover_height: c.height })) {
      if (p[key] !== undefined) assert.equal(Number(p[key]), value, `${n}: ${key}: ${p[key]} is outside its limits`);
    }
  }
});

test('the dashboards keep their columns exactly as written when the app opens and saves them', async () => {
  let dashboards = 0;
  for (const n of notes) {
    const md = await read(n);
    if (!md.includes('<div class="columns">')) continue;
    dashboards++;
    const doc = parse(md);
    assert.equal(serialize(doc), md, `${n}: saving would change the file`);
    const columns = doc.blocks.find((b) => b.type === 'columns');
    assert.deepEqual(columns.cols.map((c) => c.ratio), [16, 61, 22], `${n}: expected narrow · wide · narrow`);
  }
  assert.ok(dashboards >= 2, 'the index and the library example are dashboards');
});

test('the library example has what the picture it copies has: actions, navigation, a gallery with tabs and a donut', async () => {
  const md = await read('Tutorial/Ejemplo Biblioteca.md');
  const columns = parse(md).blocks.find((b) => b.type === 'columns').cols.map((c) => c.blocks);
  assert.ok(columns[0].filter((b) => b.type === 'button').length >= 2, 'quick-action buttons');
  assert.ok(columns[0].some((b) => b.type === 'bullet'), 'navigation links');
  const gallery = columns[1].find((b) => b.type === 'code' && b.info?.trim() === 'database');
  assert.ok(parseDb(gallery.text).use.split(',').length >= 3, 'several tabs');
  const libros = parseDb(extractDatabase(await read('Tutorial/Libros.md')));
  const kind = (name) => libros.views.find((v) => v.name === name)?.view;
  assert.equal(kind('Leyendo'), 'gallery');
  assert.equal(kind('Páginas por estado'), 'donut');
  assert.equal(kind('Total de páginas'), 'number');
  for (const buttons of columns[0].filter((b) => b.type === 'button')) assert.match(buttons.text, /data-new="Tutorial\/(Libros|Citas)"/);
});
