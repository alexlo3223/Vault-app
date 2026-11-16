// Typed properties of database rows, like Notion's: the schema lives in the database block (see database.mjs),
// the values in each row's frontmatter. Pure logic (no DOM), shared by the browser and the tests.
import { FormulaError, evaluate, toDate, toStr } from './formula.mjs';

// `stored: false` = computed, never written to a note.
export const TYPES = [
  { type: 'text', label: 'Text', icon: 'text' },
  { type: 'number', label: 'Number', icon: 'hash' },
  { type: 'select', label: 'Select', icon: 'select' },
  { type: 'multi-select', label: 'Multi-select', icon: 'list' },
  { type: 'status', label: 'Status', icon: 'status' },
  { type: 'date', label: 'Date', icon: 'calendar' },
  { type: 'checkbox', label: 'Checkbox', icon: 'check' },
  { type: 'url', label: 'URL', icon: 'link' },
  { type: 'email', label: 'Email', icon: 'at' },
  { type: 'phone', label: 'Phone', icon: 'phone' },
  { type: 'formula', label: 'Formula', icon: 'sigma', stored: false },
  { type: 'relation', label: 'Relation', icon: 'relation' },
  { type: 'rollup', label: 'Rollup', icon: 'rollup', stored: false },
  { type: 'created', label: 'Created time', icon: 'clock', stored: false },
  { type: 'edited', label: 'Last edited time', icon: 'clock', stored: false },
];
export const TYPE = Object.fromEntries(TYPES.map((t) => [t.type, t]));
export const isStored = (type) => TYPE[type]?.stored !== false;
export const hasOptions = (type) => type === 'select' || type === 'multi-select' || type === 'status';
export const isNumeric = (prop) => prop.type === 'number' || prop.type === 'formula' || prop.type === 'rollup';

export const COLORS = ['gray', 'brown', 'orange', 'yellow', 'green', 'blue', 'purple', 'pink', 'red'];
export const FORMATS = [
  ['number', 'Number'],
  ['comma', 'Number with commas'],
  ['percent', 'Percent'],
  ['dollar', 'US dollar'],
  ['euro', 'Euro'],
];
export const DISPLAYS = ['number', 'bar', 'ring'];
export const CALCS = [
  ['list', 'Show original'],
  ['count', 'Count all'],
  ['count values', 'Count values'],
  ['sum', 'Sum'],
  ['avg', 'Average'],
  ['min', 'Min'],
  ['max', 'Max'],
  ['percent checked', 'Percent checked'],
];

// Keys that describe how a page looks, not data: never shown as database properties.
export const PAGE_KEYS = new Set(['icon', 'cover', 'width', 'cover_x', 'cover_y', 'cover_zoom', 'cover_height']);

// A property name is a YAML key and goes into comma lists ("show: a, b"), so a few characters are not allowed.
export const validPropName = (n) => typeof n === 'string' && !!n.trim() && n === n.trim() && !/[:,=[\]#|"\n\r{}]/.test(n) && !/^[-?!&*>|%@`']/.test(n);

export const newProp = (name, type = 'text') => {
  const p = { name, type, options: [], formula: '', format: '', decimals: '', display: '', color: '', max: '', numbers: '', relation: '', rollup: '', target: '', calc: '' };
  if (type === 'status') p.options = STATUS_OPTIONS.map((o) => ({ ...o }));
  if (type === 'rollup') p.calc = 'count';
  return p;
};
export const STATUS_OPTIONS = [
  { name: 'Not started', color: 'gray' },
  { name: 'In progress', color: 'blue' },
  { name: 'Done', color: 'green' },
];

// The color a new option gets: the first one not used yet (bright ones first, gray last), then around again.
const NEW_COLORS = ['blue', 'green', 'purple', 'orange', 'pink', 'yellow', 'red', 'brown', 'gray'];
export const nextColor = (options) => NEW_COLORS.find((c) => !options.some((o) => o.color === c)) ?? NEW_COLORS[options.length % NEW_COLORS.length];

const isList = Array.isArray;
const asList = (raw) => (isList(raw) ? raw : raw === undefined || raw === null || raw === '' ? [] : [raw]);
// Plain decimal numbers only: Number() alone would also read "0x10" (16) and "0b11" (3).
const DECIMAL = /^[+-]?(\d+\.?\d*|\.\d+)([eE][+-]?\d+)?$/;
const isNumberText = (v) => (typeof v === 'number' && Number.isFinite(v)) || (typeof v === 'string' && DECIMAL.test(v.trim()));

// The type of a frontmatter key that has no schema entry, guessed from the values the rows have.
export function inferType(values) {
  const present = values.filter((v) => v !== undefined && v !== null && v !== '');
  if (!present.length) return 'text';
  if (present.some(isList)) return 'multi-select';
  if (present.every((v) => /^(true|false)$/i.test(String(v)))) return 'checkbox';
  if (present.every(isNumberText)) return 'number';
  if (present.every((v) => toDate(String(v)))) return 'date';
  return 'text';
}

// "[[Quotes/Quote 1|Quote one]]" → "Quotes/Quote 1"; plain names stay as they are.
export const linkTarget = (s) => toStr(s).trim().replace(/^\[\[/, '').replace(/\]\]$/, '').split('|')[0].replace(/\.md$/i, '').trim();
export const relationNames = (raw) => asList(raw).map(linkTarget).filter(Boolean);
export const toLink = (name) => `[[${name}]]`;

// A raw frontmatter value read as the property's type. Types are lenient so changing a type never loses data:
// a list read as text is joined, one word read as a multi-select is a list of one.
export function readValue(prop, raw) {
  switch (prop.type) {
    case 'number': {
      if (isList(raw)) raw = raw[0];
      if (isNumberText(raw)) return Number(raw);
      // Text that is not a number stays as text, so the cell shows it (marked) and it can be corrected.
      const text = toStr(raw).trim();
      return text === '' ? null : text;
    }
    case 'multi-select':
      return asList(raw).map(toStr).filter(Boolean);
    case 'relation':
      return relationNames(raw);
    case 'date': {
      // Text that is not a date stays as text, so it shows up and can be corrected instead of looking empty.
      const text = toStr(isList(raw) ? raw[0] : raw).trim();
      return text === '' ? null : (toDate(text) ?? text);
    }
    case 'checkbox':
      return /^(true|yes|x|1)$/i.test(toStr(isList(raw) ? raw[0] : raw).trim());
    default: {
      const s = isList(raw) ? raw.map(toStr).join(', ') : toStr(raw);
      return s === '' ? null : s;
    }
  }
}

// A typed value back to what setProp writes into the frontmatter ('' removes the key).
export function writeValue(prop, value) {
  switch (prop.type) {
    case 'multi-select':
      return asList(value).map(toStr).filter(Boolean);
    case 'relation':
      return asList(value).map((v) => toLink(linkTarget(v))).filter((v) => v !== '[[]]');
    case 'checkbox':
      return !!value;
    case 'number':
      return value === null || value === '' || !Number.isFinite(Number(value)) ? '' : String(Number(value));
    case 'date': {
      const d = value instanceof Date ? value : toDate(toStr(value));
      if (!d || Number.isNaN(d.getTime())) return '';
      const p = (n, w = 2) => String(n).padStart(w, '0');
      const day = `${p(d.getFullYear(), 4)}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
      // The time is kept when there is one (midnight counts as "no time"): 2026-11-16T14:30.
      return d.getHours() || d.getMinutes() ? `${day}T${p(d.getHours())}:${p(d.getMinutes())}` : day;
    }
    default:
      return value === null || value === undefined ? '' : toStr(value);
  }
}

// ---------- numbers ----------
export function formatNumber(n, prop = {}) {
  if (n === null || n === undefined || !Number.isFinite(n)) return '';
  const percent = prop.format === 'percent';
  const value = percent ? n * 100 : n;
  const set = prop.decimals !== '' && prop.decimals !== undefined && Number.isFinite(Number(prop.decimals));
  const digits = set ? Number(prop.decimals) : null;
  const opts = { minimumFractionDigits: digits ?? 0, maximumFractionDigits: digits ?? (percent ? 0 : 2), useGrouping: prop.format === 'comma' || prop.format === 'dollar' || prop.format === 'euro' };
  const text = value.toLocaleString('en-US', opts);
  if (percent) return `${text}%`;
  if (prop.format === 'dollar') return value < 0 ? `-$${text.slice(1)}` : `$${text}`;
  if (prop.format === 'euro') return `${text} €`;
  return text;
}

// How full a bar or ring is (0–1). "Divide by" defaults to 1 for percents (0.5 = half) and 100 otherwise.
export function barFraction(n, prop = {}) {
  if (!Number.isFinite(n)) return 0;
  const max = Number(prop.max) > 0 ? Number(prop.max) : prop.format === 'percent' ? 1 : 100;
  return Math.max(0, Math.min(1, n / max));
}

// ---------- rollups ----------
export function rollupValue(calc, values, rowCount = values.length) {
  const present = values.filter((v) => !(v === null || v === undefined || v === '' || (isList(v) && !v.length)));
  const nums = present.flatMap(asList).filter(isNumberText).map(Number);
  switch (calc) {
    case 'count':
      return rowCount;
    case 'count values':
      return present.flatMap(asList).length;
    case 'sum':
      return nums.reduce((s, n) => s + n, 0);
    case 'avg':
      return nums.length ? nums.reduce((s, n) => s + n, 0) / nums.length : null;
    case 'min':
      return nums.length ? Math.min(...nums) : null;
    case 'max':
      return nums.length ? Math.max(...nums) : null;
    case 'percent checked':
      return rowCount ? values.filter((v) => /^(true|yes|x|1)$/i.test(toStr(v).trim())).length / rowCount : null;
    default:
      return present.flatMap(asList).map((v) => (v instanceof Date ? v : toStr(v)));
  }
}

// ---------- schema + rows ----------
// The schema's properties, then one guessed property for every other key the rows have (in first-seen order).
export function fullSchema(schema, rows) {
  const known = new Set(schema.map((p) => p.name.toLowerCase()));
  const extra = new Map();
  for (const r of rows) {
    for (const [k, v] of Object.entries(r.props ?? {})) {
      if (PAGE_KEYS.has(k.toLowerCase()) || known.has(k.toLowerCase())) continue;
      if (!extra.has(k)) extra.set(k, []);
      extra.get(k).push(v);
    }
  }
  return [...schema, ...[...extra].map(([name, values]) => ({ ...newProp(name, inferType(values)), inferred: true }))];
}

// Finds a row of a related database by a link ("Quote 1" or "Quotes/Quote 1").
function findRow(rows, name) {
  const want = name.toLowerCase();
  return rows.find((r) => r.path.slice(0, -3).toLowerCase() === want) ?? rows.find((r) => r.name.toLowerCase() === want.split('/').pop());
}

// Every row with `values` (typed, computed ones included) and `errors` (formula problems by property).
// related: Map(source folder → rows of that database), for relations and rollups.
export function computeRows(rows, schema, related = new Map()) {
  const props = fullSchema(schema, rows);
  const byName = new Map(props.map((p) => [p.name.toLowerCase(), p]));
  return rows.map((r) => {
    const values = {};
    const errors = {};
    const done = new Set();
    const busy = new Set();
    const raw = (name) => Object.entries(r.props ?? {}).find(([k]) => k.toLowerCase() === name.toLowerCase())?.[1];

    const get = (p) => {
      const key = p.name;
      if (done.has(key)) return values[key];
      if (busy.has(key)) throw new FormulaError(`“${key}” depends on itself`);
      busy.add(key);
      let v;
      try {
        v = compute(p);
      } catch (e) {
        if (p.type !== 'formula' || !(e instanceof FormulaError)) throw e;
        errors[key] = e.message;
        v = null;
      }
      busy.delete(key);
      done.add(key);
      values[key] = v;
      return v;
    };

    const compute = (p) => {
      switch (p.type) {
        case 'formula': {
          if (!p.formula.trim()) return null;
          const out = evaluate(p.formula, {
            prop: (name) => {
              const target = byName.get(name.toLowerCase());
              if (target) {
                // An error in another formula shows up here as this formula's error too.
                const v = get(target);
                if (errors[target.name]) throw new FormulaError(`“${target.name}”: ${errors[target.name]}`);
                return v;
              }
              if (name.toLowerCase() === 'name' || name.toLowerCase() === 'title') return r.name;
              throw new FormulaError(`There is no property “${name}”`);
            },
          });
          if (out.error) throw new FormulaError(out.error);
          return out.value;
        }
        case 'rollup': {
          const rel = byName.get(p.rollup.toLowerCase());
          if (!rel || rel.type !== 'relation') return null;
          const targets = (related.get(rel.relation) ?? []);
          const linked = relationNames(raw(rel.name)).map((n) => findRow(targets, n)).filter(Boolean);
          const target = p.target.trim();
          const vals = linked.map((row) => (!target || /^(name|title)$/i.test(target) ? row.name : Object.entries(row.props ?? {}).find(([k]) => k.toLowerCase() === target.toLowerCase())?.[1]));
          return rollupValue(p.calc || 'count', vals, linked.length);
        }
        case 'created':
          return r.ctime ? new Date(r.ctime) : null;
        case 'edited':
          return r.mtime ? new Date(r.mtime) : null;
        default:
          return readValue(p, raw(p.name));
      }
    };

    for (const p of props) get(p);
    return { ...r, values, errors };
  });
}

// A value as plain text/number/list, the form filters, sorting, grouping and totals work with.
export function flatValue(v) {
  if (v === null || v === undefined) return '';
  if (v instanceof Date) return writeValue({ type: 'date' }, v); // sorts and compares as text: YYYY-MM-DD[THH:mm]
  if (isList(v)) return v.map((x) => (x instanceof Date ? flatValue(x) : toStr(x)));
  if (typeof v === 'boolean') return v ? 'true' : 'false';
  if (typeof v === 'number') return String(v);
  return String(v);
}

// Rows for the view helpers (filterRows, sortRows, groupRows, aggregate): props = every value, flattened.
export const flatRows = (computed) => computed.map((r) => ({ ...r, props: Object.fromEntries(Object.entries(r.values).map(([k, v]) => [k, flatValue(v)])) }));
