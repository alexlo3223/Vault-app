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

import { COLORS, TYPE, newProp } from './properties.mjs';
import { renameInFormula } from './formula.mjs';

export const VIEW_TYPES = ['table', 'board', 'gallery', 'list', 'number', 'donut'];
export const AGGS = ['count', 'sum', 'avg', 'min', 'max'];
export const OPS = ['!=', '>=', '<=', '=', '>', '<', 'contains', '!empty', 'empty'];

const VIEW_KEYS = new Set(['name', 'view', 'show', 'filter', 'sort', 'group', 'value', 'agg', 'preview', 'size', 'fit']);
const LINE = /^\s*([a-z]+)\s*:\s*(.*?)\s*$/i;
const FILTER = new RegExp(`^(.*?)\\s+(${OPS.join('|')})(?:\\s+(.*))?$`);

export const newView = (view = 'table') => ({ name: '', view, show: [], filter: [], sort: '', group: '', value: '', agg: '', preview: '', size: '', fit: '' });

// Property schema (see properties.mjs): "prop: Name" starts a property, the keys below configure it. These keys never
// appear in a view, so a line always belongs to one or the other.
const PROP_KEYS = new Set(['type', 'options', 'formula', 'format', 'decimals', 'display', 'color', 'max', 'numbers', 'relation', 'rollup', 'target', 'calc']);
const PROP_ORDER = ['type', 'options', 'formula', 'format', 'decimals', 'display', 'color', 'max', 'numbers', 'relation', 'rollup', 'target', 'calc'];

// "Fantasy=purple, Sci-Fi=red" ↔ [{ name, color }]
const parseOptions = (text) =>
  text
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean)
    .map((s) => {
      const i = s.lastIndexOf('=');
      const color = i > 0 ? s.slice(i + 1).trim() : '';
      return COLORS.includes(color) ? { name: s.slice(0, i).trim(), color } : { name: s, color: 'gray' };
    });
const formatOptions = (options) => options.map((o) => `${o.name}=${o.color || 'gray'}`).join(', ');

// Reads the block text into { source, props, views }. Unknown keys are ignored; a bad view type falls back to a table.
export function parseDb(text = '') {
  const cfg = { source: '', props: [], views: [] };
  let cur = null;
  let prop = null;
  for (const line of text.replace(/\r\n?/g, '\n').split('\n')) {
    if (line.trim() === '---') {
      cur = null;
      prop = null;
      continue;
    }
    const m = line.match(LINE);
    if (!m) continue;
    const [, key, value] = m;
    if (key === 'source') {
      cfg.source = value;
      continue;
    }
    if (key === 'prop') {
      if (value && !cfg.props.some((p) => p.name.toLowerCase() === value.toLowerCase())) cfg.props.push((prop = newProp(value)));
      else prop = null;
      continue;
    }
    if (PROP_KEYS.has(key)) {
      if (!prop) continue;
      if (key === 'type') prop.type = TYPE[value] ? value : 'text';
      else if (key === 'options') prop.options = parseOptions(value);
      else prop[key] = value;
      continue;
    }
    prop = null;
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

// The note with its first database block's text replaced (the fence is kept). Unchanged when there is none.
export function replaceDatabase(markdown, text) {
  let done = false;
  return markdown.replace(/^(`{3,}|~{3,})(database[ \t]*\r?\n)([\s\S]*?)(\r?\n)\1([ \t]*)$/m, (all, fence, open, body, nl, tail) => {
    if (done) return all;
    done = true;
    return `${fence}${open}${text}${nl}${fence}${tail}`;
  });
}

// The views of a database page that an embed shows, as indexes into its views: `use: Leyendo, Leídos` names them
// (in the order written). With no `use`, or no name that exists, every view.
export function pickViews(use, views) {
  const names = String(use ?? '').split(',').map((n) => n.trim()).filter(Boolean);
  const picked = names.map((n) => views.findIndex((v) => v.name === n)).filter((i) => i >= 0);
  return picked.length ? [...new Set(picked)] : views.map((_, i) => i);
}

// "Page Count desc" → { key: "Page Count", dir: "desc" }; property names may contain spaces.
export function parseSort(sort = '') {
  const m = sort.trim().match(/^(.*?)(?:\s+(asc|desc))?$/i);
  return { key: m?.[1] ?? '', dir: m?.[2]?.toLowerCase() === 'desc' ? 'desc' : 'asc' };
}

// A property renamed (or removed when `to` is '') everywhere the block mentions it: schema, formulas, rollups, views.
export function renamePropInDb(cfg, from, to) {
  const same = (k) => k.toLowerCase() === from.toLowerCase();
  if (to) {
    for (const p of cfg.props) {
      if (same(p.name)) p.name = to;
      if (p.formula) p.formula = renameInFormula(p.formula, from, to);
      if (p.rollup && same(p.rollup)) p.rollup = to;
    }
  } else {
    cfg.props = cfg.props.filter((p) => !same(p.name));
    for (const p of cfg.props) if (p.rollup && same(p.rollup)) p.rollup = '';
  }
  for (const v of cfg.views) {
    v.show = v.show.flatMap((k) => (same(k) ? (to ? [to] : []) : [k]));
    v.filter = v.filter.flatMap((f) => (same(f.key) ? (to ? [{ ...f, key: to }] : []) : [f]));
    const s = parseSort(v.sort);
    if (s.key && same(s.key)) v.sort = to ? `${to} ${s.dir}` : '';
    for (const k of ['group', 'value']) if (v[k] && same(v[k])) v[k] = to;
    if (v.preview === `property:${from}`) v.preview = to ? `property:${to}` : '';
  }
  return cfg;
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
  for (const p of cfg.props ?? []) {
    out.push(`prop: ${p.name}`, `type: ${p.type}`);
    for (const k of PROP_ORDER.slice(1)) {
      if (k === 'options') {
        if (p.options?.length) out.push(`options: ${formatOptions(p.options)}`);
      } else if (p[k]) out.push(`${k}: ${p[k]}`);
    }
  }
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

// The page of a new database: it holds the block that reads the folder `source` (its rows).
export function newDatabasePage(source, view = 'table') {
  const group = view === 'board' || view === 'donut' ? 'group: status\n' : '';
  return `~~~database\nsource: ${source}\nview: ${view}\n${group}~~~\n`;
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
  const { key, dir } = parseSort(sort);
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
