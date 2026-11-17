#!/usr/bin/env node
// Vault search: Obsidian-style operators, Notion-style title boost and recency tie-break.
// shortcut: full rescan on every run, no saved index; upgrade to an incremental index if a run gets slow.
import { readdir, readFile, stat } from 'node:fs/promises';
import { basename, dirname, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const FIELDS = 'file|path|content|tag|line|block|section';
const UNIT_SPLITTERS = {
  line: (t) => t.split('\n'),
  block: (t) => t.split(/\n\s*\n/),
  section: (t) => t.split(/(?=^#{1,6}\s)/m),
};

const norm = (s, matchCase) => (matchCase ? s : s.toLowerCase());

// Strip fenced and inline code so "#x" inside code is not read as a tag.
export const outsideCode = (text) => text.replace(/```[\s\S]*?```/g, '').replace(/`[^`\n]*`/g, '');
// Tags from the YAML frontmatter, as Obsidian reads them: `tags: [a, b]`, `tags: a, b` or a `- a` list.
function frontmatterTags(content) {
  const fm = content.replace(/\r\n?/g, '\n').match(/^---\n([\s\S]*?)\n---(?:\n|$)/);
  if (!fm) return [];
  const m = fm[1].match(/^tags?:[ \t]*(.*)((?:\n[ \t]*-[ \t]+.*)*)/im);
  if (!m) return [];
  const raw = [...m[1].replace(/^\[|\]$/g, '').split(','), ...m[2].split('\n').map((l) => l.replace(/^[ \t]*-[ \t]+/, ''))];
  return raw.map((t) => t.trim().replace(/^["']|["']$/g, '').replace(/^#/, '')).filter((t) => /^[\p{L}\p{N}_][\p{L}\p{N}_/-]*$/u.test(t));
}

const extractTags = (content) => [
  ...frontmatterTags(content),
  ...[...outsideCode(content).matchAll(/(?:^|\s)#([\p{L}\p{N}_][\p{L}\p{N}_/-]*)/gu)].map((m) => m[1]),
];

export function parseQuery(input) {
  let matchCase = false;
  const text = input.replace(/\b(match-case|ignore-case):/gi, (_, flag) => {
    matchCase = flag.toLowerCase() === 'match-case';
    return ' ';
  });
  const clauses = [];
  const re = new RegExp(`(-?)(?:(${FIELDS}):)?(?:"([^"]+)"|\\(([^)]+)\\)|(\\S+))`, 'gi');
  for (const [, minus, rawField, phrase, group, word] of text.matchAll(re)) {
    const field = rawField ? rawField.toLowerCase() : 'content';
    const neg = minus === '-';
    let needles;
    let together = false;
    if (phrase !== undefined) {
      needles = [phrase];
      together = true;
    } else if (group !== undefined) {
      needles = group.split(/\s+/).filter(Boolean);
      together = true;
    } else if (word) {
      needles = [word];
    } else {
      continue;
    }
    if (field === 'tag') needles = needles.map((x) => x.replace(/^#/, ''));
    if (needles.length) clauses.push({ field, neg, together, needles });
  }
  return { clauses, matchCase };
}

// One indexed note, from its vault-relative path ("A/B.md"), text and edit time; any store builds docs with it.
export const indexDoc = (path, content, mtime) => ({ path, name: basename(path, '.md'), content, mtime, tags: extractTags(content) });

export async function buildIndex(root) {
  const docs = [];
  async function walk(dir) {
    for (const ent of await readdir(dir, { withFileTypes: true })) {
      if (ent.name.startsWith('.') || ent.name === 'node_modules') continue;
      const full = join(dir, ent.name);
      if (ent.isDirectory()) {
        await walk(full);
      } else if (ent.name.endsWith('.md')) {
        const [content, info] = await Promise.all([readFile(full, 'utf8'), stat(full)]);
        docs.push(indexDoc(relative(root, full).split(sep).join('/'), content, info.mtimeMs));
      }
    }
  }
  await walk(root);
  return docs;
}

function clauseHits(clause, doc, ctx) {
  const { field, needles } = clause;
  const n = needles.map((x) => norm(x, ctx.matchCase));
  if (field === 'file') return n.every((x) => norm(doc.name, ctx.matchCase).includes(x));
  if (field === 'path') return n.every((x) => norm(doc.path, ctx.matchCase).includes(x));
  if (field === 'tag') {
    return n.every((x) =>
      doc.tags.some((t) => {
        const tt = norm(t, ctx.matchCase);
        return tt === x || tt.startsWith(x + '/');
      }),
    );
  }
  const body = norm(doc.content, ctx.matchCase);
  if (field === 'content') return n.every((x) => body.includes(x));
  // line / block / section: every needle must appear inside one unit.
  return UNIT_SPLITTERS[field](body).some((u) => n.every((x) => u.includes(x)));
}

function scoreDoc(doc, clauses, ctx) {
  const title = norm(doc.name, ctx.matchCase);
  const body = norm(doc.content, ctx.matchCase);
  let score = 0;
  for (const c of clauses) {
    if (c.neg || (c.field !== 'content' && c.field !== 'file')) continue;
    for (const x of c.needles.map((n) => norm(n, ctx.matchCase))) {
      if (title.includes(x)) score += 3;
      score += Math.min(body.split(x).length - 1, 5);
    }
  }
  return score;
}

function snippet(doc, clauses, ctx) {
  const pos = clauses.find((c) => !c.neg && (c.field === 'content' || c.field === 'line' || c.field === 'block' || c.field === 'section'));
  const lines = doc.content.split('\n');
  const needle = pos ? norm(pos.needles[0], ctx.matchCase) : null;
  const hit = needle ? lines.find((l) => norm(l, ctx.matchCase).includes(needle)) : undefined;
  // with no text match (tag:, file:, ...) show the first body line, not the YAML frontmatter
  const body = doc.content.replace(/^---\r?\n[\s\S]*?\r?\n---\r?\n?/, '').split('\n');
  return (hit ?? body.find((l) => l.trim()) ?? '').trim().slice(0, 160);
}

export function search(docs, input, { sort = 'relevance', limit = 20 } = {}) {
  const { clauses, matchCase } = parseQuery(input);
  if (!clauses.some((c) => !c.neg)) return [];
  const ctx = { matchCase };
  const hits = [];
  for (const doc of docs) {
    if (!clauses.every((c) => clauseHits(c, doc, ctx) !== c.neg)) continue;
    hits.push({ doc, score: scoreDoc(doc, clauses, ctx), snippet: snippet(doc, clauses, ctx) });
  }
  hits.sort(
    sort === 'modified'
      ? (a, b) => b.doc.mtime - a.doc.mtime
      : (a, b) => b.score - a.score || b.doc.mtime - a.doc.mtime,
  );
  return hits.slice(0, limit);
}

async function main(argv) {
  let root = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..', 'notes');
  let sort = 'relevance';
  let limit = 20;
  const words = [];
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--root') root = argv[++i];
    else if (argv[i] === '--sort') sort = argv[++i];
    else if (argv[i] === '--limit') limit = Number(argv[++i]);
    else words.push(argv[i]);
  }
  const query = words.join(' ');
  if (!query) {
    console.error('usage: node search.mjs "query" [--root dir] [--sort relevance|modified] [--limit n]');
    process.exit(2);
  }
  const docs = await buildIndex(root);
  for (const h of search(docs, query, { sort, limit })) {
    console.log(`${h.score}\t${h.doc.path}\t${h.snippet}`);
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  main(process.argv.slice(2));
}
