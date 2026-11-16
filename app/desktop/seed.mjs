// First run of the desktop app: an empty notes folder gets the tutorial notes that ship with the app.
// Kept apart from main.mjs so the tests can run it without Electron.
import { cp, readdir } from 'node:fs/promises';
import { basename } from 'node:path';

// Copies the notes in `from` into `dir` only if `dir` has nothing in it; hidden entries (.trash) stay behind.
export async function seedNotes(from, dir) {
  if ((await readdir(dir)).length) return false;
  await cp(from, dir, { recursive: true, filter: (src) => src === from || !basename(src).startsWith('.') });
  return true;
}
