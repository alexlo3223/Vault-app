import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readdir, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { seedNotes } from '../desktop/seed.mjs';

test('an empty notes folder gets the tutorial once; a folder with notes is left alone', async () => {
  const from = await mkdtemp(join(tmpdir(), 'vault-seed-from-'));
  await mkdir(join(from, 'Tutorial'));
  await mkdir(join(from, '.trash'));
  await writeFile(join(from, 'Tutorial.md'), '# Tutorial\n');
  await writeFile(join(from, 'Tutorial', '01.md'), 'one\n');
  await writeFile(join(from, '.trash', 'old.md'), 'deleted\n');

  const dir = await mkdtemp(join(tmpdir(), 'vault-seed-to-'));
  assert.equal(await seedNotes(from, dir), true);
  assert.deepEqual((await readdir(dir)).sort(), ['Tutorial', 'Tutorial.md']);
  assert.equal(await readFile(join(dir, 'Tutorial', '01.md'), 'utf8'), 'one\n');

  await writeFile(join(dir, 'Tutorial.md'), 'mine\n');
  assert.equal(await seedNotes(from, dir), false);
  assert.equal(await readFile(join(dir, 'Tutorial.md'), 'utf8'), 'mine\n');
});
