#!/usr/bin/env node
// Local server for the Vault app: serves the editor UI and reads/writes Markdown notes under one folder.
// Listens on 127.0.0.1 only; every path from the browser is checked before it touches the disk.
// shortcut: the note index is rebuilt on every tree/graph/search request; cache it if a large vault gets slow.
import http from 'node:http';
import { mkdir, readdir, readFile, rename, stat, writeFile } from 'node:fs/promises';
import { basename, dirname, join, posix, resolve, sep } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { buildIndex, search } from './lib/search.mjs';
import { buildLinkGraph, makeResolver } from './lib/links.mjs';
import { parseProps } from './public/graph.mjs';

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
      throw new HttpError(400, `invalid name: "${part}"`);
    }
  });
  const full = resolve(root, ...parts);
  if (!full.startsWith(root + sep)) throw new HttpError(400, 'path escapes the vault');
  return full;
}

export function notePath(root, rel) {
  if (typeof rel !== 'string' || !rel.endsWith('.md') || rel.length > 400) throw new HttpError(400, 'path must be a .md file');
  return inVault(root, rel, (p) => p.slice(0, -3));
}

export function folderPath(root, rel) {
  if (typeof rel !== 'string' || !rel || rel.length > 400) throw new HttpError(400, 'invalid folder');
  return inVault(root, rel, (p) => p);
}

export function assetPath(root, rel) {
  if (typeof rel !== 'string' || !MEDIA_TYPES[extOf(rel)] || rel.length > 400) {
    throw new HttpError(400, 'this file type is not supported');
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

async function atomicWrite(full, content) {
  await mkdir(dirname(full), { recursive: true });
  const tmp = join(dirname(full), `.${basename(full)}.${process.pid}.tmp`);
  await writeFile(tmp, content, 'utf8');
  await rename(tmp, full);
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
    if (size > max) throw new HttpError(413, 'request too large');
    chunks.push(chunk);
  }
  return Buffer.concat(chunks);
}

async function readJson(req) {
  if (!(req.headers['content-type'] ?? '').startsWith('application/json')) {
    throw new HttpError(415, 'expected application/json');
  }
  const raw = await readBody(req, MAX_BODY);
  let body;
  try {
    body = JSON.parse(raw.toString('utf8'));
  } catch {
    throw new HttpError(400, 'invalid JSON');
  }
  if (!body || typeof body !== 'object') throw new HttpError(400, 'expected a JSON object');
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
async function folderRows(root, folder) {
  const dir = folder.replace(/\/+$/, '');
  folderPath(root, dir);
  const prefix = `${dir}/`;
  const docs = (await buildIndex(root)).filter((d) => d.path.startsWith(prefix) && !d.path.slice(prefix.length).includes('/'));
  return docs.map((d) => {
    const fm = d.content.match(/^---\n(?:[\s\S]*?\n)?---(?:\n|$)/)?.[0] ?? '';
    const rows = parseProps(fm) ?? [];
    const props = Object.fromEntries(rows.map((r) => [r.key, r.list ?? r.value]));
    // First image in the body (Markdown or Obsidian syntax), for gallery cards that have no cover property.
    const body = d.content.slice(fm.length);
    const image = body.match(/!\[\[([^\]|\n]+)(?:\|[^\]\n]*)?\]\]|!\[[^\]\n]*\]\(([^)\s]+)\)/);
    return { path: d.path, name: d.name, mtime: d.mtime, props, icon: props.icon ?? '', cover: props.cover ?? '', image: image ? (image[1] ?? image[2]).trim() : '' };
  });
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
  if (!hit) throw new HttpError(404, 'file not found');
  return assetPath(root, hit);
}

async function moveFolder(root, fromRel, toRel) {
  const from = folderPath(root, fromRel);
  const to = folderPath(root, toRel);
  if (from === to) return { path: toRel };
  const caseOnly = from.toLowerCase() === to.toLowerCase();
  if (!(await isDir(from))) throw new HttpError(404, 'folder not found');
  if ((to + sep).startsWith(from + sep)) throw new HttpError(400, 'cannot move a folder inside itself');
  const page = await statOrNull(`${from}.md`);
  if (!caseOnly && ((await statOrNull(to)) || (page && (await statOrNull(`${to}.md`))))) {
    throw new HttpError(409, 'a page or folder with that name already exists');
  }
  await mkdir(dirname(to), { recursive: true });
  await rename(from, to);
  if (page) await rename(`${from}.md`, `${to}.md`); // sub-pages move with their page
  return { path: toRel };
}

async function handle(req, res, root) {
  const host = req.headers.host ?? '';
  // Blocks DNS-rebinding: a page on another site cannot reach this server under its own host name.
  if (!/^(localhost|127\.0\.0\.1)(:\d+)?$/.test(host)) throw new HttpError(403, 'forbidden host');
  if (req.method !== 'GET' && req.headers.origin && req.headers.origin !== `http://${host}`) {
    throw new HttpError(403, 'forbidden origin');
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
      if (!info?.isFile()) throw new HttpError(404, 'page not found');
      return send(res, 200, { path: q('path'), content: await readFile(full, 'utf8'), mtime: info.mtimeMs });
    }

    case 'PUT /api/page': {
      const body = await readJson(req);
      if (typeof body.content !== 'string') throw new HttpError(400, 'content must be a string');
      const full = notePath(root, body.path);
      const current = await statOrNull(full);
      // Refuse to overwrite a file that changed on disk since the editor loaded it (Obsidian, another tab).
      const stale = current ? current.mtimeMs !== body.baseMtime : body.baseMtime != null;
      if (stale && body.force !== true) {
        throw new HttpError(409, current ? 'page changed on disk' : 'page was removed on disk', {
          mtime: current?.mtimeMs ?? null,
        });
      }
      await atomicWrite(full, body.content);
      return send(res, 200, { mtime: (await stat(full)).mtimeMs });
    }

    case 'POST /api/folder': {
      const body = await readJson(req);
      const full = folderPath(root, body.path);
      if (await statOrNull(full)) throw new HttpError(409, 'a page or folder with that name already exists');
      await mkdir(full, { recursive: true });
      return send(res, 200, { path: body.path });
    }

    case 'POST /api/rename': {
      const body = await readJson(req);
      if (body.folder === true) return send(res, 200, await moveFolder(root, body.from, body.to));
      const from = notePath(root, body.from);
      const to = notePath(root, body.to);
      if (from === to) return send(res, 200, { path: body.to });
      const caseOnly = from.toLowerCase() === to.toLowerCase();
      if (!(await statOrNull(from))) throw new HttpError(404, 'page not found');
      if (!caseOnly && (await statOrNull(to))) throw new HttpError(409, 'a page with that name already exists');
      const fromDir = from.slice(0, -3);
      const toDir = to.slice(0, -3);
      const moveDir = await isDir(fromDir);
      if (moveDir && (toDir + sep).startsWith(fromDir + sep)) throw new HttpError(400, 'cannot move a page inside itself');
      if (moveDir && !caseOnly && (await statOrNull(toDir))) throw new HttpError(409, 'a folder with that name already exists');
      await mkdir(dirname(to), { recursive: true });
      await rename(from, to);
      if (moveDir) await rename(fromDir, toDir);
      return send(res, 200, { path: body.to });
    }

    case 'POST /api/delete': {
      const body = await readJson(req);
      if (body.folder === true) {
        const dir = folderPath(root, body.path);
        if (!(await isDir(dir))) throw new HttpError(404, 'folder not found');
        await moveToTrash(root, dir);
        return send(res, 200, { ok: true });
      }
      const full = notePath(root, body.path);
      if (!(await statOrNull(full))) throw new HttpError(404, 'page not found');
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
      if (!type || /^(text\/plain|application\/x-www-form-urlencoded|multipart\/form-data)/.test(type)) throw new HttpError(415, 'expected a file');
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
      res.writeHead(200, {
        'content-type': mime,
        // Documents download instead of opening inside the app.
        ...(media ? {} : { 'content-disposition': 'attachment' }),
        'content-security-policy': "sandbox; default-src 'none'; media-src 'self'",
        'cache-control': 'no-cache',
        'x-content-type-options': 'nosniff',
      });
      return res.end(await readFile(full));
    }

    case 'GET /api/db':
      return send(res, 200, { rows: await folderRows(root, q('folder')) });

    case 'GET /api/resolve': {
      const docs = await buildIndex(root);
      return send(res, 200, { path: makeResolver(docs)(q('link'), q('from')) });
    }

    default:
      throw new HttpError(404, 'not found');
  }
}

export function createApp({ root }) {
  const vault = resolve(root);
  return http.createServer((req, res) => {
    handle(req, res, vault).catch((err) => {
      const status = err instanceof HttpError ? err.status : 500;
      if (status === 500) console.error(err);
      if (res.headersSent) return res.end();
      send(res, status, { error: status === 500 ? 'internal error' : err.message, ...(err.extra ?? {}) });
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
