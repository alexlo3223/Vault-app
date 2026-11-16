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
        row.list = value
          .slice(1, -1)
          .split(',')
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

const unquote = (s) => s.replace(/^(["'])(.*)\1$/, '$2');

// Sets one top-level `key: value` in a frontmatter block, creating the block if needed. An empty value removes
// the key. Values YAML would read as syntax (a URL's colon, a leading #, ...) are written as JSON strings.
export function setProp(frontmatter, key, value) {
  const lines = frontmatter
    .replace(/\r\n?/g, '\n')
    .replace(/^---\n/, '')
    .replace(/\n?---\n?$/, '')
    .split('\n')
    .filter((l) => l.trim() !== '');
  const i = lines.findIndex((l) => l.startsWith(`${key}:`));
  const needsQuotes = value !== value.trim() || /[:#"'[\]{},&*!|>%@`]/.test(value);
  if (value === '') {
    if (i >= 0) lines.splice(i, 1);
  } else {
    const line = `${key}: ${needsQuotes ? JSON.stringify(value) : value}`;
    if (i >= 0) lines[i] = line;
    else lines.push(line);
  }
  return lines.length ? `---\n${lines.join('\n')}\n---\n` : '';
}

