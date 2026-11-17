// Desktop ↔ cloud sync (desktop/sync.mjs) against an in-memory stand-in for the Supabase calls it makes.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readdir, readFile, rm, writeFile, mkdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import { conflictName, planSync, syncOnce } from '../desktop/sync.mjs';

test('planSync: one side changed wins, both changed keeps both, an edit beats a delete', () => {
  const m = (o) => new Map(Object.entries(o));
  const plan = planSync(
    m({ same: 'a', up: 'a', down: 'a', gone: 'a', rgone: 'a', both: 'a', editVsDel: 'a', delVsEdit: 'a' }),
    m({ same: 'a', up: 'b', down: 'a', rgone: 'a', both: 'b', editVsDel: 'b', newLocal: 'x' }),
    m({ same: 'a', up: 'a', down: 'c', gone: 'a', both: 'c', delVsEdit: 'c', newRemote: 'y' }),
  );
  assert.deepEqual(Object.fromEntries(plan.map((a) => [a.path, a.do])), {
    same: 'same', up: 'upload', down: 'download', gone: 'delete-remote', rgone: 'delete-local',
    both: 'conflict', editVsDel: 'upload', delVsEdit: 'download', newLocal: 'upload', newRemote: 'download',
  });
});

test('conflictName keeps the extension', () => {
  assert.equal(conflictName('A/Plan.md', new Date('2026-11-17T14:05:09Z')), 'A/Plan (conflicto 2026-11-17 14-05).md');
  assert.equal(conflictName('attachments/f.png', new Date('2026-11-17T14:05:09Z')), 'attachments/f (conflicto 2026-11-17 14-05).png');
});

const sha = (s) => createHash('sha256').update(s).digest('hex');

// Just the query shapes sync.mjs uses: select / upsert / update + eq / single, and storage upload / download.
function fakeDb() {
  const rows = new Map();
  const objects = new Map();
  const query = (op, payload) => {
    const filters = [];
    const q = {
      eq: (col, val) => (filters.push([col, val]), q),
      select: () => q,
      single: () => q,
      then: (ok, bad) => {
        const hit = [...rows.values()].filter((r) => filters.every(([c, v]) => r[c] === v));
        if (op === 'update') for (const r of hit) Object.assign(r, payload);
        const data = op === 'select' ? (filters.length ? hit[0] : hit) : null;
        return Promise.resolve({ data, error: null }).then(ok, bad);
      },
    };
    return q;
  };
  return {
    rows,
    objects,
    from: () => ({
      select: () => query('select'),
      update: (p) => query('update', p),
      upsert: (r) => {
        rows.set(r.path, { ...rows.get(r.path), ...r });
        return Promise.resolve({ data: null, error: null });
      },
    }),
    storage: {
      from: () => ({
        upload: async (key, data) => (objects.set(key, Buffer.from(data)), { data: {}, error: null }),
        download: async (key) => ({ data: new Blob([objects.get(key)]), error: null }),
      }),
    },
  };
}

test('syncOnce: first upload, then edits travel both ways, and a clash keeps both copies', async () => {
  const root = await mkdtemp(join(tmpdir(), 'vault-sync-'));
  const statePath = join(root, '..', `${root.split(/[\\/]/).pop()}.json`);
  const db = fakeDb();
  const run = () => syncOnce({ root, db, userId: 'u1', statePath });
  try {
    await mkdir(join(root, 'attachments'));
    await writeFile(join(root, 'A.md'), 'uno');
    await writeFile(join(root, 'attachments', 'f.png'), Buffer.from([1, 2, 3]));
    await writeFile(join(root, 'bad name .md'), 'skipped: the app refuses this name');
    assert.deepEqual(await run(), { upload: 2 });
    assert.equal(db.rows.get('A.md').content, 'uno');
    assert.equal(db.objects.size, 1);
    assert.deepEqual(await run(), {}); // nothing changed

    // Edited in the cloud (web or Claude) → arrives here.
    Object.assign(db.rows.get('A.md'), { content: 'dos', hash: sha('dos') });
    db.rows.set('B.md', { path: 'B.md', kind: 'note', content: 'nueva', hash: sha('nueva'), deleted: false });
    assert.deepEqual(await run(), { download: 2 });
    assert.equal(await readFile(join(root, 'A.md'), 'utf8'), 'dos');
    assert.equal(await readFile(join(root, 'B.md'), 'utf8'), 'nueva');

    // Deleted in the cloud → goes to the local trash, not gone.
    db.rows.get('B.md').deleted = true;
    assert.deepEqual(await run(), { 'delete-local': 1 });
    assert.ok((await readdir(join(root, '.trash'))).some((f) => f.endsWith('B.md')));

    // Edited on both sides → local stays, the cloud version is saved beside it and goes up next time.
    await writeFile(join(root, 'A.md'), 'local');
    Object.assign(db.rows.get('A.md'), { content: 'nube', hash: sha('nube') });
    assert.deepEqual(await run(), { conflict: 1 });
    assert.equal(await readFile(join(root, 'A.md'), 'utf8'), 'local');
    assert.equal(db.rows.get('A.md').content, 'local');
    const copy = (await readdir(root)).find((f) => f.includes('conflicto'));
    assert.equal(await readFile(join(root, copy), 'utf8'), 'nube');
    assert.deepEqual(await run(), { upload: 1 });

    // Deleted here → marked deleted in the cloud, so other devices drop it too.
    await rm(join(root, copy));
    assert.deepEqual(await run(), { 'delete-remote': 1 });
    assert.equal(db.rows.get(copy).deleted, true);
  } finally {
    await rm(root, { recursive: true, force: true });
    await rm(statePath, { force: true });
  }
});
