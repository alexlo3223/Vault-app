// The vault in Supabase (the web version): the same operations as store-fs.mjs, on the vault_files table
// (supabase/migrations) and the private "vault" Storage bucket. `db` is a Supabase client signed in as the user,
// so Row Level Security limits every query to their own notes. Paths were checked by the server already.
import { createHash } from 'node:crypto';
import { indexDoc } from './search.mjs';

const sha256 = (data) => createHash('sha256').update(data).digest('hex');
const likePrefix = (dir) => `${dir.replace(/[\\%_]/g, (c) => `\\${c}`)}/%`;
const must = ({ data, error }) => {
  if (error) throw new Error(error.message);
  return data;
};
const time = (iso) => Date.parse(iso);

export function supabaseStore(db, userId) {
  const table = () => db.from('vault_files');
  // Every live row, read once per request (a store lives for one request) and again after a change.
  let cache = null;
  const rows = () =>
    (cache ??= table()
      .select('path, kind, content, size, hash, created_at, updated_at')
      .eq('deleted', false)
      .then(must)
      .then((list) => new Map(list.map((r) => [r.path, r]))));
  const changed = (row) => {
    cache = null;
    return time(row.updated_at);
  };
  const upsert = async (row) => changed(must(await table().upsert({ ...row, deleted: false }).select('updated_at').single()));
  const object = (row) => `${userId}/${row.hash}`; // attachment bytes are stored by content

  return {
    root: '/vault', // only for the path checks in server.mjs; nothing is read from disk
    async docs() {
      return [...(await rows()).values()].filter((r) => r.kind === 'note').map((r) => indexDoc(r.path, r.content ?? '', time(r.updated_at)));
    },
    async walk() {
      const folders = new Set();
      const files = [];
      for (const r of (await rows()).values()) {
        if (r.kind === 'folder') folders.add(r.path);
        else files.push(r.path);
        const parts = r.path.split('/');
        for (let i = 1; i < parts.length; i++) folders.add(parts.slice(0, i).join('/'));
      }
      return { folders: [...folders], files };
    },
    async stat(rel) {
      const all = await rows();
      const r = all.get(rel);
      if (r) return { isFile: r.kind !== 'folder', isDir: r.kind === 'folder', mtime: time(r.updated_at), ctime: time(r.created_at), size: Number(r.size) };
      // A folder that only exists because notes are inside it.
      for (const p of all.keys()) if (p.startsWith(`${rel}/`)) return { isFile: false, isDir: true, mtime: 0, ctime: 0, size: 0 };
      return null;
    },
    async read(rel) {
      return (await rows()).get(rel)?.content ?? '';
    },
    async readBytes(rel) {
      const row = (await rows()).get(rel);
      const blob = must(await db.storage.from('vault').download(object(row)));
      return Buffer.from(await blob.arrayBuffer());
    },
    // A string is a note; bytes are an attachment (`type` is its media type, kept for when it is served).
    async write(rel, data, type = 'application/octet-stream') {
      if (typeof data === 'string') return upsert({ path: rel, kind: 'note', content: data, size: Buffer.byteLength(data), hash: sha256(data) });
      const row = { path: rel, kind: 'asset', content: null, size: data.length, hash: sha256(data) };
      must(await db.storage.from('vault').upload(object(row), data, { contentType: type, upsert: true }));
      return upsert(row);
    },
    async mkdir(rel) {
      await upsert({ path: rel, kind: 'folder', content: null, size: 0, hash: null });
    },
    async move(from, to) {
      must(await db.rpc('vault_move', { src: from, dst: to }));
      cache = null;
    },
    // The row stays, marked deleted, so the desktop app learns about it on its next sync.
    async trash(rel) {
      must(await table().update({ deleted: true, content: null }).eq('path', rel).eq('deleted', false));
      must(await table().update({ deleted: true, content: null }).like('path', likePrefix(rel)).eq('deleted', false));
      cache = null;
    },
    // Storage serves the bytes (with byte ranges for video); the link works for five minutes.
    async sendFile(rel, _req, res) {
      const row = (await rows()).get(rel);
      const { signedUrl } = must(await db.storage.from('vault').createSignedUrl(object(row), 300));
      res.writeHead(302, { location: signedUrl, 'cache-control': 'no-store' });
      res.end();
    },
  };
}
