import { after, before, test } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { mkdtemp, readdir, readFile, utimes, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { createApp, notePath } from '../server.mjs';

let root;
let server;

before(async () => {
  root = resolve(await mkdtemp(join(tmpdir(), 'vault-app-')));
  server = createApp({ root });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
});
after(() => server.close());

function raw(method, path, headers = {}, body) {
  return new Promise((done, fail) => {
    const req = http.request({ host: '127.0.0.1', port: server.address().port, method, path, headers }, (res) => {
      let data = '';
      res.on('data', (c) => (data += c));
      res.on('end', () => done({ status: res.statusCode, headers: res.headers, body: data }));
    });
    req.on('error', fail);
    req.end(body);
  });
}

async function call(method, path, body) {
  const res = await raw(method, path, body ? { 'content-type': 'application/json' } : {}, body && JSON.stringify(body));
  return { status: res.status, data: res.body ? JSON.parse(res.body) : null };
}
const put = (path, content, baseMtime = null, force) => call('PUT', '/api/page', { path, content, baseMtime, force });

test('notePath keeps every path inside the vault', () => {
  assert.equal(notePath(root, 'Projects/Plan.md'), join(root, 'Projects', 'Plan.md'));
  for (const bad of ['../x.md', 'a/../../x.md', '.trash/x.md', 'x.txt', 'CON.md', 'con.notes.md', 'a /b.md', 'a./b.md', '/abs.md', 'C:/x.md', 'a\\b.md', '', 'a//b.md', '.md']) {
    assert.throws(() => notePath(root, bad), undefined, bad);
  }
});

test('pages are created, read, and protected against overwriting outside changes', async () => {
  assert.equal((await put('Note.md', 'hello\n')).status, 200);
  const got = await call('GET', '/api/page?path=Note.md');
  assert.equal(got.data.content, 'hello\n');
  assert.equal((await put('Note.md', 'create again')).status, 409);

  // Another app edits the file after we loaded it.
  await writeFile(join(root, 'Note.md'), 'external');
  await utimes(join(root, 'Note.md'), new Date(2001, 0, 1), new Date(2001, 0, 1));
  const stale = await put('Note.md', 'mine', got.data.mtime);
  assert.equal(stale.status, 409);
  assert.equal(await readFile(join(root, 'Note.md'), 'utf8'), 'external');

  const fresh = await put('Note.md', 'mine', stale.data.mtime);
  assert.equal(fresh.status, 200);
  assert.equal((await put('Note.md', 'forced', got.data.mtime, true)).status, 200);
  assert.equal(await readFile(join(root, 'Note.md'), 'utf8'), 'forced');
});

test('tree nests sub-pages under their page', async () => {
  await put('Projects.md', '');
  await put('Projects/Plan.md', 'See [[Note]] soon');
  await put('Loose/Thing.md', '');
  const { tree } = (await call('GET', '/api/tree')).data;
  assert.deepEqual(
    tree.map((n) => [n.name, n.path]),
    [['Loose', null], ['Note', 'Note.md'], ['Projects', 'Projects.md']],
  );
  assert.deepEqual(tree[2].children.map((c) => c.path), ['Projects/Plan.md']);
});

test('search and link resolution', async () => {
  const { results } = (await call('GET', '/api/search?q=soon')).data;
  assert.deepEqual(results.map((r) => r.path), ['Projects/Plan.md']);
  assert.equal((await call('GET', '/api/resolve?link=Plan&from=Note.md')).data.path, 'Projects/Plan.md');
  assert.equal((await call('GET', '/api/resolve?link=Nope&from=Note.md')).data.path, null);
});

test('graph endpoint returns nodes, links, unresolved links and tags', async () => {
  await put('Hub.md', '---\ntags: [topic]\n---\n# Hub\nLinks to [[Note]] and [[Ghost page]] #topic\n');
  const g = (await call('GET', '/api/graph')).data;
  const hub = g.nodes.find((n) => n.path === 'Hub.md');
  assert.deepEqual([hub.outCount, hub.inCount, hub.tags], [1, 0, ['topic']]);
  assert.equal(hub.snippet, 'Links to Note and Ghost page #topic'); // first text line, link brackets removed, heading skipped
  await put('OnlyHeading.md', '# Just a title\n\n```js\ncode()\n```\n');
  assert.equal((await call('GET', '/api/graph')).data.nodes.find((n) => n.path === 'OnlyHeading.md').snippet, 'Just a title');
  await call('POST', '/api/delete', { path: 'OnlyHeading.md' });
  assert.equal(g.nodes.find((n) => n.path === 'Note.md').inCount, 2);
  assert.ok(g.edges.some((e) => e.from === 'Hub.md' && e.to === 'Note.md'));
  assert.deepEqual(g.unresolved.filter((u) => u.from === 'Hub.md'), [{ from: 'Hub.md', link: 'Ghost page', count: 1 }]);
  assert.deepEqual(g.tags, [{ tag: 'topic', count: 1 }]);
  await call('POST', '/api/delete', { path: 'Hub.md' });
});

test('rename moves the sub-page folder and refuses collisions', async () => {
  assert.equal((await call('POST', '/api/rename', { from: 'Projects.md', to: 'Work.md' })).status, 200);
  assert.equal((await call('GET', '/api/page?path=Work/Plan.md')).status, 200);
  assert.equal((await call('GET', '/api/page?path=Projects/Plan.md')).status, 404);
  assert.equal((await call('POST', '/api/rename', { from: 'Note.md', to: 'Work.md' })).status, 409);
  assert.equal((await call('POST', '/api/rename', { from: 'Work.md', to: 'Work/Inner.md' })).status, 400);
  assert.equal((await call('POST', '/api/rename', { from: 'Loose/Thing.md', to: 'Loose/thing.md' })).status, 200);
});

test('delete moves the page and its sub-pages to .trash', async () => {
  assert.equal((await call('POST', '/api/delete', { path: 'Work.md' })).status, 200);
  const top = await readdir(root);
  assert.ok(!top.includes('Work.md') && !top.includes('Work'));
  assert.equal((await readdir(join(root, '.trash'))).filter((n) => /-Work(\.md)?$/.test(n)).length, 2);  const { tree } = (await call('GET', '/api/tree')).data;
  assert.ok(!tree.some((n) => n.name === 'Work'));
});

test('folders are created, listed even when empty, moved with their page, and trashed', async () => {
  assert.equal((await call('POST', '/api/folder', { path: 'Inbox' })).status, 200);
  assert.equal((await call('POST', '/api/folder', { path: 'Inbox' })).status, 409);
  assert.equal((await call('POST', '/api/folder', { path: '../Out' })).status, 400);
  let { tree } = (await call('GET', '/api/tree')).data;
  assert.deepEqual(tree.find((n) => n.name === 'Inbox'), { name: 'Inbox', key: 'Inbox', path: null, children: [] });

  await put('Area.md', '');
  await put('Area/Sub.md', '');
  assert.equal((await call('POST', '/api/rename', { from: 'Area', to: 'Inbox/Area', folder: true })).status, 200);
  assert.equal((await call('GET', '/api/page?path=Inbox/Area/Sub.md')).status, 200);
  assert.equal((await call('GET', '/api/page?path=Inbox/Area.md')).status, 200); // the page moved with its sub-pages
  assert.equal((await call('POST', '/api/rename', { from: 'Inbox', to: 'Inbox/Area/X', folder: true })).status, 400);
  assert.equal((await call('POST', '/api/rename', { from: 'Note.md', to: 'Inbox/Note.md' })).status, 200);

  assert.equal((await call('POST', '/api/delete', { path: 'Inbox', folder: true })).status, 200);
  ({ tree } = (await call('GET', '/api/tree')).data);
  assert.ok(!tree.some((n) => n.name === 'Inbox'));
});

test('images are uploaded to attachments and served by name', async () => {
  const png = Buffer.from('89504e470d0a1a0a', 'hex');
  const up = (name, type, body) => raw('POST', `/api/upload?name=${encodeURIComponent(name)}`, { 'content-type': type }, body);
  const first = await up('my pic.png', 'image/png', png);
  assert.equal(first.status, 200);
  assert.deepEqual(JSON.parse(first.body), { name: 'my pic.png', path: 'attachments/my pic.png' });
  assert.equal(JSON.parse((await up('my pic.png', 'image/png', png)).body).name, 'my pic 2.png');
  assert.equal((await up('x.png', 'text/plain', png)).status, 415);
  assert.equal((await up('evil.svg', 'image/svg+xml', '<svg/>')).status, 400);
  assert.equal((await up('a/b.png', 'image/png', png)).status, 200); // "/" becomes "-", so it stays in attachments
  assert.ok((await readdir(join(root, 'attachments'))).includes('a-b.png'));
  assert.equal((await up('../x.png', 'image/png', png)).status, 400);
  assert.equal((await up('big.png', 'image/png', Buffer.alloc(100 * 1024 * 1024 + 1))).status, 413);
  assert.equal((await up('page.html', 'text/html', '<script>')).status, 400);

  const got = await raw('GET', `/api/file?link=${encodeURIComponent('my pic.png')}&from=${encodeURIComponent('Deep/Page.md')}`);
  assert.equal(got.status, 200);
  assert.equal(got.headers['content-type'], 'image/png');
  assert.match(got.headers['content-security-policy'], /sandbox/);
  assert.equal(got.headers['content-disposition'], undefined);

  // video, audio and documents: played inline when they are media, downloaded otherwise
  assert.equal((await up('clip.mp4', 'video/mp4', Buffer.from('00', 'hex'))).status, 200);
  const clip = await raw('GET', '/api/file?link=attachments/clip.mp4');
  assert.equal(clip.headers['content-type'], 'video/mp4');
  assert.match(clip.headers['content-security-policy'], /media-src 'self'/);
  assert.equal((await up('notes.pdf', 'application/pdf', Buffer.from('%PDF'))).status, 200);
  assert.equal((await raw('GET', '/api/file?link=attachments/notes.pdf')).headers['content-disposition'], 'attachment');
  assert.equal((await raw('GET', '/api/file?link=attachments/my%20pic.png')).status, 200);
  assert.equal((await raw('GET', '/api/file?link=../secret.png')).status, 404);
  assert.equal((await raw('GET', '/api/file?link=Note.md')).status, 404);
});

test('requests from other sites and bad input are refused', async () => {
  assert.equal((await raw('GET', '/api/tree', { host: 'evil.example' })).status, 403);
  const json = { 'content-type': 'application/json' };
  const body = JSON.stringify({ path: 'Hack.md', content: 'x', baseMtime: null });
  assert.equal((await raw('PUT', '/api/page', { ...json, origin: 'http://evil.example' }, body)).status, 403);
  assert.equal((await raw('PUT', '/api/page', { 'content-type': 'text/plain' }, body)).status, 415);
  assert.equal((await raw('PUT', '/api/page', json, '{not json')).status, 400);
  assert.equal((await call('GET', '/api/page?path=../secret.md')).status, 400);
  assert.equal((await call('GET', '/api/page?path=Missing.md')).status, 404);
});

test('the UI is served with a content security policy', async () => {
  const res = await raw('GET', '/');
  assert.equal(res.status, 200);
  assert.match(res.headers['content-security-policy'], /default-src 'self'/);
  assert.match(res.body, /<script type="module" src="\/app.js">/);
  assert.equal((await raw('GET', '/server.mjs')).status, 404);
});
