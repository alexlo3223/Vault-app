#!/usr/bin/env node
// Note links and backlinks, modelled on Obsidian's MetadataCache (resolvedLinks / unresolvedLinks)
// and its Backlinks pane (linked + unlinked mentions).
import { dirname, posix, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { buildIndex, outsideCode } from './search.mjs';

// [[Note]], [[Note#Heading]], [[Note|alias]], ![[Note]]; group 1 is the linkpath.
const WIKILINK = /!?\[\[([^\]|#^]*)[^\]]*\]\]/g;
const MDLINK = /\[[^\]]*\]\(<?([^)>\s]+)>?\)/g;
// Attachments are not indexed, so links to them are neither resolved nor reported as missing.
const ATTACHMENT = /\.(png|jpe?g|gif|svg|webp|bmp|pdf|mp3|mp4|webm|wav|ogg|m4a|mov|canvas|base)$/i;

const escapeRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

export function extractLinks(content) {
  const text = outsideCode(content);
  const out = [];
  for (const m of text.matchAll(WIKILINK)) {
    const lp = m[1].trim();
    if (lp) out.push(lp);
  }
  for (const m of text.matchAll(MDLINK)) {
    if (m[1].includes('://')) continue;
    let url = m[1].split('#')[0];
    try {
      url = decodeURIComponent(url);
    } catch {
      // keep the raw url when it is not valid percent-encoding
    }
    if (/\.md$/i.test(url)) out.push(url);
  }
  return out.filter((lp) => !ATTACHMENT.test(lp));
}

// Same rules as Obsidian's getFirstLinkpathDest: relative to the source note, then vault-absolute,
// then any note whose path ends with the linkpath (same folder first, then shortest path).
export function makeResolver(docs) {
  const byPath = new Map(docs.map((d) => [d.path.toLowerCase(), d.path]));
  const byName = new Map();
  for (const d of docs) {
    const key = d.name.toLowerCase();
    if (!byName.has(key)) byName.set(key, []);
    byName.get(key).push(d.path);
  }
  for (const list of byName.values()) {
    list.sort((a, b) => a.split('/').length - b.split('/').length || a.localeCompare(b));
  }
  return function resolveLink(linkpath, sourcePath) {
    const lp = linkpath.replace(/\\/g, '/').replace(/^\.\//, '').replace(/\.md$/i, '');
    const srcDir = posix.dirname(sourcePath || 'x');
    const rel = posix.normalize(posix.join(srcDir, lp) + '.md').toLowerCase();
    if (byPath.has(rel)) return byPath.get(rel);
    const abs = posix.normalize(lp.replace(/^\//, '') + '.md').toLowerCase();
    if (byPath.has(abs)) return byPath.get(abs);
    const candidates = byName.get(posix.basename(lp).toLowerCase()) ?? [];
    if (!lp.includes('/')) {
      return candidates.find((p) => posix.dirname(p) === srcDir) ?? candidates[0] ?? null;
    }
    return candidates.find((p) => ('/' + p.toLowerCase()).endsWith('/' + abs)) ?? null;
  };
}

// Rewrites the linkpath of the wikilinks outside code: `rewrite(linkpath)` gives the new one, or null to keep it.
// The heading, the alias and a leading "!" stay as written.
export function rewriteLinks(content, rewrite) {
  const fix = (text) =>
    text.replace(/(!?\[\[)([^\]|#^]*)([^\]]*\]\])/g, (all, open, lp, rest) => {
      const next = lp.trim() ? rewrite(lp.trim()) : null;
      return next ? open + next + rest : all;
    });
  let out = '';
  let last = 0;
  for (const m of content.matchAll(/```[\s\S]*?```|`[^`\n]*`/g)) {
    out += fix(content.slice(last, m.index)) + m[0];
    last = m.index + m[0].length;
  }
  return out + fix(content.slice(last));
}

export function buildLinkGraph(docs) {
  const resolveLink = makeResolver(docs);
  const resolved = {};
  const unresolved = {};
  for (const d of docs) {
    for (const lp of extractLinks(d.content)) {
      const dest = resolveLink(lp, d.path);
      const bucket = dest ? (resolved[d.path] ??= {}) : (unresolved[d.path] ??= {});
      const key = dest ?? lp;
      bucket[key] = (bucket[key] ?? 0) + 1;
    }
  }
  return { resolved, unresolved, resolveLink };
}

export function backlinks(docs, graph, target) {
  const linked = Object.entries(graph.resolved)
    .filter(([src, dests]) => src !== target && dests[target])
    .map(([path, dests]) => ({ path, count: dests[target] }))
    .sort((a, b) => b.count - a.count || a.path.localeCompare(b.path));

  // Unlinked mentions: the note's name as a whole word, outside code and outside existing links.
  const name = posix.basename(target).replace(/\.md$/i, '');
  const mention = new RegExp(`(?<![\\p{L}\\p{N}_])${escapeRe(name)}(?![\\p{L}\\p{N}_])`, 'iu');
  const linkers = new Set(linked.map((l) => l.path));
  const unlinked = [];
  for (const d of docs) {
    if (d.path === target || linkers.has(d.path)) continue;
    const text = outsideCode(d.content).replace(WIKILINK, '').replace(MDLINK, '');
    const line = text.split('\n').find((l) => mention.test(l));
    if (line) unlinked.push({ path: d.path, snippet: line.trim().slice(0, 160) });
  }
  return { linked, unlinked };
}

async function main(argv) {
  let root = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..', 'notes');
  const args = [];
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--root') root = argv[++i];
    else args.push(argv[i]);
  }
  const [cmd, ...rest] = args;
  if (!(cmd === 'unresolved' || (cmd === 'backlinks' && rest.length))) {
    console.error('usage: node links.mjs backlinks "Note name or path" [--root dir]');
    console.error('       node links.mjs unresolved [--root dir]');
    process.exit(2);
  }
  const docs = await buildIndex(root);
  const graph = buildLinkGraph(docs);
  if (cmd === 'unresolved') {
    for (const [src, dests] of Object.entries(graph.unresolved)) {
      for (const [lp, n] of Object.entries(dests)) console.log(`${src}\t[[${lp}]]\t${n}`);
    }
    return;
  }
  const query = rest.join(' ');
  const target = graph.resolveLink(query, '');
  if (!target) {
    console.error(`no note matches "${query}"`);
    process.exit(1);
  }
  const { linked, unlinked } = backlinks(docs, graph, target);
  console.log(`Linked mentions of ${target}: ${linked.length}`);
  for (const l of linked) console.log(`  ${l.count}\t${l.path}`);
  console.log(`Unlinked mentions: ${unlinked.length}`);
  for (const u of unlinked) console.log(`  ${u.path}\t${u.snippet}`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  main(process.argv.slice(2));
}
