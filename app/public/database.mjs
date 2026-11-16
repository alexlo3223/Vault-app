// Database blocks: a folder of notes shown through one or more views. Pure logic (no DOM), shared by the
// browser and the tests. A block without `---` lines is one view, so databases written before views still work.
//
//   source: Book Library/Books
//   name: Reading
//   view: gallery
//   filter: status = reading
//   sort: pages desc
//   ---
//   name: Totals
//   view: number
//   value: pages
//   agg: sum

export const VIEW_TYPES = ['table', 'board', 'gallery', 'list', 'number', 'donut'];
export const AGGS = ['count', 'sum', 'avg', 'min', 'max'];
export const OPS = ['!=', '>=', '<=', '=', '>', '<', 'contains', '!empty', 'empty'];

const VIEW_KEYS = new Set(['name', 'view', 'show', 'filter', 'sort', 'group', 'value', 'agg', 'preview', 'size', 'fit']);
const LINE = /^\s*([a-z]+)\s*:\s*(.*?)\s*$/i;
const FILTER = new RegExp(`^(.*?)\\s+(${OPS.join('|')})(?:\\s+(.*))?$`);

export const newView = (view = 'table') => ({ name: '', view, show: [], filter: [], sort: '', group: '', value: '', agg: '', preview: '', size: '', fit: '' });

// Reads the block text into { source, views }. Unknown keys are ignored; a bad view type falls back to a table.
export function parseDb(text = '') {
  const cfg = { source: '', views: [] };
  let cur = null;
  for (const line of text.replace(/\r\n?/g, '\n').split('\n')) {
    if (line.trim() === '---') {
      cur = null;
      continue;
    }
    const m = line.match(LINE);
    if (!m) continue;
    const [, key, value] = m;
    if (key === 'source') {
      cfg.source = value;
      continue;
    }
    // An embed shows a database page: `page` is that page (its path without .md), `use` the view name to start on.
    if (key === 'page' || key === 'use') {
      cfg[key] = value;
      continue;
    }
    if (!VIEW_KEYS.has(key)) continue;
    if (!cur) cfg.views.push((cur = newView()));
    if (key === 'view') cur.view = VIEW_TYPES.includes(value) ? value : 'table';
    else if (key === 'show') cur.show = value.split(',').map((s) => s.trim()).filter(Boolean);
    else if (key === 'filter') {
      const f = parseFilter(value);
      if (f) cur.filter.push(f);
    } else if (key === 'agg') cur[key] = AGGS.includes(value) ? value : '';
    else cur[key] = value;
  }
  if (!cfg.views.length) cfg.views.push(newView());
  return cfg;
}

// The text of the first database block in a note (``` or ~~~ fence, info "database"), or null when there is none.
export function extractDatabase(markdown = '') {
  const m = markdown.replace(/\r\n?/g, '\n').match(/^(`{3,}|~{3,})database[ \t]*\n([\s\S]*?)\n\1[ \t]*$/m);
  return m ? m[2] : null;
}

// "status = reading" -> { key, op, value }. Returns null when no operator is found.
export function parseFilter(text) {
  const m = text.trim().match(FILTER);
  return m ? { key: m[1].trim(), op: m[2], value: (m[3] ?? '').trim() } : null;
}

export const formatFilter = ({ key, op, value }) => (value ? `${key} ${op} ${value}` : `${key} ${op}`);

// Writes the block text back. Only keys that have a value are written, so the text stays short.
export function serializeDb(cfg) {
  const out = [];
  if (cfg.page) return [`page: ${cfg.page}`, cfg.use ? `use: ${cfg.use}` : ''].filter(Boolean).join('\n');
  if (cfg.source) out.push(`source: ${cfg.source}`);
  cfg.views.forEach((v, i) => {
    if (i > 0) out.push('---');
    if (v.name) out.push(`name: ${v.name}`);
    out.push(`view: ${v.view}`);
    if (v.show.length) out.push(`show: ${v.show.join(', ')}`);
    for (const f of v.filter) out.push(`filter: ${formatFilter(f)}`);
    for (const k of ['sort', 'group', 'value', 'agg', 'preview', 'size', 'fit']) if (v[k]) out.push(`${k}: ${v[k]}`);
  });
  return out.join('\n');
}

// A property as text: lists are joined, missing values are empty.
export const cellValue = (v) => (Array.isArray(v) ? v.join(', ') : (v ?? '')).toString();
const num = (v) => (cellValue(v).trim() !== '' && Number.isFinite(Number(cellValue(v))) ? Number(cellValue(v)) : null);

export function filterRows(rows, filters) {
  return filters.reduce((list, { key, op, value }) => {
    const want = value.toLowerCase();
    return list.filter((r) => {
      const raw = cellValue(r.props[key]);
      const have = raw.toLowerCase();
      if (op === 'empty') return raw === '';
      if (op === '!empty') return raw !== '';
      if (op === '=') return have === want;
      if (op === '!=') return have !== want;
      if (op === 'contains') return have.includes(want);
      const a = num(r.props[key]);
      const b = Number(value);
      if (a !== null && Number.isFinite(b)) return op === '>' ? a > b : op === '<' ? a < b : op === '>=' ? a >= b : a <= b;
      return op === '>' ? have > want : op === '<' ? have < want : op === '>=' ? have >= want : have <= want;
    });
  }, rows);
}

// sort: "pages desc" or "name" (ascending). Numbers compare as numbers.
export function sortRows(rows, sort) {
  if (!sort) return rows;
  const [key, dir] = sort.split(/\s+/);
  const sign = dir === 'desc' ? -1 : 1;
  const value = (r) => (key === 'name' ? r.name : r.props[key]);
  return [...rows].sort((x, y) => {
    const a = num(value(x));
    const b = num(value(y));
    if (a !== null && b !== null) return sign * (a - b);
    return sign * cellValue(value(x)).localeCompare(cellValue(value(y)), undefined, { numeric: true, sensitivity: 'base' });
  });
}

// One number for a whole view: count of notes, or sum/avg/min/max of a numeric property.
export function aggregate(rows, key, agg = 'count') {
  if (agg === 'count' || !key) return rows.length;
  const values = rows.map((r) => num(r.props[key])).filter((n) => n !== null);
  if (!values.length) return 0;
  if (agg === 'sum') return values.reduce((s, n) => s + n, 0);
  if (agg === 'avg') return values.reduce((s, n) => s + n, 0) / values.length;
  if (agg === 'min') return Math.min(...values);
  return Math.max(...values);
}

// Groups notes by a property. Notes without the property go to ''. Keeps first-seen order.
export function groupRows(rows, key) {
  const groups = new Map();
  for (const r of rows) {
    const k = key ? cellValue(r.props[key]) : '';
    if (!groups.has(k)) groups.set(k, []);
    groups.get(k).push(r);
  }
  return groups;
}
