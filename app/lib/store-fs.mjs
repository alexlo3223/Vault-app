// The vault as a folder on disk (desktop app and `npm start`). Paths are vault-relative ("A/B.md");
// the server has already checked every path with notePath/folderPath/assetPath before it gets here.
import { createReadStream } from 'node:fs';
import { pipeline } from 'node:stream/promises';
import { mkdir, readdir, readFile, rename, stat, unlink, writeFile } from 'node:fs/promises';
import { basename, dirname, join, resolve } from 'node:path';
import { buildIndex } from './search.mjs';

const statOrNull = (p) =>
  stat(p).catch((e) => {
    if (e.code === 'ENOENT') return null;
    throw e;
  });

// Writes a file without ever leaving it half-written. A new file is written beside its place and renamed into it.
// An existing file is first written in full to that side file, then overwritten in place and the side file removed:
// overwriting keeps the file's identity, so its creation time (the "Created time" property) survives every save,
// and if the overwrite fails the side file still holds the complete new content.
async function atomicWrite(full, content) {
  await mkdir(dirname(full), { recursive: true });
  const tmp = join(dirname(full), `.${basename(full)}.${process.pid}.tmp`);
  await writeFile(tmp, content, typeof content === 'string' ? 'utf8' : undefined);
  if (!(await statOrNull(full))) return rename(tmp, full);
  await writeFile(full, content, typeof content === 'string' ? 'utf8' : undefined);
  await unlink(tmp);
}

// Every folder and file under root, skipping hidden folders (.obsidian, .trash, .git) and node_modules.
export async function walkVault(root) {
  const folders = [];
  const files = [];
  async function walk(dir, prefix) {
    for (const ent of await readdir(dir, { withFileTypes: true })) {
      if (ent.name.startsWith('.') || ent.name === 'node_modules') continue;
      const rel = prefix + ent.name;
      if (ent.isDirectory()) {
        folders.push(rel);
        await walk(join(dir, ent.name), `${rel}/`);
      } else {
        files.push(rel);
      }
    }
  }
  await walk(root, '');
  return { folders, files };
}

export function fsStore(rootDir) {
  const root = resolve(rootDir);
  const full = (rel) => join(root, ...rel.split('/'));
  return {
    root,
    docs: () => buildIndex(root),
    walk: () => walkVault(root),
    async stat(rel) {
      const s = await statOrNull(full(rel));
      // Birth time for "Created time"; file systems without one report 0, then the edit time stands in.
      return s && { isFile: s.isFile(), isDir: s.isDirectory(), mtime: s.mtimeMs, ctime: s.birthtimeMs || s.mtimeMs, size: s.size };
    },
    read: (rel) => readFile(full(rel), 'utf8'),
    readBytes: (rel) => readFile(full(rel)),
    async write(rel, data) {
      await atomicWrite(full(rel), data);
      return (await stat(full(rel))).mtimeMs;
    },
    mkdir: (rel) => mkdir(full(rel), { recursive: true }),
    async move(from, to) {
      await mkdir(dirname(full(to)), { recursive: true });
      await rename(full(from), full(to));
    },
    async trash(rel) {
      const trash = join(root, '.trash');
      await mkdir(trash, { recursive: true });
      await rename(full(rel), join(trash, `${Date.now()}-${basename(full(rel))}`));
    },
    // Sends a file, honouring one byte range (what a video player asks for when it seeks).
    async sendFile(rel, req, res, headers) {
      const { size } = await stat(full(rel));
      const range = /^bytes=(\d*)-(\d*)$/.exec(req.headers.range ?? '');
      let start = 0;
      let end = size - 1;
      let status = 200;
      if (range && (range[1] || range[2])) {
        start = range[1] ? Number(range[1]) : Math.max(0, size - Number(range[2])); // "-N" is the last N bytes
        if (range[1] && range[2]) end = Math.min(Number(range[2]), size - 1);
        if (start > end) {
          res.writeHead(416, { 'content-range': `bytes */${size}` });
          return res.end();
        }
        status = 206;
        headers['content-range'] = `bytes ${start}-${end}/${size}`;
      }
      res.writeHead(status, { ...headers, 'accept-ranges': 'bytes', 'content-length': end - start + 1 });
      if (!size) return res.end();
      // Sent in pieces, never the whole file in memory. A reader that goes away mid-file is not an error.
      return pipeline(createReadStream(full(rel), { start, end }), res).catch(() => res.destroy());
    },
  };
}
