import { test } from 'node:test';
import assert from 'node:assert/strict';
import { renderPageHtml } from '../lib/export.mjs';

const page = (markdown, extra = {}) => renderPageHtml({ markdown, title: 'Nota', ...extra });

test('an exported page has no script and escapes the text of the note', async () => {
  const html = await page('Hola <script>alert(1)</script> & "amigos"\n\n<img src=x onerror=alert(1)>\n');
  assert.doesNotMatch(html, /<script>alert/);
  assert.match(html, /&lt;script&gt;alert\(1\)&lt;\/script&gt; &amp; &quot;amigos&quot;/);
  assert.match(html, /<meta http-equiv="Content-Security-Policy" content="default-src 'none'/);
});

test('headings, lists, to-dos, callouts, code and dividers keep their meaning', async () => {
  const html = await page('# Título\n\n- uno\n- dos\n\n3. tres\n4. cuatro\n\n- [x] hecho\n- [ ] pendiente\n\n> [!tip] Consejo\n> Texto del aviso\n\n```\nlet x = 1 < 2\n```\n\n---\n');
  assert.match(html, /<h1>Título<\/h1>/);
  assert.match(html, /<ul><li>uno<\/li><li>dos<\/li><\/ul>/);
  assert.match(html, /<ol start="3"><li>tres<\/li><li>cuatro<\/li><\/ol>/);
  assert.match(html, /<li class="todo"><input type="checkbox" disabled checked> hecho<\/li>/);
  assert.match(html, /<div class="callout" data-kind="tip"><strong>Consejo<\/strong><br>Texto del aviso<\/div>/);
  assert.match(html, /<pre><code>let x = 1 &lt; 2<\/code><\/pre>/);
  assert.match(html, /<hr>/);
});

test('tables are written as tables, and wiki links stay as readable text', async () => {
  const html = await page('| Libro | Páginas |\n| --- | --- |\n| Dune | 412 |\n\nVer [[Piranesi]] y [[Dune|el libro]].\n');
  assert.match(html, /<th>Libro<\/th><th>Páginas<\/th>/);
  assert.match(html, /<td>Dune<\/td><td>412<\/td>/);
  assert.match(html, /el libro/);
});

test('a picture is embedded when it can be read, and named in the page when it cannot', async () => {
  const pic = 'data:image/png;base64,AAAA';
  const html = await page('![[foto.png]]\n\n![[falta.png]]\n', {
    imageUri: async (link) => (link === 'foto.png' ? pic : null),
  });
  assert.match(html, /<img src="data:image\/png;base64,AAAA" alt="">/);
  assert.match(html, /\[imagen no incluida: falta\.png\]/);
});

test('a database block becomes one table of its notes, with its charts named as a notice', async () => {
  const rows = [
    { name: 'Dune', props: { Páginas: '412', Géneros: ['Ciencia ficción'] } },
    { name: 'Piranesi', props: { Páginas: '245' } },
  ];
  const html = await page('~~~database\nsource: Libros\nview: bar\ngroup: Estado\n~~~\n', {
    rowsOf: async (folder) => (folder === 'Libros' ? rows : []),
  });
  assert.match(html, /Base de datos · Libros/);
  assert.match(html, /<th>Páginas<\/th>/);
  assert.match(html, /<td>Dune<\/td><td>412<\/td><td>Ciencia ficción<\/td>/);
  assert.match(html, /gráficos de esta base: ábrela en Vault/);
});

test('an empty note still makes a valid page', async () => {
  const html = await page('');
  assert.match(html, /<!doctype html>/);
  assert.match(html, /<h1>Nota<\/h1>/);
});
