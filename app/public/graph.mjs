// Pure helpers for the graph views: a small force-directed layout and the frontmatter "properties" parser.

// Deterministic pseudo-random so the same vault always settles into the same picture.
function rng(seed) {
  let s = seed >>> 0 || 1;
  return () => {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
    return s / 4294967296;
  };
}

// nodes: [{ id }], edges: [{ source, target }] (ids). Adds x/y/vx/vy to each node and returns { step, run }.
// Defaults tuned on a 17-node vault: about 550px across, no overlapping nodes (spring 80, repulsion 700, gravity 0.1).
export function createLayout(nodes, edges, { spring = 80, repulsion = 700, gravity = 0.1 } = {}) {
  const rand = rng(nodes.length * 7919 + 13);
  const byId = new Map(nodes.map((n) => [n.id, n]));
  nodes.forEach((n, i) => {
    const a = (i / Math.max(1, nodes.length)) * Math.PI * 2;
    const r = 60 + rand() * 40 * Math.sqrt(nodes.length);
    Object.assign(n, { x: Math.cos(a) * r, y: Math.sin(a) * r, vx: 0, vy: 0 });
  });
  const links = edges.map((e) => [byId.get(e.source), byId.get(e.target)]).filter(([a, b]) => a && b && a !== b);

  function step(alpha) {
    for (let i = 0; i < nodes.length; i++) {
      const a = nodes[i];
      for (let j = i + 1; j < nodes.length; j++) {
        const b = nodes[j];
        let dx = a.x - b.x;
        let dy = a.y - b.y;
        let d2 = dx * dx + dy * dy;
        if (d2 < 1) {
          dx = rand() - 0.5;
          dy = rand() - 0.5;
          d2 = dx * dx + dy * dy + 0.01;
        }
        const f = (repulsion / d2) * alpha;
        const d = Math.sqrt(d2);
        a.vx += (dx / d) * f * d;
        a.vy += (dy / d) * f * d;
        b.vx -= (dx / d) * f * d;
        b.vy -= (dy / d) * f * d;
      }
    }
    for (const [a, b] of links) {
      const dx = b.x - a.x;
      const dy = b.y - a.y;
      const d = Math.sqrt(dx * dx + dy * dy) || 1;
      const f = ((d - spring) / d) * 0.1 * Math.max(alpha, 0.05);
      a.vx += dx * f;
      a.vy += dy * f;
      b.vx -= dx * f;
      b.vy -= dy * f;
    }
    for (const n of nodes) {
      n.vx -= n.x * gravity * Math.max(alpha, 0.05);
      n.vy -= n.y * gravity * Math.max(alpha, 0.05);
      n.vx *= 0.6;
      n.vy *= 0.6;
      n.x += Math.max(-40, Math.min(40, n.vx));
      n.y += Math.max(-40, Math.min(40, n.vy));
    }
  }

  function run(iterations = 250) {
    for (let i = 0; i < iterations; i++) step(Math.max(0.02, 1 - i / iterations));
  }
  return { step, run };
}

// Reads the frontmatter block into rows for the properties card. Returns null for anything beyond flat
// `key: value`, `key: [a, b]` and `key:` + `- item` lists, so the caller can show the raw text instead.
export function parseProps(frontmatter) {
  const body = frontmatter.replace(/\r\n?/g, '\n').replace(/^---\n/, '').replace(/\n?---\n?$/, '');
  if (!body.trim()) return [];
  const rows = [];
  for (const line of body.split('\n')) {
    let m;
    if (!line.trim() || /^\s*#/.test(line)) continue;
    if ((m = line.match(/^[ \t]*-[ \t]+(.*)$/))) {
      const last = rows[rows.length - 1];
      if (!last || last.value !== '') return null;
      (last.list ??= []).push(unquote(m[1]));
    } else if ((m = line.match(/^([^\s:#][^:]*):[ \t]*(.*)$/))) {
      const value = m[2].trim();
      const row = { key: m[1].trim(), value };
      if (/^\[.*\]$/.test(value)) {
        row.list = splitList(value.slice(1, -1))
          .map((s) => unquote(s.trim()))
          .filter(Boolean);
        row.value = '';
      } else if (/^[|>{&*!]/.test(value)) {
        return null;
      } else {
        row.value = unquote(value);
      }
      rows.push(row);
    } else {
      return null;
    }
  }
  return rows.filter((r) => r.value !== '' || r.list);
}

// A "double quoted" value is JSON (that is how setProp writes it); a 'single quoted' one is plain.
const unquote = (s) => {
  if (/^".*"$/.test(s)) {
    try {
      return JSON.parse(s);
    } catch {
      return s.slice(1, -1);
    }
  }
  return s.replace(/^'(.*)'$/, '$1');
};

// "a, "b, c", d" → ['a', '"b, c"', 'd']: commas inside quotes do not split.
function splitList(text) {
  const out = [];
  let cur = '';
  let quote = '';
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (quote) {
      cur += c;
      if (c === '\\' && quote === '"' && i + 1 < text.length) cur += text[++i];
      else if (c === quote) quote = '';
    } else if (c === '"' || c === "'") {
      quote = c;
      cur += c;
    } else if (c === ',') {
      out.push(cur);
      cur = '';
    } else cur += c;
  }
  out.push(cur);
  return out;
}

const fmLines = (frontmatter) =>
  frontmatter
    .replace(/\r\n?/g, '\n')
    .replace(/^---\n/, '')
    .replace(/\n?---\n?$/, '')
    .split('\n')
    .filter((l) => l.trim() !== '');

// Where a top-level key starts, and how many lines it takes (a "key:" followed by "- item" or indented lines).
function keySpan(lines, key) {
  const i = lines.findIndex((l) => l.startsWith(`${key}:`));
  if (i < 0) return [-1, 0];
  let n = 1;
  while (i + n < lines.length && /^([ \t]|-[ \t]|-$)/.test(lines[i + n])) n++;
  return [i, n];
}

// A line break, tab or other control character must be quoted: JSON escapes it ("a\nb"), which YAML reads back too.
// Written raw, the second line would be a stray line in the frontmatter and break the whole block.
// Numbers and ISO dates stay plain: a date with a time ("2026-11-16T14:30") has a colon, but YAML (and Obsidian's
// date properties) read it as a date only when it is not in quotes.
const PLAIN = /^-?\d+(\.\d+)?$|^\d{4}-\d{2}-\d{2}([T ]\d{2}:\d{2}(:\d{2})?)?$/;
const needsQuotes = (s) => !PLAIN.test(s) && (s !== s.trim() || /[\u0000-\u001f\u007f]/.test(s) || /[:#"'[\]{},&*!|>%@`]/.test(s) || /^[-?]/.test(s));
const yamlScalar = (s) => (needsQuotes(s) ? JSON.stringify(s) : s);

// Sets one top-level `key: value` in a frontmatter block, creating the block if needed. An empty value (or an empty
// list) removes the key. Lists are written inline ("[a, b]"), booleans as true/false. Values YAML would read as
// syntax (a URL's colon, a leading #, ...) are written as JSON strings.
export function setProp(frontmatter, key, value) {
  const lines = fmLines(frontmatter);
  const [i, n] = keySpan(lines, key);
  let text = null;
  if (Array.isArray(value)) {
    const items = value.map((v) => String(v)).filter((v) => v !== '');
    if (items.length) text = `[${items.map(yamlScalar).join(', ')}]`;
  } else if (typeof value === 'boolean') text = String(value);
  else if (typeof value === 'number') text = Number.isFinite(value) ? String(value) : null;
  else if (value !== '' && value !== null && value !== undefined) text = yamlScalar(String(value));
  if (text === null) {
    if (i >= 0) lines.splice(i, n);
  } else {
    const line = `${key}: ${text}`;
    if (i >= 0) lines.splice(i, n, line);
    else lines.push(line);
  }
  return lines.length ? `---\n${lines.join('\n')}\n---\n` : '';
}

// Renames a top-level key (its value and list lines move with it), or removes it when `to` is ''.
export function renameProp(frontmatter, from, to) {
  const lines = fmLines(frontmatter);
  const [i, n] = keySpan(lines, from);
  if (i < 0) return frontmatter;
  if (to) lines[i] = `${to}:${lines[i].slice(from.length + 1)}`;
  else lines.splice(i, n);
  return lines.length ? `---\n${lines.join('\n')}\n---\n` : '';
}

