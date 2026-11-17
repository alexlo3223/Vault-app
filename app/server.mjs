#!/usr/bin/env node
// Local server for the Vault app: serves the editor UI and reads/writes Markdown notes under one folder.
// Listens on 127.0.0.1 only; every path from the browser is checked before it touches the disk.
// shortcut: the note index is rebuilt on every tree/graph/search request; cache it if a large vault gets slow.
import http from 'node:http';
import { createReadStream } from 'node:fs';
import { pipeline } from 'node:stream/promises';
import { mkdir, readdir, readFile, rename, stat, unlink, writeFile } from 'node:fs/promises';
import { basename, dirname, join, posix, resolve, sep } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { buildIndex, search } from './lib/search.mjs';
import { buildLinkGraph, makeResolver, rewriteLinks } from './lib/links.mjs';
import { parseProps, renameProp } from './public/graph.mjs';
import { validPropName } from './public/properties.mjs';
import { extractDatabase, parseDb } from './public/database.mjs';
import { renderPageHtml } from './lib/export.mjs';
import { related, suggestTags } from './public/similar.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const PUBLIC = join(HERE, 'public');
const JS = 'text/javascript; charset=utf-8';
const STATIC = {
  '/': ['index.html', 'text/html; charset=utf-8'],
  '/app.js': ['app.js', JS],
  '/views.js': ['views.js', JS],
  '/blocks.mjs': ['blocks.mjs', JS],
  '/graph.mjs': ['graph.mjs', JS],
  '/database.mjs': ['database.mjs', JS],
  '/database-ui.mjs': ['database-ui.mjs', JS],
  '/formula.mjs': ['formula.mjs', JS],
  '/properties.mjs': ['properties.mjs', JS],
  '/props-ui.mjs': ['props-ui.mjs', JS],
  '/cover.mjs': ['cover.mjs', JS],
  '/cover-ui.mjs': ['cover-ui.mjs', JS],
  '/similar.mjs': ['similar.mjs', JS],
  '/style.css': ['style.css', 'text/css; charset=utf-8'],
  '/manifest.webmanifest': ['manifest.webmanifest', 'application/manifest+json'],
  '/icon.svg': ['icon.svg', 'image/svg+xml'],
  '/fonts/geist.woff2': ['fonts/geist.woff2', 'font/woff2'],
  '/fonts/jetbrains-mono.woff2': ['fonts/jetbrains-mono.woff2', 'font/woff2'],
  '/fonts/space-grotesk.woff2': ['fonts/space-grotesk.woff2', 'font/woff2'],
};
// frame-src https: lets notes embed web pages and videos; only https frames are allowed, and they run sandboxed.
const CSP = "default-src 'self'; img-src 'self' data: https:; frame-src https:; object-src 'none'; base-uri 'none'; frame-ancestors 'none'";
const MAX_BODY = 5 * 1024 * 1024;
const MAX_UPLOAD = 100 * 1024 * 1024;
// An exported page embeds its pictures: each one up to 5 MB, and 25 MB in all, so the file stays a sane size.
const EXPORT_IMAGE_MAX = 5 * 1024 * 1024;
const EXPORT_TOTAL_MAX = 25 * 1024 * 1024;
const ATTACHMENTS = 'attachments';
// No SVG: opened directly, an SVG file can run scripts.
// Files the app will store and serve. Explicit list: no SVG and no HTML, since opened directly they can run scripts.
const MEDIA_TYPES = {
  png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', gif: 'image/gif', webp: 'image/webp', avif: 'image/avif', bmp: 'image/bmp',
  mp4: 'video/mp4', webm: 'video/webm', mov: 'video/quicktime',
  mp3: 'audio/mpeg', wav: 'audio/wav', m4a: 'audio/mp4', ogg: 'audio/ogg',
  pdf: 'application/pdf', txt: 'text/plain; charset=utf-8', csv: 'text/csv; charset=utf-8', zip: 'application/zip',
  docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  pptx: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
};
const extOf = (name) => (name.includes('.') ? name.slice(name.lastIndexOf('.') + 1).toLowerCase() : '');
const RESERVED = /^(con|prn|aux|nul|com\d|lpt\d)$/i; // Windows device names

export class HttpError extends Error {
  constructor(status, message, extra = {}) {
    super(message);
    this.status = status;
    this.extra = extra;
  }
}

// Trust boundary: a vault-relative path from the browser becomes an absolute path inside root, or is refused.
function inVault(root, rel, lastStem) {
  const parts = rel.split('/');
  parts.forEach((part, i) => {
    const stem = i === parts.length - 1 ? lastStem(part) : part;
    if (
      !stem ||
      stem.startsWith('.') ||
      stem !== stem.trimStart() ||
      /[. ]$/.test(stem) ||
      /[\\:*?"<>|\u0000-\u001f]/.test(part) ||
      RESERVED.test(stem.split('.')[0])
    ) {
      throw new HttpError(400, `nombre no válido: "${part}"`);
    }
  });
  const full = resolve(root, ...parts);
  if (!full.startsWith(root + sep)) throw new HttpError(400, 'la ruta se sale del vault');
  return full;
}

export function notePath(root, rel) {
  if (typeof rel !== 'string' || !rel.endsWith('.md') || rel.length > 400) throw new HttpError(400, 'la ruta debe ser un archivo .md');
  return inVault(root, rel, (p) => p.slice(0, -3));
}

export function folderPath(root, rel) {
  if (typeof rel !== 'string' || !rel || rel.length > 400) throw new HttpError(400, 'carpeta no válida');
  return inVault(root, rel, (p) => p);
}

export function assetPath(root, rel) {
  if (typeof rel !== 'string' || !MEDIA_TYPES[extOf(rel)] || rel.length > 400) {
    throw new HttpError(400, 'este tipo de archivo no se admite');
  }
  return inVault(root, rel, (p) => p.slice(0, p.lastIndexOf('.')));
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

// Notion-style nesting on plain files: "A.md" is a page, "A/B.md" is its sub-page; folders without a page show too.
export function buildTree(docs, folders = []) {
  const top = { children: [] };
  const nodes = new Map();
  const node = (key) => {
    if (nodes.has(key)) return nodes.get(key);
    const slash = key.lastIndexOf('/');
    const parent = slash < 0 ? top : node(key.slice(0, slash));
    const n = { name: key.slice(slash + 1), key, path: null, children: [] };
    parent.children.push(n);
    nodes.set(key, n);
    return n;
  };
  for (const f of folders) node(f);
  for (const d of docs) node(d.path.slice(0, -3)).path = d.path;
  const sortAll = (n) => {
    n.children.sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true, sensitivity: 'base' }));
    n.children.forEach(sortAll);
  };
  sortAll(top);
  return top.children;
}

// One-line preview of a note: the first text line (not a heading, not code), with link brackets removed.
// Falls back to the first heading for notes that are only headings.
const firstLine = (content) => {
  const body = content.replace(/\r\n?/g, '\n').replace(/^---\n[\s\S]*?\n---(?:\n|$)/, '');
  let heading = '';
  let inFence = false;
  for (const line of body.split('\n')) {
    if (/^\s*(`{3,}|~{3,})/.test(line)) {
      inFence = !inFence;
      continue;
    }
    if (inFence) continue;
    const isHeading = /^\s*#{1,6}\s+/.test(line);
    const t = line
      .replace(/^\s*(#{1,6}\s+|[-*+]\s+(\[[ xX]\]\s+)?|>\s?|\d+[.)]\s+)/, '')
      .replace(/\[\[(?:[^\]|]*\|)?([^\]]*)\]\]/g, '$1')
      .replace(/\*\*/g, '')
      .trim();
    if (!t || /^(-{3,}|\*{3,})$/.test(t)) continue;
    if (!isHeading) return t.slice(0, 160);
    heading ||= t.slice(0, 160);
  }
  return heading;
};

// Everything the Overview, Graph and Inspector views need, computed from the notes on disk.
export function buildGraphData(docs) {
  const { resolved, unresolved } = buildLinkGraph(docs);
  const inCount = new Map();
  const outCount = new Map();
  const edges = [];
  for (const [from, dests] of Object.entries(resolved)) {
    for (const [to, count] of Object.entries(dests)) {
      if (to === from) continue;
      edges.push({ from, to, count });
      outCount.set(from, (outCount.get(from) ?? 0) + 1);
      inCount.set(to, (inCount.get(to) ?? 0) + 1);
    }
  }
  const tagTotals = new Map();
  const nodes = docs.map((d) => {
    const seen = new Map();
    for (const t of d.tags) if (!seen.has(t.toLowerCase())) seen.set(t.toLowerCase(), t);
    for (const [key, tag] of seen) {
      const entry = tagTotals.get(key) ?? { tag, count: 0 };
      entry.count++;
      tagTotals.set(key, entry);
    }
    return {
      path: d.path,
      name: d.name,
      mtime: d.mtime,
      size: Buffer.byteLength(d.content),
      tags: [...seen.values()],
      snippet: firstLine(d.content),
      inCount: inCount.get(d.path) ?? 0,
      outCount: outCount.get(d.path) ?? 0,
    };
  });
  return {
    nodes,
    edges,
    unresolved: Object.entries(unresolved).flatMap(([from, links]) => Object.entries(links).map(([link, count]) => ({ from, link, count }))),
    tags: [...tagTotals.values()].sort((a, b) => b.count - a.count || a.tag.localeCompare(b.tag)),
  };
}

const statOrNull = (p) =>
  stat(p).catch((e) => {
    if (e.code === 'ENOENT') return null;
    throw e;
  });
const isDir = async (p) => (await statOrNull(p))?.isDirectory() ?? false;

// Writes a file without ever leaving it half-written. A new file is written beside its place and renamed into it.
// An existing file is first written in full to that side file, then overwritten in place and the side file removed:
// overwriting keeps the file's identity, so its creation time (the "Created time" property) survives every save,
// and if the overwrite fails the side file still holds the complete new content.
async function atomicWrite(full, content) {
  await mkdir(dirname(full), { recursive: true });
  const tmp = join(dirname(full), `.${basename(full)}.${process.pid}.tmp`);
  await writeFile(tmp, content, 'utf8');
  if (!(await statOrNull(full))) return rename(tmp, full);
  await writeFile(full, content, 'utf8');
  await unlink(tmp);
}

async function moveToTrash(root, full) {
  const trash = join(root, '.trash');
  await mkdir(trash, { recursive: true });
  await rename(full, join(trash, `${Date.now()}-${basename(full)}`));
}

async function readBody(req, max) {
  const chunks = [];
  let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    if (size > max) throw new HttpError(413, 'la petición es demasiado grande');
    chunks.push(chunk);
  }
  return Buffer.concat(chunks);
}

async function readJson(req) {
  if (!(req.headers['content-type'] ?? '').startsWith('application/json')) {
    throw new HttpError(415, 'se esperaba application/json');
  }
  const raw = await readBody(req, MAX_BODY);
  let body;
  try {
    body = JSON.parse(raw.toString('utf8'));
  } catch {
    throw new HttpError(400, 'JSON no válido');
  }
  if (!body || typeof body !== 'object') throw new HttpError(400, 'se esperaba un objeto JSON');
  return body;
}

function send(res, status, data) {
  res.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'cache-control': 'no-store',
    'x-content-type-options': 'nosniff',
  });
  res.end(JSON.stringify(data));
}

// The notes directly inside one folder, with their frontmatter properties, for database blocks.
// Properties that parseProps cannot read (raw YAML) come back as an empty object.
const FRONTMATTER = /^---\r?\n(?:[\s\S]*?\r?\n)?---(?:\r?\n|$)/;

// The notes directly inside one database folder.
async function rowDocs(root, folder) {
  const dir = folder.replace(/\/+$/, '');
  folderPath(root, dir);
  const prefix = `${dir}/`;
  return (await buildIndex(root)).filter((d) => d.path.startsWith(prefix) && !d.path.slice(prefix.length).includes('/'));
}

async function folderRows(root, folder) {
  const docs = await rowDocs(root, folder);
  return Promise.all(
    docs.map(async (d) => {
      const fm = d.content.match(FRONTMATTER)?.[0] ?? '';
      const rows = parseProps(fm) ?? [];
      const props = Object.fromEntries(rows.map((r) => [r.key, r.list ?? r.value]));
      // First image in the body (Markdown or Obsidian syntax), for gallery cards that have no cover property.
      const body = d.content.slice(fm.length);
      const image = body.match(/!\[\[([^\]|\n]+)(?:\|[^\]\n]*)?\]\]|!\[[^\]\n]*\]\(([^)\s]+)\)/);
      // Birth time for "Created time"; file systems without one report 0, then the edit time stands in.
      const info = await statOrNull(notePath(root, d.path));
      const ctime = info?.birthtimeMs || d.mtime;
      return { path: d.path, name: d.name, mtime: d.mtime, ctime, props, icon: props.icon ?? '', cover: props.cover ?? '', image: image ? (image[1] ?? image[2]).trim() : '' };
    }),
  );
}

// Renames a property in every row of a database (or removes it when `to` is empty), keeping the rest of each note.
async function renameRowsProp(root, folder, from, to) {
  if (typeof from !== 'string' || !from || typeof to !== 'string') throw new HttpError(400, 'from y to deben ser texto');
  if (to && !validPropName(to)) throw new HttpError(400, 'ese nombre de propiedad no está permitido');
  let changed = 0;
  for (const d of await rowDocs(root, folder)) {
    const full = notePath(root, d.path);
    const content = await readFile(full, 'utf8');
    const fm = content.match(FRONTMATTER)?.[0];
    if (!fm) continue;
    const next = renameProp(fm, from, to);
    if (next === fm) continue;
    await atomicWrite(full, next + content.slice(fm.length));
    changed++;
  }
  return { changed };
}

// Like Obsidian: relative to the note, then from the vault root, then the shortest path with that file name.
async function findAsset(root, link, from) {
  const tries = [posix.normalize(link)];
  if (from) tries.unshift(posix.join(posix.dirname(from), link));
  for (const rel of tries) {
    let full;
    try {
      full = assetPath(root, rel);
    } catch {
      continue;
    }
    if ((await statOrNull(full))?.isFile()) return full;
  }
  const name = posix.basename(link).toLowerCase();
  const hit = (await walkVault(root)).files.filter((f) => posix.basename(f).toLowerCase() === name).sort((a, b) => a.length - b.length)[0];
  if (!hit) throw new HttpError(404, 'no se encuentra el archivo');
  return assetPath(root, hit);
}

async function moveFolder(root, fromRel, toRel) {
  const from = folderPath(root, fromRel);
  const to = folderPath(root, toRel);
  if (from === to) return { path: toRel };
  const caseOnly = from.toLowerCase() === to.toLowerCase();
  if (!(await isDir(from))) throw new HttpError(404, 'no se encuentra la carpeta');
  if ((to + sep).startsWith(from + sep)) throw new HttpError(400, 'no se puede mover una carpeta dentro de sí misma');
  const page = await statOrNull(`${from}.md`);
  if (!caseOnly && ((await statOrNull(to)) || (page && (await statOrNull(`${to}.md`))))) {
    throw new HttpError(409, 'ya existe una página o carpeta con ese nombre');
  }
  await mkdir(dirname(to), { recursive: true });
  await rename(from, to);
  if (page) await rename(`${from}.md`, `${to}.md`); // sub-pages move with their page
  return { path: toRel };
}

// After a rename, rewrites the [[links]] that would no longer find their note, and says which notes it changed.
// `before` is the index from before the move; fromKey and toKey are the old and new path without ".md"
// (a page takes its sub-pages along, a folder its page).
// shortcut: only [[wikilinks]] are rewritten, not Markdown links nor the page:/source: of database blocks; add them if renames break those.
async function relink(root, before, fromKey, toKey) {
  if (fromKey === toKey) return [];
  const moved = (p) => (p === `${fromKey}.md` || p.startsWith(`${fromKey}/`) ? toKey + p.slice(fromKey.length) : p);
  const was = makeResolver(before);
  const now = makeResolver(await buildIndex(root));
  const relinked = [];
  for (const d of before) {
    const path = moved(d.path);
    const next = rewriteLinks(d.content, (lp) => {
      const old = was(lp, d.path);
      const dest = old && moved(old);
      if (!dest || now(lp, path) === dest) return null; // still finds its note
      const name = posix.basename(dest, '.md');
      return !lp.includes('/') && now(name, path) === dest ? name : dest.slice(0, -3);
    });
    if (next === d.content) continue;
    await atomicWrite(notePath(root, path), next);
    relinked.push(path);
  }
  return relinked;
}

async function handle(req, res, root) {
  const host = req.headers.host ?? '';
  // Blocks DNS-rebinding: a page on another site cannot reach this server under its own host name.
  if (!/^(localhost|127\.0\.0\.1)(:\d+)?$/.test(host)) throw new HttpError(403, 'host no permitido');
  if (req.method !== 'GET' && req.headers.origin && req.headers.origin !== `http://${host}`) {
    throw new HttpError(403, 'origen no permitido');
  }
  const url = new URL(req.url, `http://${host}`);
  const q = (name) => url.searchParams.get(name) ?? '';

  if (req.method === 'GET' && STATIC[url.pathname]) {
    const [file, type] = STATIC[url.pathname];
    res.writeHead(200, {
      'content-type': type,
      'content-security-policy': CSP,
      'cache-control': 'no-cache',
      'x-content-type-options': 'nosniff',
    });
    return res.end(await readFile(join(PUBLIC, file)));
  }

  switch (`${req.method} ${url.pathname}`) {
    case 'GET /api/tree':
      return send(res, 200, { tree: buildTree(await buildIndex(root), (await walkVault(root)).folders) });

    case 'GET /api/graph':
      return send(res, 200, buildGraphData(await buildIndex(root)));

    case 'GET /api/page': {
      const full = notePath(root, q('path'));
      const info = await statOrNull(full);
      if (!info?.isFile()) throw new HttpError(404, 'no se encuentra la página');
      return send(res, 200, { path: q('path'), content: await readFile(full, 'utf8'), mtime: info.mtimeMs });
    }

    case 'PUT /api/page': {
      const body = await readJson(req);
      if (typeof body.content !== 'string') throw new HttpError(400, 'content debe ser texto');
      const full = notePath(root, body.path);
      const current = await statOrNull(full);
      // Refuse to overwrite a file that changed on disk since the editor loaded it (Obsidian, another tab).
      const stale = current ? current.mtimeMs !== body.baseMtime : body.baseMtime != null;
      if (stale && body.force !== true) {
        throw new HttpError(409, current ? 'la página cambió en el disco' : 'la página se borró del disco', {
          mtime: current?.mtimeMs ?? null,
        });
      }
      await atomicWrite(full, body.content);
      return send(res, 200, { mtime: (await stat(full)).mtimeMs });
    }

    case 'POST /api/folder': {
      const body = await readJson(req);
      const full = folderPath(root, body.path);
      if (await statOrNull(full)) throw new HttpError(409, 'ya existe una página o carpeta con ese nombre');
      await mkdir(full, { recursive: true });
      return send(res, 200, { path: body.path });
    }

    case 'POST /api/rename': {
      const body = await readJson(req);
      const before = await buildIndex(root);
      if (body.folder === true) {
        const moved = await moveFolder(root, body.from, body.to);
        return send(res, 200, { ...moved, relinked: await relink(root, before, body.from, body.to) });
      }
      const from = notePath(root, body.from);
      const to = notePath(root, body.to);
      if (from === to) return send(res, 200, { path: body.to });
      const caseOnly = from.toLowerCase() === to.toLowerCase();
      if (!(await statOrNull(from))) throw new HttpError(404, 'no se encuentra la página');
      if (!caseOnly && (await statOrNull(to))) throw new HttpError(409, 'ya existe una página con ese nombre');
      const fromDir = from.slice(0, -3);
      const toDir = to.slice(0, -3);
      const moveDir = await isDir(fromDir);
      if (moveDir && (toDir + sep).startsWith(fromDir + sep)) throw new HttpError(400, 'no se puede mover una página dentro de sí misma');
      if (moveDir && !caseOnly && (await statOrNull(toDir))) throw new HttpError(409, 'ya existe una carpeta con ese nombre');
      await mkdir(dirname(to), { recursive: true });
      await rename(from, to);
      if (moveDir) await rename(fromDir, toDir);
      return send(res, 200, { path: body.to, relinked: await relink(root, before, body.from.slice(0, -3), body.to.slice(0, -3)) });
    }

    case 'POST /api/delete': {
      const body = await readJson(req);
      if (body.folder === true) {
        const dir = folderPath(root, body.path);
        if (!(await isDir(dir))) throw new HttpError(404, 'no se encuentra la carpeta');
        await moveToTrash(root, dir);
        return send(res, 200, { ok: true });
      }
      const full = notePath(root, body.path);
      if (!(await statOrNull(full))) throw new HttpError(404, 'no se encuentra la página');
      await moveToTrash(root, full);
      if (await isDir(full.slice(0, -3))) await moveToTrash(root, full.slice(0, -3));
      return send(res, 200, { ok: true });
    }

    case 'GET /api/search': {
      const sort = q('sort') === 'modified' ? 'modified' : 'relevance';
      const hits = search(await buildIndex(root), q('q'), { limit: 30, sort });
      return send(res, 200, {
        results: hits.map((h) => ({ path: h.doc.path, name: h.doc.name, score: h.score, snippet: h.snippet })),
      });
    }

    case 'POST /api/upload': {
      // Plain-text and form bodies are what a cross-site form can send without a preflight; refuse them here.
      // The Origin check above already blocks other sites.
      const type = req.headers['content-type'] ?? '';
      if (!type || /^(text\/plain|application\/x-www-form-urlencoded|multipart\/form-data)/.test(type)) throw new HttpError(415, 'se esperaba un archivo');
      const wanted = q('name').replace(/[\\/:*?"<>|#^[\]\u0000-\u001f]/g, '-').trim();
      assetPath(root, `${ATTACHMENTS}/${wanted}`);
      const data = await readBody(req, MAX_UPLOAD);
      const dot = wanted.lastIndexOf('.');
      let name = wanted;
      for (let n = 2; await statOrNull(join(root, ATTACHMENTS, name)); n++) name = `${wanted.slice(0, dot)} ${n}${wanted.slice(dot)}`;
      await atomicWrite(assetPath(root, `${ATTACHMENTS}/${name}`), data);
      return send(res, 200, { name, path: `${ATTACHMENTS}/${name}` });
    }

    case 'GET /api/file': {
      const full = await findAsset(root, q('link'), q('from'));
      const mime = MEDIA_TYPES[extOf(full)];
      const media = /^(image|video|audio)\//.test(mime);
      const { size } = await stat(full);
      const headers = {
        'content-type': mime,
        // Documents download instead of opening inside the app.
        ...(media ? {} : { 'content-disposition': 'attachment' }),
        'content-security-policy': "sandbox; default-src 'none'; media-src 'self'",
        'cache-control': 'no-cache',
        'x-content-type-options': 'nosniff',
        'accept-ranges': 'bytes',
      };
      // One byte range, which is what a player asks for when it seeks; any other Range header gets the whole file.
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
      res.writeHead(status, { ...headers, 'content-length': end - start + 1 });
      if (!size) return res.end();
      // Sent in pieces, never the whole file in memory. A reader that goes away mid-file is not an error.
      return pipeline(createReadStream(full, { start, end }), res).catch(() => res.destroy());
    }

    // Notes that read like this one, and tags it could take (from the text alone; see public/similar.mjs).
    case 'GET /api/related': {
      const path = q('path');
      notePath(root, path);
      const docs = await buildIndex(root);
      const me = docs.find((d) => d.path === path);
      const existing = me ? me.content.match(/#[\p{L}_][\p{L}\p{N}_/-]*/gu) ?? [] : [];
      return send(res, 200, { related: related(docs, path, 5), tags: suggestTags(docs, path, 5, existing) });
    }

    case 'GET /api/export': {
      // One note as a standalone HTML file (see lib/export.mjs). Pictures that cannot be embedded are named in the page.
      const path = q('path');
      const full = notePath(root, path);
      const info = await statOrNull(full);
      if (!info?.isFile()) throw new HttpError(404, 'page not found');
      const budget = { total: 0 };
      const html = await renderPageHtml({
        markdown: await readFile(full, 'utf8'),
        title: basename(path, '.md'),
        from: path,
        imageUri: async (link, from) => {
          try {
            const file = await findAsset(root, link, from);
            const mime = MEDIA_TYPES[extOf(file)];
            if (!/^image\//.test(mime)) return null;
            const { size } = await stat(file);
            if (size > EXPORT_IMAGE_MAX || budget.total + size > EXPORT_TOTAL_MAX) return null;
            budget.total += size;
            return `data:${mime};base64,${(await readFile(file)).toString('base64')}`;
          } catch {
            return null; // not found, or outside the vault: the page says so instead
          }
        },
        rowsOf: async (folder) => {
          try {
            return (await folderRows(root, folder)).map((r) => ({ name: r.name, props: r.props }));
          } catch {
            return []; // a folder that is not a database source: an empty table
          }
        },
        // An embed names a database page: its database block gives the folder and the views (see lib/export.mjs).
        sourceOf: async (page) => {
          try {
            const text = extractDatabase(await readFile(notePath(root, `${page}.md`), 'utf8'));
            if (text === null) return null;
            const cfg = parseDb(text);
            return cfg.source ? { source: cfg.source, views: cfg.views, props: cfg.props } : null;
          } catch {
            return null;
          }
        },
      });
      const name = basename(path, '.md').replace(/["\\\r\n]/g, '_');
      res.writeHead(200, {
        'content-type': 'text/html; charset=utf-8',
        'content-disposition': `attachment; filename="${name}.html"; filename*=UTF-8''${encodeURIComponent(name)}.html`,
        'cache-control': 'no-store',
        'x-content-type-options': 'nosniff',
      });
      return res.end(html);
    }

    case 'GET /api/db':
      return send(res, 200, { rows: await folderRows(root, q('folder')) });

    case 'POST /api/db/prop': {
      const body = await readJson(req);
      if (typeof body.folder !== 'string' || !body.folder) throw new HttpError(400, 'falta la carpeta');
      return send(res, 200, await renameRowsProp(root, body.folder, body.from, body.to ?? ''));
    }

    // Pages that hold a database block (with a source folder): the choices of the "insert database" menu.
    case 'GET /api/databases': {
      const databases = [];
      for (const d of await buildIndex(root)) {
        const text = extractDatabase(d.content);
        const source = text === null ? '' : parseDb(text).source;
        if (source) databases.push({ path: d.path, name: d.name, source });
      }
      return send(res, 200, { databases });
    }

    case 'GET /api/resolve': {
      const docs = await buildIndex(root);
      return send(res, 200, { path: makeResolver(docs)(q('link'), q('from')) });
    }

    default:
      throw new HttpError(404, 'no encontrado');
  }
}

export function createApp({ root }) {
  const vault = resolve(root);
  return http.createServer((req, res) => {
    handle(req, res, vault).catch((err) => {
      const status = err instanceof HttpError ? err.status : 500;
      if (status === 500) console.error(err);
      if (res.headersSent) return res.end();
      send(res, status, { error: status === 500 ? 'error interno' : err.message, ...(err.extra ?? {}) });
    });
  });
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const args = process.argv.slice(2);
  const opt = (name, fallback) => (args.includes(name) ? args[args.indexOf(name) + 1] : fallback);
  const root = resolve(opt('--root', join(HERE, '..', 'notes')));
  const port = Number(opt('--port', process.env.PORT ?? 4321));
  createApp({ root }).listen(port, '127.0.0.1', () => {
    console.log(`Vault app: http://localhost:${port}   notes: ${root}`);
  });
}
