// DOM views built on /api/graph data: icons, Overview and the Graph view.
// No inline style attributes anywhere (the page's CSP forbids them); styling is all classes + CSSOM.
import { createLayout } from './graph.mjs';

const SVG = 'http://www.w3.org/2000/svg';

const ICONS = {
  hub: '<circle cx="12" cy="6" r="2.5"/><circle cx="6" cy="17" r="2.5"/><circle cx="18" cy="17" r="2.5"/><path d="M10.8 8.2 7.2 14.8M13.2 8.2l3.6 6.6M8.5 17h7"/>',
  overview: '<rect x="3" y="3" width="7" height="7" rx="1.5"/><rect x="14" y="3" width="7" height="7" rx="1.5"/><rect x="14" y="14" width="7" height="7" rx="1.5"/><rect x="3" y="14" width="7" height="7" rx="1.5"/>',
  graph: '<circle cx="6" cy="6" r="3"/><circle cx="18" cy="18" r="3"/><circle cx="18" cy="6" r="3"/><path d="M8.6 8.6l6.8 6.8M15.4 8.6l-6.8 6.8"/>',
  search: '<circle cx="11" cy="11" r="7"/><path d="m21 21-4.35-4.35"/>',
  plus: '<path d="M12 5v14M5 12h14"/>',
  minus: '<path d="M5 12h14"/>',
  close: '<path d="M6 6l12 12M18 6 6 18"/>',
  menu: '<path d="M4 7h16M4 12h16M4 17h16"/>',
  center: '<circle cx="12" cy="12" r="3"/><path d="M3 8V5a2 2 0 0 1 2-2h3M16 3h3a2 2 0 0 1 2 2v3M21 16v3a2 2 0 0 1-2 2h-3M8 21H5a2 2 0 0 1-2-2v-3"/>',
  link: '<path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71"/><path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"/>',
  file: '<path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><path d="M14 2v6h6"/>',
  alert: '<circle cx="12" cy="12" r="9"/><path d="M12 8v4.5M12 16h.01"/>',
  unlink: '<circle cx="12" cy="12" r="9"/><path d="M8 8l8 8"/>',
  tag: '<path d="M20.6 13.4l-7.2 7.2a2 2 0 0 1-2.8 0L3 13V3h10l7.6 7.6a2 2 0 0 1 0 2.8z"/><circle cx="7.5" cy="7.5" r="1"/>',
  folder: '<path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/><path d="M12 11v5M9.5 13.5h5"/>',
  sidebar: '<rect x="3" y="4" width="18" height="16" rx="2"/><path d="M9 4v16"/>',
  text: '<path d="M4 6h16M12 6v13M9 19h6"/>',
  heading: '<path d="M6 4v16M18 4v16M6 12h12"/>',
  check: '<rect x="3.5" y="3.5" width="17" height="17" rx="3"/><path d="M8 12l3 3 5-6"/>',
  list: '<path d="M9 6h11M9 12h11M9 18h11"/><circle cx="4.5" cy="6" r="1"/><circle cx="4.5" cy="12" r="1"/><circle cx="4.5" cy="18" r="1"/>',
  numbered: '<path d="M10 6h10M10 12h10M10 18h10M4 5l1.5-1v5M4 14.5a1.5 1.5 0 0 1 3 0c0 1.5-3 3-3 4.5h3"/>',
  quote: '<path d="M7 17h-2v-5a4 4 0 0 1 4-4M19 17h-2v-5a4 4 0 0 1 4-4"/>',
  code: '<path d="M8 8l-4 4 4 4M16 8l4 4-4 4M14 5l-4 14"/>',
  divider: '<path d="M4 12h16"/>',
  table: '<rect x="3" y="4" width="18" height="16" rx="2"/><path d="M3 10h18M3 15h18M9 4v16"/>',
  image: '<rect x="3" y="4" width="18" height="16" rx="2"/><circle cx="9" cy="10" r="2"/><path d="M21 16l-5-5-8 8"/>',
  video: '<rect x="3" y="5" width="13" height="14" rx="2"/><path d="M16 10l5-3v10l-5-3"/>',
  audio: '<path d="M9 18V6l10-2v12"/><circle cx="6.5" cy="18" r="2.5"/><circle cx="16.5" cy="16" r="2.5"/>',
  bookmark: '<path d="M6 3h12v18l-6-4-6 4z"/>',
  globe: '<circle cx="12" cy="12" r="9"/><path d="M3 12h18M12 3a14 14 0 0 1 0 18M12 3a14 14 0 0 0 0 18"/>',
  button: '<rect x="3" y="8" width="18" height="8" rx="4"/><path d="M9 12h6"/>',
  database: '<ellipse cx="12" cy="5" rx="8" ry="3"/><path d="M4 5v14c0 1.7 3.6 3 8 3s8-1.3 8-3V5M4 12c0 1.7 3.6 3 8 3s8-1.3 8-3"/>',
  grid: '<rect x="3" y="3" width="8" height="8" rx="1.5"/><rect x="13" y="3" width="8" height="8" rx="1.5"/><rect x="3" y="13" width="8" height="8" rx="1.5"/><rect x="13" y="13" width="8" height="8" rx="1.5"/>',
  board: '<rect x="3" y="4" width="5" height="16" rx="1.5"/><rect x="10" y="4" width="5" height="10" rx="1.5"/><rect x="17" y="4" width="4" height="13" rx="1.5"/>',
  hash: '<path d="M5 9h15M4 15h15M10 4l-2 16M16 4l-2 16"/>',
  donut: '<path d="M12 3a9 9 0 1 0 9 9"/><path d="M12 3v9h9"/>',
  subpages: '<path d="M4 6h10M9 12h11M9 18h11"/><path d="M4 6l-2 2 2 2"/>',
  smile: '<circle cx="12" cy="12" r="9"/><path d="M8.5 14.5a4.5 4.5 0 0 0 7 0M9 9.5h.01M15 9.5h.01"/>',
  columns: '<rect x="3" y="4" width="8" height="16" rx="1.5"/><rect x="13" y="4" width="8" height="16" rx="1.5"/>',
  expand: '<path d="M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5"/>',
  settings: '<circle cx="12" cy="12" r="3"/><path d="M12 2v3M12 19v3M4.2 4.2l2.1 2.1M17.7 17.7l2.1 2.1M2 12h3M19 12h3M4.2 19.8l2.1-2.1M17.7 6.3l2.1-2.1"/>',
  trash: '<path d="M4 7h16M9 7V4h6v3M6 7l1 13h10l1-13"/>',
  copy: '<rect x="8" y="8" width="12" height="12" rx="2"/><path d="M16 8V6a2 2 0 0 0-2-2H6a2 2 0 0 0-2 2v8a2 2 0 0 0 2 2h2"/>',
  // database property types
  select: '<circle cx="12" cy="12" r="9"/><path d="M8.5 10.5 12 14l3.5-3.5"/>',
  status: '<path d="M12 3v3M12 18v3M3 12h3M18 12h3M5.6 5.6l2.1 2.1M16.3 16.3l2.1 2.1M5.6 18.4l2.1-2.1M16.3 7.7l2.1-2.1"/>',
  calendar: '<rect x="3.5" y="5" width="17" height="15.5" rx="2"/><path d="M3.5 10h17M8 3v4M16 3v4"/>',
  at: '<circle cx="12" cy="12" r="4"/><path d="M16 8v5a3 3 0 0 0 6 0v-1a10 10 0 1 0-4 8"/>',
  phone: '<path d="M5 4h4l2 5-2.5 1.5a11 11 0 0 0 5 5L15 13l5 2v4a2 2 0 0 1-2 2A16 16 0 0 1 3 6a2 2 0 0 1 2-2"/>',
  sigma: '<path d="M18 5H6l6 7-6 7h12"/>',
  relation: '<path d="M7 17 17 7M8 7h9v9"/>',
  rollup: '<circle cx="10.5" cy="10.5" r="6.5"/><path d="m20 20-4.5-4.5M8 10.5h5M10.5 8v5"/>',
  clock: '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>',
};

export function icon(name, size = 16) {
  const s = document.createElementNS(SVG, 'svg');
  for (const [k, v] of Object.entries({ viewBox: '0 0 24 24', width: size, height: size, fill: 'none', stroke: 'currentColor', 'stroke-width': 1.8, 'stroke-linecap': 'round', 'stroke-linejoin': 'round', 'aria-hidden': 'true' })) {
    s.setAttribute(k, v);
  }
  s.innerHTML = ICONS[name] ?? ''; // static markup from ICONS above, never note content
  return s;
}

const el = (tag, className = '', text = '') => {
  const n = document.createElement(tag);
  if (className) n.className = className;
  if (text) n.textContent = text;
  return n;
};
const svgEl = (tag, attrs = {}, className = '') => {
  const n = document.createElementNS(SVG, tag);
  for (const [k, v] of Object.entries(attrs)) n.setAttribute(k, v);
  if (className) n.setAttribute('class', className);
  return n;
};
const button = (className, label, onClick) => {
  const b = el('button', className, label);
  b.type = 'button';
  b.addEventListener('click', onClick);
  return b;
};
const clip = (s, n) => (s.length > n ? `${s.slice(0, n - 1)}…` : s);
const folderOf = (p) => (p.includes('/') ? p.slice(0, p.lastIndexOf('/')) : 'root');

export function ago(ms, now = Date.now()) {
  const s = Math.max(0, (now - ms) / 1000);
  if (s < 60) return 'just now';
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
  if (s < 604800) return `${Math.floor(s / 86400)}d ago`;
  return new Date(ms).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: now - ms > 31536e6 ? 'numeric' : undefined });
}

export const fmtSize = (b) => (b < 1024 ? `${b} B` : `${(b / 1024).toFixed(1)} KB`);

// ---------------------------------------------------------------- Overview

let overviewFilter = 'all';

function metric(iconName, label, value, note, tone = '') {
  const card = el('div', `glass metric ${tone}`);
  const head = el('div', 'metric-head');
  const tile = el('span', 'tile');
  tile.append(icon(iconName, 16));
  head.append(el('span', 'metric-label', label), tile);
  const row = el('div', 'metric-row');
  row.append(el('span', 'metric-value', String(value)), el('span', 'metric-note', note));
  card.append(head, row);
  return card;
}

function noteCard(n, h) {
  const card = button('glass note-card', '', () => h.go(n.path));
  const top = el('div', 'nc-top');
  top.append(el('span', 'pill mono', folderOf(n.path)), el('span', 'nc-time mono', ago(n.mtime)));
  const foot = el('div', 'nc-foot');
  const links = el('span', 'nc-links');
  links.append(el('span', 'dot'), document.createTextNode(`${n.inCount} backlink${n.inCount === 1 ? '' : 's'}`));
  foot.append(links, ...n.tags.slice(0, 2).map((t) => el('span', 'tag-chip static mono', `#${t}`)));
  card.append(top, el('h3', 'nc-title', n.name), el('p', n.snippet ? 'nc-snippet' : 'nc-snippet muted', n.snippet || 'Empty note'), foot);
  return card;
}

function attentionList(title, count, rows, emptyText) {
  const box = el('div', 'glass attention');
  const head = el('div', 'attention-head');
  head.append(el('span', 'eyebrow mono', title), el('span', 'count mono', String(count)));
  box.append(head);
  if (!rows.length) box.append(el('p', 'muted small', emptyText));
  for (const r of rows) box.append(r);
  return box;
}

export function renderOverview(root, data, h) {
  root.replaceChildren();
  if (!data) return;
  const { nodes, edges, unresolved } = data;
  if (!nodes.length) {
    const empty = el('div', 'overview empty-state');
    empty.append(el('h1', 'display', 'Your vault is empty'), el('p', 'sub', 'Create a page, or point the app at a folder of Markdown notes.'), button('btn primary', 'Create first page', () => h.create()));
    root.append(empty);
    return;
  }
  const orphans = nodes.filter((n) => n.inCount + n.outCount === 0);
  const weekAgo = Date.now() - 7 * 864e5;
  const thisWeek = nodes.filter((n) => n.mtime > weekAgo).length;
  const linkTotal = edges.reduce((s, e) => s + e.count, 0);
  const ghosts = new Map();
  for (const u of unresolved) ghosts.set(u.link.toLowerCase(), { link: u.link, from: [...(ghosts.get(u.link.toLowerCase())?.from ?? []), u.from] });

  const wrap = el('div', 'overview');
  const head = el('div', 'ov-head');
  const title = el('div');
  title.append(el('p', 'eyebrow mono', 'Overview'), el('h1', 'display', 'Your vault'), el('p', 'sub', `${nodes.length} notes · ${linkTotal} links · ${orphans.length} without connections`));
  const seg = el('div', 'seg');
  seg.setAttribute('role', 'group');
  seg.setAttribute('aria-label', 'Filter notes');
  const filters = [
    ['all', 'All'],
    ['recent', 'Recent'],
    ['orphans', `Orphans${orphans.length ? ` ${orphans.length}` : ''}`],
  ];
  head.append(title, seg);

  const metrics = el('div', 'metrics');
  metrics.append(
    metric('file', 'Notes', nodes.length, `${thisWeek} edited this week`, 'amber'),
    metric('link', 'Links', linkTotal, 'between notes'),
    metric('unlink', 'Orphans', orphans.length, 'no links in or out'),
    metric('alert', 'Unresolved', ghosts.size, 'links to missing notes', ghosts.size ? 'crimson' : ''),
  );

  const section = el('section', 'ov-section');
  const sectionHead = el('div', 'section-title');
  const shown = el('span', 'mono small muted');
  const grid = el('div', 'cards');
  const paint = () => {
    seg.replaceChildren(
      ...filters.map(([key, label]) => {
        const b = button(key === overviewFilter ? 'seg-btn active' : 'seg-btn', label, () => {
          overviewFilter = key;
          paint();
        });
        b.setAttribute('aria-pressed', String(key === overviewFilter));
        return b;
      }),
    );
    const pool = overviewFilter === 'orphans' ? orphans : overviewFilter === 'recent' ? nodes.filter((n) => n.mtime > weekAgo) : nodes;
    const list = [...pool].sort((a, b) => b.mtime - a.mtime).slice(0, 12);
    shown.textContent = `${list.length} of ${pool.length}`;
    grid.replaceChildren(...list.map((n) => noteCard(n, h)));
    if (!list.length) grid.append(el('p', 'muted', overviewFilter === 'orphans' ? 'Every note has a connection.' : 'Nothing edited in the last 7 days.'));
  };
  sectionHead.append(el('h2', 'section-h', overviewFilter === 'orphans' ? 'Orphans' : 'Recent notes'), shown);
  paint();
  section.append(sectionHead, grid);

  const orphanRows = orphans.slice(0, 6).map((n) => {
    const row = button('list-row', '', () => h.go(n.path));
    row.append(el('span', 'list-main', n.name), el('span', 'list-sub mono', folderOf(n.path)));
    return row;
  });
  const ghostRows = [...ghosts.values()].slice(0, 6).map((g) => {
    const row = el('div', 'list-row static');
    const label = el('span', 'list-main mono', `[[${g.link}]]`);
    const from = el('span', 'list-sub', `from ${[...new Set(g.from)].map((p) => p.replace(/\.md$/, '').split('/').pop()).slice(0, 2).join(', ')}`);
    row.append(label, from, button('btn mini', 'Create', () => h.create(g.link)));
    return row;
  });
  const attention = el('section', 'ov-two');
  attention.append(attentionList('Orphans', orphans.length, orphanRows, 'Every note is connected.'), attentionList('Unresolved links', ghosts.size, ghostRows, 'No broken links.'));

  wrap.append(head, metrics, section, attention);
  root.append(wrap);
}

// ---------------------------------------------------------------- Graph view

function graphModel(data) {
  const notes = data.nodes.map((n) => ({ id: n.path, kind: 'note', label: n.name, note: n, deg: n.inCount + n.outCount }));
  const ghostByKey = new Map();
  const edges = data.edges.map((e) => ({ source: e.from, target: e.to, ghost: false }));
  for (const u of data.unresolved) {
    const key = `?${u.link.toLowerCase()}`;
    if (!ghostByKey.has(key)) ghostByKey.set(key, { id: key, kind: 'ghost', label: u.link, deg: 0, from: [] });
    const g = ghostByKey.get(key);
    g.deg++;
    g.from.push(u.from);
    edges.push({ source: u.from, target: key, ghost: true });
  }
  const nodes = [...notes, ...ghostByKey.values()];
  for (const n of nodes) n.r = Math.min(16, 5 + Math.sqrt(n.deg) * 2.6);
  return { nodes, edges };
}

const kindOf = (n) => (n.kind === 'ghost' ? 'ghost' : n.deg === 0 ? 'orphan' : n.deg >= 4 ? 'hub' : 'note');

export function renderGraphView(root, data, h) {
  root.replaceChildren();
  if (!data || !data.nodes.length) {
    root.append(el('p', 'muted graph-empty', 'Nothing to draw yet: create a few pages and link them with [[ ]].'));
    return;
  }
  const { nodes, edges } = graphModel(data);
  createLayout(nodes, edges).run(nodes.length > 600 ? 80 : 240);
  const byId = new Map(nodes.map((n) => [n.id, n]));

  const box = root.getBoundingClientRect();
  const W = Math.max(600, Math.round(box.width));
  const H = Math.max(400, Math.round(box.height));
  const view = { x: W / 2, y: H / 2, k: 1 };

  const svg = svgEl('svg', { viewBox: `0 0 ${W} ${H}`, role: 'group', 'aria-label': 'Note graph' }, 'graph-svg');
  const defs = svgEl('defs');
  const glow = svgEl('filter', { id: 'glow-g', x: '-60%', y: '-60%', width: '220%', height: '220%' });
  glow.append(svgEl('feGaussianBlur', { stdDeviation: 5, result: 'b' }));
  const merge = svgEl('feMerge');
  merge.append(svgEl('feMergeNode', { in: 'b' }), svgEl('feMergeNode', { in: 'SourceGraphic' }));
  glow.append(merge);
  defs.append(glow);
  const viewport = svgEl('g');
  const edgeLayer = svgEl('g');
  const nodeLayer = svgEl('g');
  viewport.append(edgeLayer, nodeLayer);
  svg.append(defs, viewport);

  const apply = () => {
    viewport.setAttribute('transform', `translate(${view.x} ${view.y}) scale(${view.k})`);
    svg.classList.toggle('show-labels', view.k > 1.25);
  };
  const fit = () => {
    let x0 = Infinity, x1 = -Infinity, y0 = Infinity, y1 = -Infinity;
    for (const n of nodes) {
      x0 = Math.min(x0, n.x - n.r - 40);
      x1 = Math.max(x1, n.x + n.r + 40);
      y0 = Math.min(y0, n.y - n.r - 30);
      y1 = Math.max(y1, n.y + n.r + 30);
    }
    view.k = Math.min(1.15, Math.min(W / (x1 - x0), (H - 60) / (y1 - y0)));
    view.x = W / 2 - ((x0 + x1) / 2) * view.k;
    view.y = (H - 40) / 2 - ((y0 + y1) / 2) * view.k;
    apply();
  };

  const edgeEls = edges.map((e) => {
    const a = byId.get(e.source);
    const b = byId.get(e.target);
    const line = svgEl('line', { x1: a.x, y1: a.y, x2: b.x, y2: b.y }, e.ghost ? 'edge ghost' : 'edge');
    edgeLayer.append(line);
    return { e, line };
  });

  let selected = null;
  const tip = el('div', 'glass graph-tip');
  tip.hidden = true;
  const inspector = el('aside', 'glass graph-inspector');
  inspector.hidden = true;
  let moved = false;

  const nodeEls = new Map();
  for (const n of nodes) {
    const g = svgEl('g', { transform: `translate(${n.x} ${n.y})`, tabindex: 0, role: 'button', 'aria-label': `${n.label}, ${n.deg} connection${n.deg === 1 ? '' : 's'}` }, `node ${kindOf(n)}`);
    g.append(svgEl('circle', { r: n.r + 5 }, 'halo'), svgEl('circle', { r: n.r }, 'body'), svgEl('circle', { r: Math.max(2.5, n.r * 0.35) }, 'core'));
    const label = svgEl('text', { y: n.r + 14, 'text-anchor': 'middle' }, 'label');
    label.textContent = clip(n.label, 24);
    g.append(label);
    g.addEventListener('click', () => {
      if (!moved) select(n);
    });
    g.addEventListener('keydown', (ev) => {
      if (ev.key === 'Enter' || ev.key === ' ') {
        ev.preventDefault();
        select(n);
      }
    });
    g.addEventListener('pointerenter', () => {
      const r = g.getBoundingClientRect();
      const b = root.getBoundingClientRect();
      tip.replaceChildren(el('strong', '', n.label), el('span', 'mono small muted', n.kind === 'ghost' ? `Missing note · linked from ${n.deg}` : `${n.note.inCount} backlinks · ${n.note.outCount} outgoing · ${ago(n.note.mtime)}`));
      tip.style.left = `${r.left - b.left + r.width / 2}px`;
      tip.style.top = `${r.top - b.top - 8}px`;
      tip.hidden = false;
    });
    g.addEventListener('pointerleave', () => {
      tip.hidden = true;
    });
    nodeLayer.append(g);
    nodeEls.set(n.id, g);
  }

  const neighbours = (n) => {
    const out = [];
    for (const e of edges) {
      if (e.source === n.id) out.push(byId.get(e.target));
      else if (e.target === n.id) out.push(byId.get(e.source));
    }
    return [...new Set(out)];
  };

  function select(n) {
    selected = n;
    const near = new Set(neighbours(n).map((x) => x.id));
    near.add(n.id);
    for (const [id, g] of nodeEls) {
      g.classList.toggle('selected', id === n.id);
      g.classList.toggle('faded', !near.has(id));
    }
    for (const { e, line } of edgeEls) {
      const hot = e.source === n.id || e.target === n.id;
      line.classList.toggle('hot', hot);
      line.classList.toggle('faded', !hot);
    }
    showInspector(n);
  }
  function clearSelection() {
    selected = null;
    inspector.hidden = true;
    for (const g of nodeEls.values()) g.classList.remove('selected', 'faded');
    for (const { line } of edgeEls) line.classList.remove('hot', 'faded');
  }

  function showInspector(n) {
    const note = n.note;
    const head = el('div', 'gi-head');
    head.append(el('span', 'eyebrow mono', 'Node inspector'), button('icon-btn', '', clearSelection));
    head.lastChild.append(icon('close', 15));
    head.lastChild.setAttribute('aria-label', 'Close inspector');
    const chips = el('div', 'chips');
    chips.append(el('span', `pill mono ${kindOf(n)}`, { hub: 'Hub', note: 'Note', orphan: 'Orphan', ghost: 'Missing note' }[kindOf(n)]));
    for (const t of (note?.tags ?? []).slice(0, 3)) chips.append(el('span', 'tag-chip static mono', `#${t}`));
    const body = el('div', 'gi-body');
    body.append(chips, el('h2', 'gi-title', n.label));
    if (note) {
      body.append(el('p', 'small muted', `Updated ${ago(note.mtime)} · ${fmtSize(note.size)} · ${folderOf(note.path)}`));
      if (note.snippet) body.append(el('p', 'gi-excerpt', note.snippet));
      const m = el('div', 'gi-metrics');
      for (const [k, v] of [['Backlinks', note.inCount], ['Outgoing', note.outCount], ['Tags', note.tags.length]]) {
        const c = el('div', 'gi-metric');
        c.append(el('span', 'mono small muted', k), el('span', 'gi-num', String(v)));
        m.append(c);
      }
      body.append(m);
    } else {
      body.append(el('p', 'small muted', `Linked from ${[...new Set(n.from)].length} note(s) but no page with this name exists.`));
    }
    const near = neighbours(n);
    if (near.length) {
      const list = el('div', 'gi-list');
      list.append(el('span', 'eyebrow mono', `Connected (${near.length})`));
      for (const x of near.slice(0, 8)) list.append(button('list-row', x.label, () => select(x)));
      body.append(list);
    }
    const actions = el('div', 'gi-actions');
    actions.append(n.kind === 'ghost' ? button('btn primary wide', 'Create page', () => h.create(n.label)) : button('btn primary wide', 'Open in editor', () => h.go(n.note.path)));
    inspector.replaceChildren(head, body, actions);
    inspector.hidden = false;
  }

  // pan, zoom
  let drag = null;
  svg.addEventListener('pointerdown', (ev) => {
    if (ev.button !== 0) return;
    drag = { x: ev.clientX, y: ev.clientY, vx: view.x, vy: view.y };
    moved = false;
  });
  svg.addEventListener('pointermove', (ev) => {
    if (!drag) return;
    const dx = ev.clientX - drag.x;
    const dy = ev.clientY - drag.y;
    if (!moved && Math.hypot(dx, dy) < 4) return;
    moved = true;
    tip.hidden = true;
    view.x = drag.vx + dx;
    view.y = drag.vy + dy;
    apply();
  });
  const endDrag = () => {
    drag = null;
    setTimeout(() => (moved = false), 0);
  };
  svg.addEventListener('pointerup', endDrag);
  svg.addEventListener('pointerleave', endDrag);
  svg.addEventListener('click', (ev) => {
    if (ev.target === svg && !moved) clearSelection();
  });
  const zoomAt = (cx, cy, factor) => {
    const k = Math.min(4, Math.max(0.2, view.k * factor));
    const pt = svg.createSVGPoint();
    pt.x = cx;
    pt.y = cy;
    const p = pt.matrixTransform(svg.getScreenCTM().inverse());
    view.x = p.x - (p.x - view.x) * (k / view.k);
    view.y = p.y - (p.y - view.y) * (k / view.k);
    view.k = k;
    apply();
  };
  svg.addEventListener('wheel', (ev) => {
    ev.preventDefault();
    zoomAt(ev.clientX, ev.clientY, ev.deltaY < 0 ? 1.12 : 1 / 1.12);
  }, { passive: false });

  // controls
  const bar = el('div', 'glass graph-bar');
  const filter = el('input', 'graph-filter');
  filter.type = 'search';
  filter.placeholder = 'Filter nodes in view…';
  filter.setAttribute('aria-label', 'Filter nodes');
  filter.addEventListener('input', () => {
    const q = filter.value.trim().toLowerCase();
    for (const n of nodes) nodeEls.get(n.id).classList.toggle('dim', !!q && !n.label.toLowerCase().includes(q));
    for (const { e, line } of edgeEls) {
      const hit = (id) => !q || byId.get(id).label.toLowerCase().includes(q);
      line.classList.toggle('dim', !!q && !(hit(e.source) && hit(e.target)));
    }
  });
  const toggle = (label, cls) => {
    const b = button('chip-toggle active', label, () => {
      const hidden = svg.classList.toggle(cls);
      b.classList.toggle('active', !hidden);
      b.setAttribute('aria-pressed', String(!hidden));
    });
    b.setAttribute('aria-pressed', 'true');
    return b;
  };
  bar.append(icon('search', 15), filter, toggle('Orphans', 'hide-orphans'), toggle('Unresolved', 'hide-ghosts'));

  // zoomAt works in screen coordinates, so zoom about the middle of the drawn svg
  const centreZoom = (factor) => {
    const r = svg.getBoundingClientRect();
    zoomAt(r.left + r.width / 2, r.top + r.height / 2, factor);
  };
  const zoom = el('div', 'glass graph-zoom');
  for (const [name, label, fn] of [
    ['plus', 'Zoom in', () => centreZoom(1.25)],
    ['minus', 'Zoom out', () => centreZoom(1 / 1.25)],
    ['center', 'Fit graph', fit],
  ]) {
    const b = button('icon-btn', '', fn);
    b.append(icon(name, 17));
    b.setAttribute('aria-label', label);
    b.title = label;
    zoom.append(b);
  }

  const realEdges = edges.filter((e) => !e.ghost).length;
  const foot = el('footer', 'graph-foot mono');
  const stat = (n, label) => {
    const s = el('span');
    s.append(el('b', '', String(n)), document.createTextNode(` ${label}`));
    return s;
  };
  const legend = el('span', 'legend');
  for (const [cls, label] of [['hub', 'Hubs'], ['note', 'Notes'], ['orphan', 'Orphans'], ['ghost', 'Missing']]) {
    const item = el('span', 'legend-item');
    item.append(el('i', `swatch ${cls}`), document.createTextNode(label));
    legend.append(item);
  }
  const noteCount = data.nodes.length;
  const density = noteCount > 1 ? (2 * realEdges) / (noteCount * (noteCount - 1)) : 0;
  foot.append(stat(noteCount, 'notes'), stat(realEdges, 'connections'), stat(density.toFixed(2), 'density'), legend);

  root.append(svg, bar, zoom, tip, inspector, foot);
  fit();
}
