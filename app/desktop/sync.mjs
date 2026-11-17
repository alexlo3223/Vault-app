// Two-way sync between the notes folder on this PC and the cloud vault in Supabase.
// The folder stays the real thing (Obsidian keeps working, and so does Vault without internet); every run compares
// three states of each file: what it was at the last sync (`base`), what the folder has, and what the cloud has.
// Nothing is ever lost: a file changed on both sides keeps the local copy and saves the cloud one beside it.
// shortcut: empty local folders are not sent to the cloud (folders travel with the files inside them).
import { createHash } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';
import { posix } from 'node:path';
import { assetPath, extOf, MEDIA_TYPES, notePath } from '../server.mjs';
import { fsStore } from '../lib/store-fs.mjs';

const sha256 = (data) => createHash('sha256').update(data).digest('hex');

// What to do with each path. base/local/remote: Map(path → hash); a path missing from local/remote is not there.
export function planSync(base, local, remote) {
  const actions = [];
  for (const path of new Set([...base.keys(), ...local.keys(), ...remote.keys()])) {
    const [b, l, r] = [base.get(path) ?? null, local.get(path) ?? null, remote.get(path) ?? null];
    if (l === r) actions.push({ path, do: 'same' });
    else if (r === b) actions.push({ path, do: l ? 'upload' : 'delete-remote' });
    else if (l === b) actions.push({ path, do: r ? 'download' : 'delete-local' });
    // Changed on both sides: an edit always beats a delete, and two edits keep both.
    else if (!l) actions.push({ path, do: 'download' });
    else if (!r) actions.push({ path, do: 'upload' });
    else actions.push({ path, do: 'conflict' });
  }
  return actions;
}

// "Notas/Plan.md" → "Notas/Plan (conflicto 2026-11-17 14-05).md"
export function conflictName(path, date = new Date()) {
  const stamp = date.toISOString().slice(0, 16).replace('T', ' ').replace(':', '-');
  const ext = posix.extname(path);
  return `${path.slice(0, path.length - ext.length)} (conflicto ${stamp})${ext}`;
}

const isNote = (path) => path.endsWith('.md');
// Only names the app itself would accept; anything else (or a path that leaves the folder) is left alone.
const syncable = (root, path) => {
  try {
    (isNote(path) ? notePath : assetPath)(root, path);
    return true;
  } catch {
    return false;
  }
};

// One sync run. `db` is a Supabase client signed in as the user; `statePath` keeps the base between runs.
export async function syncOnce({ root, db, userId, statePath, log = () => {} }) {
  const disk = fsStore(root);
  const state = JSON.parse(await readFile(statePath, 'utf8').catch(() => '{}'));
  const files = state.files ?? {}; // path → { hash, mtime, size } of the last sync
  const must = ({ data, error }) => {
    if (error) throw new Error(error.message);
    return data;
  };

  // The folder now. A file whose time and size did not change keeps its known hash, so it is not read again.
  const local = new Map();
  const seen = {};
  for (const path of (await disk.walk()).files) {
    if (!syncable(disk.root, path)) continue;
    const info = await disk.stat(path);
    const known = files[path];
    let hash = known && known.mtime === info.mtime && known.size === info.size ? known.hash : null;
    hash ??= isNote(path) ? sha256(await disk.read(path)) : sha256(await disk.readBytes(path));
    local.set(path, hash);
    seen[path] = { mtime: info.mtime, size: info.size };
  }

  // The cloud now: every row, deleted ones included (no content, just hashes).
  const rows = must(await db.from('vault_files').select('path, kind, hash, deleted'));
  const remote = new Map();
  for (const row of rows) {
    if (row.deleted || !syncable(disk.root, row.path)) continue;
    if (row.kind === 'folder') await disk.mkdir(row.path);
    else remote.set(row.path, row.hash);
  }

  const base = new Map(Object.entries(files).map(([p, f]) => [p, f.hash]));
  const upload = async (path) => {
    const data = isNote(path) ? await disk.read(path) : await disk.readBytes(path);
    const hash = local.get(path);
    if (!isNote(path)) must(await db.storage.from('vault').upload(`${userId}/${hash}`, data, { upsert: true, contentType: MEDIA_TYPES[extOf(path)] }));
    must(await db.from('vault_files').upsert({ path, kind: isNote(path) ? 'note' : 'asset', content: isNote(path) ? data : null, size: isNote(path) ? Buffer.byteLength(data) : data.length, hash, deleted: false }));
  };
  // The cloud copy of a file, as text for a note and as bytes for an attachment.
  const fetchRemote = async (path) => {
    if (isNote(path)) return must(await db.from('vault_files').select('content').eq('path', path).single()).content ?? '';
    return Buffer.from(await must(await db.storage.from('vault').download(`${userId}/${remote.get(path)}`)).arrayBuffer());
  };
  const record = async (path) => {
    const info = await disk.stat(path);
    const data = isNote(path) ? await disk.read(path) : await disk.readBytes(path);
    files[path] = { hash: sha256(data), mtime: info.mtime, size: info.size };
  };

  const counts = {};
  for (const { path, do: what } of planSync(base, local, remote)) {
    try {
      if (what === 'same') {
        if (local.has(path)) files[path] = { hash: local.get(path), ...seen[path] };
        else delete files[path];
        continue;
      }
      if (what === 'upload') {
        await upload(path);
        files[path] = { hash: local.get(path), ...seen[path] };
      } else if (what === 'download') {
        await disk.write(path, await fetchRemote(path));
        await record(path);
      } else if (what === 'delete-local') {
        await disk.trash(path); // to .trash, like deleting in the app
        delete files[path];
      } else if (what === 'delete-remote') {
        must(await db.from('vault_files').update({ deleted: true, content: null }).eq('path', path));
        delete files[path];
      } else if (what === 'conflict') {
        const copy = conflictName(path);
        await disk.write(copy, await fetchRemote(path)); // the next run sends this copy up as a new file
        await upload(path);
        files[path] = { hash: local.get(path), ...seen[path] };
        log('sync conflict', `${path} → ${copy}`);
      }
      counts[what] = (counts[what] ?? 0) + 1;
    } catch (err) {
      log('sync failed', `${path}: ${err.message}`); // one bad file must not stop the others
    }
  }
  await writeFile(statePath, JSON.stringify({ files }, null, 1));
  return counts;
}
