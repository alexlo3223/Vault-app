// Database blocks in the editor: view tabs, the six views, and the ⚙ settings panel.
// Rules and parsing live in database.mjs, typed properties in properties.mjs (values) and props-ui.mjs (editors).
// No inline style attributes (the page's CSP forbids them): sizes and colours are set through the CSSOM or SVG attributes.
import { icon } from './views.js';
import { isHttps } from './blocks.mjs';
import { isImageRef } from './cover.mjs';
import { AGGS, BUCKETS, OPS, VIEW_TYPES, aggregate, bucketRows, extractDatabase, filterRows, groupRows, newView, parseDb, parseSort, pickViews, renamePropInDb, serializeDb, sortRows } from './database.mjs';
import { computeRows, flatRows, fullSchema, isStored, newProp, nextColor, writeValue } from './properties.mjs';
import { addPropertyMenu, editValue, formulaEditor, onPopoverClose, popoverOpen, propertyMenu, typeIcon, valueEl } from './props-ui.mjs';

const enc = encodeURIComponent;
const SVG = 'http://www.w3.org/2000/svg';
const COLORS = ['#ffc857', '#7ab8ff', '#6fd39a', '#ff6b6b', '#c79bff', '#ff9f5a', '#8ee3e3'];
const VIEW_LABEL = { table: 'Tabla', board: 'Tablero', gallery: 'Galería', list: 'Lista', number: 'Número', donut: 'Donut', bar: 'Barras', line: 'Líneas' };
const VIEW_ICON = { table: 'table', board: 'board', gallery: 'grid', list: 'list', number: 'hash', donut: 'donut', bar: 'bar', line: 'line' };
const BUCKET_LABEL = { day: 'Día', week: 'Semana', month: 'Mes', year: 'Año' };
const AGG_LABEL = { count: 'Recuento', sum: 'Suma', avg: 'Media', min: 'Mínimo', max: 'Máximo' };

const el = (tag, cls = '', text = '') => {
  const n = document.createElement(tag);
  if (cls) n.className = cls;
  if (text !== '') n.textContent = text;
  return n;
};
const button = (cls, text, onClick, title = '') => {
  const b = el('button', cls, text);
  b.type = 'button';
  if (title) b.title = title;
  b.addEventListener('click', onClick);
  return b;
};
const iconButton = (name, label, onClick, cls = 'db-tab') => {
  const b = button(`${cls} db-icon-btn`, '', onClick, label);
  b.setAttribute('aria-label', label);
  b.append(icon(name, 14));
  return b;
};
const select = (options, value, onChange, label = '') => {
  const s = el('select', 'db-select');
  if (label) s.setAttribute('aria-label', label);
  for (const [v, text] of options) s.append(new Option(text, v));
  s.value = value;
  s.addEventListener('change', () => onChange(s.value));
  return s;
};
const field = (label, control) => {
  const row = el('label', 'db-set-row');
  row.append(el('span', 'db-set-label', label), control);
  return row;
};
const same = (a, b) => a.toLowerCase() === b.toLowerCase();

// A link to an image or file in the vault (through /api/file), or an https address; anything else is no picture.
const pictureUrl = (ref, from) => {
  if (typeof ref !== 'string' || !ref) return '';
  if (isHttps(ref)) return ref;
  return /^https?:/i.test(ref) ? '' : `/api/file?link=${enc(ref)}&from=${enc(from)}`;
};

// The icon of a row: an emoji as text, or an image (a file of the vault or an https address) as a small picture.
function iconNode(r) {
  const url = isImageRef(r.icon) ? pictureUrl(String(r.icon).replace(/^!?[[|]]$/g, ''), r.path) : '';
  if (!url) return el('span', 'db-card-icon', isImageRef(r.icon) ? '•' : r.icon);
  const img = el('img', 'db-icon-img');
  img.src = url;
  img.alt = '';
  return img;
}

// The view index in use, kept in memory on the block (it is not written to the note).
const activeIndex = (b, cfg) => Math.min(b.activeView ?? 0, cfg.views.length - 1);

// Properties a view shows: its "show:" list, or by default every property in a table and the first three elsewhere.
function visibleProps(view, props) {
  if (view.show.length) return view.show.map((n) => props.find((p) => same(p.name, n))).filter(Boolean);
  return view.view === 'table' ? props : props.slice(0, 3);
}

// Rows of the database with every value computed (formulas, rollups…), plus what editing needs.
export async function loadData(target, ctx) {
  const { rows } = await ctx.api('GET', `/api/db?folder=${enc(target.source)}`);
  const related = new Map();
  for (const p of target.props) {
    if (p.type !== 'relation' || !p.relation || related.has(p.relation)) continue;
    related.set(p.relation, (await ctx.api('GET', `/api/db?folder=${enc(p.relation)}`).catch(() => ({ rows: [] }))).rows);
  }
  return { raw: rows, related, computed: computeRows(rows, target.props, related), props: fullSchema(target.props, rows) };
}

// Entry point: the whole database block. `ctx` supplies what the note editor owns:
// { rerender, changed, api, setStatus, setProp(path, key, value), createRow(source), editSource(b),
//   updateSchema(page, fn), renameRowsProp(folder, from, to), open(link) }.
export function databaseEl(b, ctx) {
  const cfg = parseDb(b.text);
  if (cfg.page) return embedDb(b, cfg, ctx);
  const box = el('div', 'db');
  const head = el('div', 'db-head');
  head.append(el('span', 'eyebrow mono', `Base de datos · ${cfg.source || 'sin carpeta de origen'}`));
  const current = activeIndex(b, cfg);
  cfg.views.forEach((v, i) => {
    const tab = button(`db-tab${i === current ? ' active' : ''}`, v.name || VIEW_LABEL[v.view], () => {
      b.activeView = i;
      ctx.rerender();
    });
    tab.prepend(icon(VIEW_ICON[v.view], 13));
    head.append(tab);
  });
  head.append(
    iconButton('plus', 'Añadir vista', () => {
      cfg.views.push(newView('table'));
      b.activeView = cfg.views.length - 1;
      save(b, cfg, ctx);
    }),
    iconButton('settings', 'Ajustes de la vista', () => {
      b.settingsOpen = !b.settingsOpen;
      ctx.rerender();
    }),
    button('db-tab', 'Editar código', () => ctx.editSource(b)),
  );
  box.append(head);

  const body = el('div', 'db-body');
  box.append(body);
  if (!cfg.source) {
    body.append(el('p', 'db-empty', 'Pon en “source:” la carpeta que tiene las notas (Editar código).'));
    return box;
  }
  body.append(el('p', 'db-empty', 'Cargando…'));
  // The schema is this block's own: edit it in place. Each edit starts from the block's current text, so a menu
  // opened before an earlier change never writes back an old schema.
  const owner = {
    cfg,
    edit: (fn) => {
      const fresh = parseDb(b.text);
      fn(fresh);
      save(b, fresh, ctx);
      return Promise.resolve();
    },
  };
  loadData(cfg, ctx)
    .then((data) => paint(body, b, cfg, current, data, ctx, { owner }))
    .catch((e) => body.replaceChildren(el('p', 'db-empty', e.message)));
  return box;
}

// An embed shows a database page. The page holds the settings (its own database block); this block only shows
// one of its views. View settings are changed on the page; properties can be edited from here too.
function embedDb(b, cfg, ctx) {
  const box = el('div', 'db');
  const head = el('div', 'db-head');
  head.append(el('span', 'eyebrow mono', `Base de datos · ${cfg.page}`));
  const open = el('a', 'db-tab', 'Abrir base de datos');
  open.href = `#/${enc(`${cfg.page}.md`)}`;
  head.append(open);
  box.append(head);
  const body = el('div', 'db-body', 'Cargando…');
  box.append(body);
  ctx
    .api('GET', `/api/page?path=${enc(`${cfg.page}.md`)}`)
    .then(async (page) => {
      const text = extractDatabase(page.content);
      if (text === null) return body.replaceChildren(el('p', 'db-empty', 'Esta página aún no tiene base de datos. Ábrela para añadir una.'));
      const target = parseDb(text);
      // `use:` names the views to show ("use: Leyendo, Leídos"): one name pins the embed to that view (no tabs), several
      // give tabs for only those; without it the embed offers every view as tabs.
      const picks = pickViews(cfg.use, target.views);
      const current = picks.includes(b.activeView) ? b.activeView : picks[0];
      if (picks.length > 1 || !cfg.use?.trim()) {
        for (const i of picks) {
          const v = target.views[i];
          const tab = button(`db-tab${i === current ? ' active' : ''}`, v.name || VIEW_LABEL[v.view], () => {
            b.activeView = i;
            ctx.rerender();
          });
          tab.prepend(icon(VIEW_ICON[v.view], 13));
          head.append(tab);
        }
      }
      if (!target.source) return body.replaceChildren(el('p', 'db-empty', 'La base de datos de esa página no tiene carpeta de origen.'));
      const owner = {
        cfg: target,
        edit: (fn) => ctx.updateSchema(`${cfg.page}.md`, fn).then(ctx.rerender, (e) => ctx.setStatus(e.message)),
      };
      paint(body, b, target, current, await loadData(target, ctx), ctx, { settings: false, owner });
    })
    .catch((e) => body.replaceChildren(el('p', 'db-empty', e.message)));
  return box;
}

// Writes the settings back into the block, then redraws it.
function save(b, cfg, ctx) {
  b.text = serializeDb(cfg);
  ctx.changed();
  ctx.rerender();
}

// One write at a time: several quick edits (ticking options) must not race each other on the same note.
let writing = Promise.resolve();
const queue = (fn) => (writing = writing.then(fn, fn));

function paint(body, b, cfg, i, data, ctx, { settings = true, owner }) {
  const view = cfg.views[i];
  const { props } = data;
  const rows = flatRows(data.computed);
  const shown = sortRows(filterRows(rows, view.filter), view.sort);
  const act = (p) => p.then(ctx.rerender, (e) => ctx.setStatus(e.message));
  const o = { ctx, act, owner, data, props, view, viewIndex: i, handlers: schemaHandlers(owner, data, ctx, i), refocus: askFocus };
  const parts = [];
  if (settings && b.settingsOpen) parts.push(settingsEl(b, cfg, i, props.map((p) => p.name), ctx));
  if (!rows.length && view.view !== 'table') parts.push(el('p', 'db-empty', 'Aún no hay notas en esta carpeta. Usa “+ Nueva” para añadir una.'));
  else if (rows.length && !shown.length) parts.push(el('p', 'db-empty', 'Ninguna nota cumple los filtros de esta vista.'));
  if (shown.length || view.view === 'table') parts.push(viewContent(view, shown, props, o));
  parts.push(button('db-tab db-new', '+ Nueva', () => ctx.createRow(cfg.source).catch((e) => ctx.setStatus(e.message))));
  body.replaceChildren(...parts);
  focusPending();
}

// After a value is saved the view is drawn again. This puts the keyboard back on the cell that was edited, so values
// can be entered one after another without the mouse. It expires, so a cell that is gone never takes the focus later.
let pendingFocus = null;
const askFocus = (row, prop) => {
  pendingFocus = { row, prop, at: Date.now() };
};
function focusPending() {
  if (!pendingFocus) return;
  if (Date.now() - pendingFocus.at > 3000) return void (pendingFocus = null);
  if (popoverOpen()) return; // a panel that stays open (several options) is still in use
  const { row, prop } = pendingFocus;
  const target = [...document.querySelectorAll('.db-cell[data-row]')].find((c) => c.dataset.row === row && c.dataset.prop === prop);
  if (!target) return; // another block is still drawing: try again with the next one
  target.focus({ preventScroll: true });
  pendingFocus = null;
}
// A panel that stayed open while values changed has no redraw left to wait for once it closes.
onPopoverClose(() => setTimeout(focusPending, 400));

// What the property menus need, for one database. Without a view index there is no "Hide in this view".
export function schemaHandlers(owner, data, ctx, viewIndex) {
  const schemaOf = (c, name) => c.props.find((p) => same(p.name, name));
  // A property that is only guessed from the notes joins the schema the first time it is configured.
  const update = (next, prevName) =>
    owner.edit((c) => {
      const k = c.props.findIndex((p) => same(p.name, prevName));
      if (k >= 0) c.props[k] = next;
      else c.props.push(next);
    });
  return (prop) => ({
    props: data.props,
    update,
    rename: async (to) => {
      await ctx.renameRowsProp(owner.cfg.source, prop.name, to);
      await owner.edit((c) => {
        if (!schemaOf(c, prop.name) && !prop.inferred) c.props.push({ ...prop });
        renamePropInDb(c, prop.name, to);
      });
    },
    remove: async () => {
      if (isStored(prop.type)) await ctx.renameRowsProp(owner.cfg.source, prop.name, '');
      await owner.edit((c) => renamePropInDb(c, prop.name, ''));
    },
    hide: viewIndex === undefined ? undefined : () =>
      owner.edit((c) => {
        const v = c.views[viewIndex];
        const names = visibleProps(v, data.props).map((p) => p.name);
        const rest = names.filter((n) => !same(n, prop.name));
        if (rest.length) v.show = rest;
      }),
    databases: () => ctx.api('GET', '/api/databases').then((r) => r.databases.map((d) => ({ source: d.source, name: d.path.slice(0, -3) }))),
    editFormula: (cur) =>
      formulaEditor(cur, {
        props: data.props,
        preview: (src) => {
          const first = data.raw[0];
          if (!first) return { value: null, rowName: '' };
          const schema = owner.cfg.props.some((p) => same(p.name, cur.name)) ? owner.cfg.props.map((p) => (same(p.name, cur.name) ? { ...cur, formula: src } : p)) : [...owner.cfg.props, { ...cur, formula: src }];
          const [r] = computeRows([first], schema, data.related);
          return { value: r.values[cur.name], error: r.errors[cur.name], rowName: first.name };
        },
        save: (src) => update({ ...cur, formula: src }, cur.name),
      }),
  });
}

// Editing one value of one row. o: { ctx (setProp, api), owner, act }
export function cellHandlers(r, prop, o) {
  return {
    save: (v) => {
      o.refocus?.(r.path, prop.name);
      return o.act(queue(() => o.ctx.setProp(r.path, prop.name, writeValue(prop, v))));
    },
    addOption: (name) =>
      o.owner.edit((c) => {
        let p = c.props.find((x) => same(x.name, prop.name));
        if (!p) c.props.push((p = { ...newProp(prop.name, prop.type), options: [...prop.options] }));
        if (!p.options.some((x) => same(x.name, name))) p.options.push({ name, color: nextColor(p.options) });
      }),
    loadRelated: () => o.ctx.api('GET', `/api/db?folder=${enc(prop.relation)}`).then((x) => x.rows),
  };
}

function viewContent(view, shown, props, o) {
  switch (view.view) {
    case 'board':
      return boardView(view, shown, props, o);
    case 'gallery':
      return galleryView(view, shown, props, o);
    case 'list':
      return listView(view, shown, props, o);
    case 'number':
      return numberView(view, shown);
    case 'donut':
      return donutView(view, shown);
    case 'bar':
    case 'line':
      return chartView(view, shown);
    default:
      return tableView(view, shown, props, o);
  }
}

function link(r) {
  const a = el('a', 'db-card-title', r.name);
  a.href = `#/${enc(r.path)}`;
  return a;
}

// A value as shown in a view; a click edits it when the property is stored in the notes.
function cell(tag, r, prop, o, opts = {}) {
  const box = el(tag, `db-cell${isStored(prop.type) ? ' editable' : ''}${prop.type === 'number' || typeof r.values[prop.name] === 'number' ? ' num' : ''}`);
  box.append(valueEl(prop, r.values[prop.name], { error: r.errors[prop.name], open: o.ctx.open, ...opts }));
  if (isStored(prop.type)) {
    box.tabIndex = 0;
    box.dataset.row = r.path;
    box.dataset.prop = prop.name;
    const edit = (e) => {
      if (e.target.closest('a')) return;
      editValue(box, prop, r.values[prop.name], cellHandlers(r, prop, o));
    };
    box.addEventListener('click', edit);
    box.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        edit(e);
      }
    });
  }
  return box;
}

function propHeader(prop, o) {
  const th = el('th');
  const btn = button('db-th', '', () => propertyMenu(btn, prop, o.handlers(prop)), `${prop.name} · clic para ver opciones`);
  btn.append(typeIcon(prop.type, 13), el('span', '', prop.name));
  th.append(btn);
  return th;
}

function addPropButton(o) {
  const btn = iconButton('plus', 'Añadir propiedad', () =>
    addPropertyMenu(btn, {
      names: o.props.map((p) => p.name),
      create: (name, type) =>
        o.owner.edit((c) => {
          c.props.push(newProp(name, type));
          const v = c.views[o.viewIndex];
          if (v?.show.length) v.show.push(name);
        }),
    }),
  );
  return btn;
}

function tableView(view, shown, props, o) {
  const cols = visibleProps(view, props);
  const table = el('table', 'db-table');
  const head = el('tr');
  const nameTh = el('th');
  nameTh.append(el('span', 'db-th db-th-static', 'Nombre'));
  const plus = el('th', 'db-th-add');
  plus.append(addPropButton(o));
  head.append(nameTh, ...cols.map((p) => propHeader(p, o)), plus);
  table.append(head);
  for (const r of shown) {
    const tr = el('tr');
    const name = el('td', 'db-name');
    if (r.icon) name.append(iconNode(r));
    name.append(link(r));
    tr.append(name, ...cols.map((p) => cell('td', r, p, o)), el('td'));
    table.append(tr);
  }
  return wrapScroll(table);
}

function wrapScroll(node) {
  const box = el('div', 'db-scroll');
  box.append(node);
  return box;
}

function boardView(view, shown, props, o) {
  if (!view.group) return el('p', 'db-empty', 'Elige una propiedad en “Agrupar por”, en los ajustes (⚙).');
  const prop = props.find((p) => same(p.name, view.group)) ?? newProp(view.group);
  const groups = groupRows(shown, view.group);
  // Columns follow the option order of a select/status property; values without an option come after.
  const order = [...(prop.options ?? []).map((x) => x.name), ...[...groups.keys()].filter((k) => !(prop.options ?? []).some((x) => same(x.name, k)))];
  const keys = [...new Set(order.filter((k) => k !== ''))];
  if (groups.has('')) keys.push('');
  const board = el('div', 'db-board');
  for (const value of keys) {
    const items = groups.get(value) ?? [];
    const col = el('div', 'db-col');
    const colHead = el('div', 'db-col-head');
    // Option groups show their coloured chip; other values are plain text.
    const label = !value ? el('span', '', 'Sin valor') : prop.options?.length ? valueEl({ ...prop, type: prop.type === 'status' ? 'status' : 'select' }, value) : el('span', '', value);
    colHead.append(label, el('span', 'db-col-count', String(items.length)));
    col.append(colHead);
    for (const r of items) {
      const card = el('div', 'db-card');
      const sel = select(
        keys.map((v) => [v, v || 'Sin valor']),
        value,
        (x) => o.act(queue(() => o.ctx.setProp(r.path, prop.name, writeValue(prop.type === 'multi-select' ? { type: 'text' } : prop, x)))),
        `Mover ${r.name} a`,
      );
      card.append(link(r));
      for (const p of visibleProps({ ...view, view: 'board', show: view.show }, props).filter((p) => !same(p.name, prop.name))) {
        const v = r.values[p.name];
        if (v === null || v === undefined || v === '' || (Array.isArray(v) && !v.length)) continue;
        card.append(cell('div', r, p, o));
      }
      card.append(sel);
      col.append(card);
    }
    board.append(col);
  }
  return board;
}

function galleryView(view, shown, props, o) {
  const grid = el('div', `db-gallery db-size-${view.size || 'medium'}`);
  const fit = view.fit === 'fit' ? 'contain' : 'cover';
  const imageKey = (view.preview || '').replace('property:', '');
  const shownProps = visibleProps(view, props).filter((p) => !same(p.name, imageKey));
  for (const r of shown) {
    const card = el('div', 'db-card');
    const src = previewSrc(view, r);
    if (src) {
      const img = el('img', 'db-cover');
      img.src = src;
      img.alt = '';
      img.loading = 'lazy';
      img.style.objectFit = fit; // CSSOM, allowed by the CSP
      img.addEventListener('error', () => img.remove());
      card.append(img);
    } else {
      card.append(el('div', 'db-cover db-cover-empty'));
    }
    const title = el('div', 'db-card-head');
    if (r.icon) title.append(iconNode(r));
    title.append(link(r));
    card.append(title);
    for (const p of shownProps) {
      const v = r.values[p.name];
      if (v === null || v === undefined || v === '' || (Array.isArray(v) && !v.length)) continue;
      const c = cell('div', r, p, o);
      c.classList.add('db-card-prop');
      c.title = p.name;
      card.append(c);
    }
    grid.append(card);
  }
  return grid;
}

function previewSrc(view, r) {
  const p = view.preview || 'auto';
  if (p === 'none') return '';
  if (p.startsWith('property:')) return pictureUrl(r.props[p.slice(9)], r.path);
  if (p === 'cover') return pictureUrl(r.cover, r.path);
  if (p === 'image') return pictureUrl(r.image, r.path);
  return pictureUrl(r.cover, r.path) || pictureUrl(r.image, r.path);
}

function listView(view, shown, props, o) {
  const list = el('div', 'db-list');
  const cols = visibleProps(view, props);
  for (const r of shown) {
    const row = el('div', 'db-list-row');
    row.append(r.icon ? iconNode(r) : el('span', 'db-card-icon', '•'), link(r));
    const box = el('span', 'db-list-props');
    for (const p of cols) {
      const v = r.values[p.name];
      if (v === null || v === undefined || v === '' || (Array.isArray(v) && !v.length)) continue;
      const c = cell('span', r, p, o);
      c.title = p.name;
      box.append(c);
    }
    row.append(box);
    list.append(row);
  }
  return list;
}

// Bars or a line: one point per group, or per day/week/month/year when the view has a `bucket` (then `group` is a date).
// Drawn in SVG attributes only (no style attributes, the page's CSP forbids them). Each point has a tooltip.
function chartEl(tag, attrs = {}, text = '') {
  const node = document.createElementNS(SVG, tag);
  for (const [k, v] of Object.entries(attrs)) node.setAttribute(k, String(v));
  if (text) node.textContent = text;
  return node;
}
function chartView(view, shown) {
  if (!view.group) return el('p', 'db-empty', 'Elige una propiedad en “Agrupar por”, en los ajustes (⚙).');
  const agg = AGGS.includes(view.agg) ? view.agg : 'count';
  const points = view.bucket
    ? bucketRows(shown, view.group, view.bucket, view.value, agg)
    : [...groupRows(shown, view.group)].map(([k, items]) => ({ label: k || 'Sin valor', value: aggregate(items, view.value, agg) }));
  if (!points.length) {
    return el('p', 'db-empty', view.bucket ? 'Ninguna nota tiene una fecha válida en esa propiedad.' : 'Ninguna nota tiene valor en esa propiedad.');
  }
  const max = Math.max(1, ...points.map((p) => p.value));
  const W = 600;
  const H = 240;
  const L = 44;
  const R = 12;
  const T = 12;
  const B = 30;
  const plotW = W - L - R;
  const plotH = H - T - B;
  const yOf = (v) => T + plotH - (v / max) * plotH;
  const xOf = (i) => (view.view === 'line' ? (points.length === 1 ? L + plotW / 2 : L + (i * plotW) / (points.length - 1)) : L + plotW * ((i + 0.5) / points.length));
  const total = points.reduce((s, p) => s + p.value, 0);
  const svg = chartEl('svg', {
    viewBox: `0 0 ${W} ${H}`,
    role: 'img',
    class: 'db-chart',
    'aria-label': `${view.view === 'line' ? 'Gráfico de líneas' : 'Gráfico de barras'}: ${points.length} ${view.bucket ? 'periodos' : 'grupos'}, total ${total.toLocaleString()}`,
  });
  // Horizontal guides at 0, half and the maximum, with their values.
  for (const v of [0, max / 2, max]) {
    svg.append(chartEl('line', { x1: L, x2: W - R, y1: yOf(v), y2: yOf(v), class: 'db-chart-grid' }));
    svg.append(chartEl('text', { x: L - 6, y: yOf(v) + 4, 'text-anchor': 'end', class: 'db-chart-tick' }, Number.isInteger(v) ? v.toLocaleString() : v.toFixed(1)));
  }
  const color = COLORS[0];
  if (view.view === 'line') {
    svg.append(chartEl('polyline', { points: points.map((p, i) => `${xOf(i)},${yOf(p.value)}`).join(' '), fill: 'none', stroke: color, 'stroke-width': 2, class: 'db-chart-line' }));
  }
  const band = plotW / points.length;
  points.forEach((p, i) => {
    const cx = xOf(i);
    const tip = chartEl('title', {}, `${p.label}: ${p.value.toLocaleString()}`);
    if (view.view === 'line') {
      const dot = chartEl('circle', { cx, cy: yOf(p.value), r: 3.5, fill: color });
      dot.append(tip);
      svg.append(dot);
    } else {
      const w = Math.max(4, band * 0.6);
      const h = (p.value / max) * plotH;
      const bar = chartEl('rect', { x: cx - w / 2, y: T + plotH - h, width: w, height: h, fill: color, rx: 2 });
      bar.append(tip);
      svg.append(bar);
    }
  });
  // As many labels as fit without touching (a date label is about 84 units wide), so long lists stay readable.
  const every = Math.ceil(points.length / Math.max(2, Math.floor(plotW / 84)));
  // A line starts and ends on the plot's edges: its end labels are aligned inwards so they are not cut off.
  points.forEach((p, i) => {
    if (i % every !== 0) return;
    const anchor = view.view !== 'line' || points.length === 1 ? 'middle' : i === 0 ? 'start' : i === points.length - 1 ? 'end' : 'middle';
    svg.append(chartEl('text', { x: xOf(i), y: H - 10, 'text-anchor': anchor, class: 'db-chart-tick' }, p.label));
  });
  const box = el('div', 'db-chart-box');
  box.append(svg);
  return box;
}

function numberView(view, shown) {
  const agg = AGGS.includes(view.agg) ? view.agg : 'count';
  const value = aggregate(shown, view.value, agg);
  const box = el('div', 'db-number');
  box.append(
    el('div', 'db-number-value', Number.isInteger(value) ? value.toLocaleString() : value.toFixed(1)),
    el('div', 'db-number-label', `${AGG_LABEL[agg]}${view.value && agg !== 'count' ? ` de ${view.value}` : ' de notas'}`),
  );
  return box;
}

function donutView(view, shown) {
  if (!view.group) return el('p', 'db-empty', 'Elige una propiedad en “Agrupar por”, en los ajustes (⚙).');
  const agg = AGGS.includes(view.agg) ? view.agg : 'count';
  const parts = [...groupRows(shown, view.group)].map(([k, items]) => [k || 'Sin valor', aggregate(items, view.value, agg)]).filter(([, n]) => n > 0);
  const total = parts.reduce((s, [, n]) => s + n, 0);
  const box = el('div', 'db-donut');
  const svg = document.createElementNS(SVG, 'svg');
  svg.setAttribute('viewBox', '0 0 42 42');
  svg.setAttribute('class', 'db-donut-svg');
  const r = 15.9155;
  let offset = 25;
  parts.forEach(([, n], i) => {
    const seg = document.createElementNS(SVG, 'circle');
    const len = total ? (n / total) * 100 : 0;
    for (const [k, v] of Object.entries({ cx: 21, cy: 21, r, fill: 'none', 'stroke-width': 6, 'stroke-dasharray': `${len} ${100 - len}`, 'stroke-dashoffset': offset, stroke: COLORS[i % COLORS.length] })) seg.setAttribute(k, v);
    svg.append(seg);
    offset -= len;
  });
  const center = document.createElementNS(SVG, 'text');
  for (const [k, v] of Object.entries({ x: 21, y: 22.5, 'text-anchor': 'middle', class: 'db-donut-total' })) center.setAttribute(k, v);
  center.textContent = Number.isInteger(total) ? total.toLocaleString() : total.toFixed(1);
  svg.append(center);
  const legend = el('div', 'db-legend');
  parts.forEach(([name, n], i) => {
    const item = el('div', 'db-legend-item');
    const dot = el('span', 'db-dot');
    dot.style.background = COLORS[i % COLORS.length]; // CSSOM
    item.append(dot, el('span', '', `${name} · ${n.toLocaleString()}`));
    legend.append(item);
  });
  box.append(svg, legend);
  return box;
}

// The ⚙ panel: every setting of one view. Each change is written into the block text at once.
function settingsEl(b, cfg, i, keys, ctx) {
  const v = cfg.views[i];
  const save_ = () => save(b, cfg, ctx);
  const panel = el('div', 'db-settings');
  const keyOpts = (none) => [...(none ? [['', 'Ninguna']] : []), ...keys.map((k) => [k, k])];

  const name = el('input', 'db-input');
  name.value = v.name;
  name.placeholder = VIEW_LABEL[v.view];
  name.setAttribute('aria-label', 'Nombre de la vista');
  name.addEventListener('change', () => {
    v.name = name.value.trim();
    save_();
  });
  panel.append(field('Nombre', name));
  panel.append(field('Tipo de vista', select(VIEW_TYPES.map((t) => [t, VIEW_LABEL[t]]), v.view, (x) => { v.view = x; save_(); }, 'Tipo de vista')));

  if (['table', 'list', 'gallery', 'board'].includes(v.view)) {
    const current = visibleProps(v, keys.map((k) => ({ name: k }))).map((p) => p.name);
    const props = el('div', 'db-checks');
    for (const k of keys) {
      const lab = el('label', 'db-check');
      const box = el('input');
      box.type = 'checkbox';
      box.checked = current.includes(k);
      box.addEventListener('change', () => {
        const next = keys.filter((x) => (x === k ? box.checked : current.includes(x)));
        v.show = next.length === keys.length && v.view === 'table' ? [] : next;
        save_();
      });
      lab.append(box, el('span', '', k));
      props.append(lab);
    }
    panel.append(el('div', 'db-set-label', 'Propiedades visibles'), props);
  }

  panel.append(el('div', 'db-set-label', 'Filtros'));
  v.filter.forEach((f, n) => {
    const row = el('div', 'db-filter');
    const valueInput = el('input', 'db-input');
    valueInput.value = f.value;
    valueInput.placeholder = 'valor';
    valueInput.setAttribute('aria-label', 'Valor del filtro');
    valueInput.addEventListener('change', () => {
      f.value = valueInput.value.trim();
      save_();
    });
    const noValue = f.op === 'empty' || f.op === '!empty';
    row.append(
      select(keyOpts(false), f.key, (x) => { f.key = x; save_(); }, 'Propiedad del filtro'),
      select(OPS.map((op) => [op, op]), f.op, (x) => { f.op = x; save_(); }, 'Operador del filtro'),
      noValue ? el('span') : valueInput,
      iconButton('trash', 'Quitar filtro', () => {
        v.filter.splice(n, 1);
        save_();
      }),
    );
    panel.append(row);
  });
  if (keys.length) {
    panel.append(button('db-tab', 'Añadir filtro', () => {
      v.filter.push({ key: keys[0], op: '=', value: '' });
      save_();
    }));
  }

  const sort = parseSort(v.sort);
  panel.append(field('Ordenar', select([['', 'Ninguno'], ['name', 'Nombre'], ...keys.map((k) => [k, k])], sort.key, (x) => {
    v.sort = x ? `${x} ${sort.dir}` : '';
    save_();
  }, 'Propiedad para ordenar')));
  if (v.sort) {
    panel.append(field('Orden', select([['asc', 'Ascendente'], ['desc', 'Descendente']], sort.dir, (x) => {
      v.sort = `${sort.key} ${x}`;
      save_();
    }, 'Sentido del orden')));
  }

  if (['board', 'donut', 'bar', 'line'].includes(v.view)) {
    panel.append(field('Agrupar por', select(keyOpts(true), v.group, (x) => { v.group = x; save_(); }, 'Agrupar por')));
  }
  if (['bar', 'line'].includes(v.view)) {
    const buckets = [['', 'Sin fechas (una barra por valor)'], ...BUCKETS.map((b) => [b, BUCKET_LABEL[b]])];
    panel.append(field('Intervalo', select(buckets, v.bucket || '', (x) => { v.bucket = x; save_(); }, 'Intervalo de fechas')));
  }
  if (['number', 'donut', 'bar', 'line'].includes(v.view)) {
    panel.append(field('Valor', select(keyOpts(true), v.value, (x) => { v.value = x; save_(); }, 'Propiedad del valor')));
    panel.append(field('Calcular', select(AGGS.map((a) => [a, AGG_LABEL[a]]), v.agg || 'count', (x) => { v.agg = x; save_(); }, 'Cálculo')));
  }
  if (v.view === 'gallery') {
    const previews = [['auto', 'Automática'], ['cover', 'Propiedad cover'], ['image', 'Primera imagen de la nota'], ['none', 'Sin imagen'], ...keys.map((k) => [`property:${k}`, `Propiedad: ${k}`])];
    panel.append(field('Imagen', select(previews, v.preview || 'auto', (x) => { v.preview = x; save_(); }, 'Imagen de la tarjeta')));
    panel.append(field('Tamaño', select([['small', 'Pequeño'], ['medium', 'Mediano'], ['large', 'Grande']], v.size || 'medium', (x) => { v.size = x; save_(); }, 'Tamaño de la tarjeta')));
    panel.append(field('Encaje', select([['crop', 'Recortar para llenar'], ['fit', 'Imagen entera']], v.fit || 'crop', (x) => { v.fit = x; save_(); }, 'Encaje de la imagen')));
  }

  const actions = el('div', 'db-set-actions');
  actions.append(
    button('db-tab', 'Duplicar vista', () => {
      cfg.views.splice(i + 1, 0, { ...v, filter: v.filter.map((f) => ({ ...f })), show: [...v.show] });
      b.activeView = i + 1;
      save_();
    }),
  );
  if (cfg.views.length > 1) {
    actions.append(
      button('db-tab', 'Borrar vista', () => {
        cfg.views.splice(i, 1);
        b.activeView = Math.max(0, i - 1);
        save_();
      }),
    );
  }
  panel.append(actions);
  return panel;
}
