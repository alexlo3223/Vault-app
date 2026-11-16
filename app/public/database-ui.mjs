// Database blocks in the editor: view tabs, the six views, and the ⚙ settings panel.
// Rules and parsing live in database.mjs. No inline style attributes (the page's CSP forbids them): sizes and
// colours are set through the CSSOM or SVG attributes.
import { icon } from './views.js';
import { isHttps } from './blocks.mjs';
import { AGGS, OPS, VIEW_TYPES, aggregate, cellValue, extractDatabase, filterRows, groupRows, newView, parseDb, serializeDb, sortRows } from './database.mjs';

const enc = encodeURIComponent;
const SVG = 'http://www.w3.org/2000/svg';
const COLORS = ['#ffc857', '#7ab8ff', '#6fd39a', '#ff6b6b', '#c79bff', '#ff9f5a', '#8ee3e3'];
const VIEW_LABEL = { table: 'Table', board: 'Board', gallery: 'Gallery', list: 'List', number: 'Number', donut: 'Donut' };
const VIEW_ICON = { table: 'table', board: 'board', gallery: 'grid', list: 'list', number: 'hash', donut: 'donut' };
const AGG_LABEL = { count: 'Count', sum: 'Sum', avg: 'Average', min: 'Minimum', max: 'Maximum' };

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

// A link to an image or file in the vault (through /api/file), or an https address; anything else is no picture.
const pictureUrl = (ref, from) => {
  if (typeof ref !== 'string' || !ref) return '';
  if (isHttps(ref)) return ref;
  return /^https?:/i.test(ref) ? '' : `/api/file?link=${enc(ref)}&from=${enc(from)}`;
};
const cellText = (v) => cellValue(v);
const isEditable = (v) => !Array.isArray(v);
const allKeys = (rows) => [...new Set(rows.flatMap((r) => Object.keys(r.props)))];
// With no "show:" setting, the first five properties are shown.
const shownKeys = (view, keys) => (view.show.length ? view.show : keys.slice(0, 5));

// The view index in use, kept in memory on the block (it is not written to the note).
const activeIndex = (b, cfg) => Math.min(b.activeView ?? 0, cfg.views.length - 1);

// Entry point: the whole database block. `ctx` supplies what the note editor owns:
// { rerender, changed, api, setStatus, setProp(path, key, value), createRow(source), editSource(b) }.
export function databaseEl(b, ctx) {
  const cfg = parseDb(b.text);
  if (cfg.page) return embedDb(b, cfg, ctx);
  const box = el('div', 'db');
  const head = el('div', 'db-head');
  head.append(el('span', 'eyebrow mono', `Database · ${cfg.source || 'no source yet'}`));
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
    iconButton('plus', 'Add a view', () => {
      cfg.views.push(newView('table'));
      b.activeView = cfg.views.length - 1;
      save(b, cfg, ctx);
    }),
    iconButton('settings', 'View settings', () => {
      b.settingsOpen = !b.settingsOpen;
      ctx.rerender();
    }),
    button('db-tab', 'Edit source', () => ctx.editSource(b)),
  );
  box.append(head);

  const body = el('div', 'db-body');
  box.append(body);
  if (!cfg.source) {
    body.append(el('p', 'db-empty', 'Set “source:” to the folder with the notes (Edit source).'));
    return box;
  }
  body.append(el('p', 'db-empty', 'Loading…'));
  ctx
    .api('GET', `/api/db?folder=${enc(cfg.source)}`)
    .then(({ rows }) => paint(body, b, cfg, current, rows, ctx))
    .catch((e) => body.replaceChildren(el('p', 'db-empty', e.message)));
  return box;
}

// An embed shows a database page. The page holds the settings (its own database block); this block only shows
// one of its views. Editing the views happens on the page, so the embed has no settings panel.
function embedDb(b, cfg, ctx) {
  const box = el('div', 'db');
  const head = el('div', 'db-head');
  head.append(el('span', 'eyebrow mono', `Database · ${cfg.page}`));
  const open = el('a', 'db-tab', 'Open database');
  open.href = `#/${enc(`${cfg.page}.md`)}`;
  head.append(open);
  box.append(head);
  const body = el('div', 'db-body', 'Loading…');
  box.append(body);
  ctx
    .api('GET', `/api/page?path=${enc(`${cfg.page}.md`)}`)
    .then(async (page) => {
      const text = extractDatabase(page.content);
      if (text === null) return body.replaceChildren(el('p', 'db-empty', 'This page has no database yet. Open it to add one.'));
      const target = parseDb(text);
      // `use:` pins the embed to one view of the page (no tabs); without it the embed offers every view as tabs.
      const pinned = cfg.use ? target.views.findIndex((v) => v.name === cfg.use) : -1;
      const current = pinned >= 0 ? pinned : Math.min(b.activeView ?? 0, target.views.length - 1);
      if (pinned < 0) {
        target.views.forEach((v, i) => {
          const tab = button(`db-tab${i === current ? ' active' : ''}`, v.name || VIEW_LABEL[v.view], () => {
            b.activeView = i;
            ctx.rerender();
          });
          tab.prepend(icon(VIEW_ICON[v.view], 13));
          head.append(tab);
        });
      }
      if (!target.source) return body.replaceChildren(el('p', 'db-empty', 'The database on that page has no source folder.'));
      const { rows } = await ctx.api('GET', `/api/db?folder=${enc(target.source)}`);
      paint(body, b, target, current, rows, ctx, { settings: false });
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

function paint(body, b, cfg, i, rows, ctx, { settings = true } = {}) {
  const view = cfg.views[i];
  const keys = allKeys(rows);
  const shown = sortRows(filterRows(rows, view.filter), view.sort);
  const act = (p) => p.then(ctx.rerender, (e) => ctx.setStatus(e.message));
  const parts = [];
  if (settings && b.settingsOpen) parts.push(settingsEl(b, cfg, i, keys, ctx));
  if (!rows.length) parts.push(el('p', 'db-empty', 'No notes in this folder yet. Use “+ New” to add one.'));
  else if (!shown.length) parts.push(el('p', 'db-empty', 'No notes match the filters of this view.'));
  else parts.push(viewContent(view, shown, keys, { ctx, act }));
  parts.push(button('db-tab db-new', '+ New', () => ctx.createRow(cfg.source).catch((e) => ctx.setStatus(e.message))));
  body.replaceChildren(...parts);
}

function viewContent(view, shown, keys, o) {
  switch (view.view) {
    case 'board':
      return boardView(view, shown, o);
    case 'gallery':
      return galleryView(view, shown, keys);
    case 'list':
      return listView(view, shown, keys);
    case 'number':
      return numberView(view, shown);
    case 'donut':
      return donutView(view, shown);
    default:
      return tableView(view, shown, keys, o);
  }
}

function link(r) {
  const a = el('a', 'db-card-title', r.name);
  a.href = `#/${enc(r.path)}`;
  return a;
}

function tableView(view, shown, keys, o) {
  const cols = shownKeys(view, keys);
  const table = el('table', 'db-table');
  const head = el('tr');
  head.append(el('th', '', 'Name'), ...cols.map((k) => el('th', '', k)));
  table.append(head);
  for (const r of shown) {
    const tr = el('tr');
    const name = el('td');
    name.append(link(r));
    tr.append(name);
    for (const k of cols) {
      const td = el('td');
      const v = r.props[k];
      if (!isEditable(v)) td.textContent = cellText(v);
      else {
        const input = el('input', 'db-input');
        input.value = cellText(v);
        input.setAttribute('aria-label', k);
        input.addEventListener('change', () => o.act(o.ctx.setProp(r.path, k, input.value.trim())));
        td.append(input);
      }
      tr.append(td);
    }
    table.append(tr);
  }
  return wrapScroll(table);
}

function wrapScroll(node) {
  const box = el('div', 'db-scroll');
  box.append(node);
  return box;
}

function boardView(view, shown, o) {
  if (!view.group) return el('p', 'db-empty', 'Choose a “Group by” property in the settings (⚙).');
  const groups = groupRows(shown, view.group);
  const values = [...groups.keys()];
  const board = el('div', 'db-board');
  for (const [value, items] of groups) {
    const col = el('div', 'db-col');
    col.append(el('div', 'db-col-head', `${value || 'No value'} · ${items.length}`));
    for (const r of items) {
      const card = el('div', 'db-card');
      const sel = select(
        values.map((v) => [v, v || 'No value']),
        value,
        (x) => o.act(o.ctx.setProp(r.path, view.group, x)),
        `Move ${r.name} to`,
      );
      card.append(link(r), sel);
      col.append(card);
    }
    board.append(col);
  }
  return board;
}

function galleryView(view, shown, keys) {
  const grid = el('div', `db-gallery db-size-${view.size || 'medium'}`);
  const fit = view.fit === 'fit' ? 'contain' : 'cover';
  const imageKey = (view.preview || '').replace('property:', '');
  const shownProps = (view.show.length ? view.show : keys.slice(0, 3)).filter((k) => k !== imageKey);
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
    if (r.icon) title.append(el('span', 'db-card-icon', r.icon));
    title.append(link(r));
    card.append(title);
    for (const k of shownProps) {
      const text = cellText(r.props[k]);
      if (text) card.append(el('div', 'db-card-prop', `${k}: ${text}`));
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

function listView(view, shown, keys) {
  const list = el('div', 'db-list');
  const cols = view.show.length ? view.show : keys.slice(0, 3);
  for (const r of shown) {
    const row = el('div', 'db-list-row');
    row.append(el('span', 'db-card-icon', r.icon || '•'), link(r));
    const props = el('span', 'db-list-props');
    for (const k of cols) {
      const text = cellText(r.props[k]);
      if (text) props.append(el('span', 'tag-chip', `${k}: ${text}`));
    }
    row.append(props);
    list.append(row);
  }
  return list;
}

function numberView(view, shown) {
  const agg = AGGS.includes(view.agg) ? view.agg : 'count';
  const value = aggregate(shown, view.value, agg);
  const box = el('div', 'db-number');
  box.append(
    el('div', 'db-number-value', Number.isInteger(value) ? value.toLocaleString() : value.toFixed(1)),
    el('div', 'db-number-label', `${AGG_LABEL[agg]}${view.value && agg !== 'count' ? ` of ${view.value}` : ' of notes'}`),
  );
  return box;
}

function donutView(view, shown) {
  if (!view.group) return el('p', 'db-empty', 'Choose a “Group by” property in the settings (⚙).');
  const agg = AGGS.includes(view.agg) ? view.agg : 'count';
  const parts = [...groupRows(shown, view.group)].map(([k, items]) => [k || 'No value', aggregate(items, view.value, agg)]).filter(([, n]) => n > 0);
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
  const keyOpts = (none) => [...(none ? [['', 'None']] : []), ...keys.map((k) => [k, k])];

  const name = el('input', 'db-input');
  name.value = v.name;
  name.placeholder = VIEW_LABEL[v.view];
  name.setAttribute('aria-label', 'View name');
  name.addEventListener('change', () => {
    v.name = name.value.trim();
    save_();
  });
  panel.append(field('Name', name));
  panel.append(field('Layout', select(VIEW_TYPES.map((t) => [t, VIEW_LABEL[t]]), v.view, (x) => { v.view = x; save_(); }, 'Layout')));

  if (['table', 'list', 'gallery'].includes(v.view)) {
    const current = shownKeys(v, keys);
    const props = el('div', 'db-checks');
    for (const k of keys) {
      const lab = el('label', 'db-check');
      const box = el('input');
      box.type = 'checkbox';
      box.checked = current.includes(k);
      box.addEventListener('change', () => {
        const next = keys.filter((x) => (x === k ? box.checked : current.includes(x)));
        v.show = next.length === keys.length ? [] : next;
        save_();
      });
      lab.append(box, el('span', '', k));
      props.append(lab);
    }
    panel.append(el('div', 'db-set-label', 'Shown properties'), props);
  }

  panel.append(el('div', 'db-set-label', 'Filters'));
  v.filter.forEach((f, n) => {
    const row = el('div', 'db-filter');
    const valueInput = el('input', 'db-input');
    valueInput.value = f.value;
    valueInput.placeholder = 'value';
    valueInput.setAttribute('aria-label', 'Filter value');
    valueInput.addEventListener('change', () => {
      f.value = valueInput.value.trim();
      save_();
    });
    const noValue = f.op === 'empty' || f.op === '!empty';
    row.append(
      select(keyOpts(false), f.key, (x) => { f.key = x; save_(); }, 'Filter property'),
      select(OPS.map((o) => [o, o]), f.op, (x) => { f.op = x; save_(); }, 'Filter operator'),
      noValue ? el('span') : valueInput,
      iconButton('trash', 'Remove filter', () => {
        v.filter.splice(n, 1);
        save_();
      }),
    );
    panel.append(row);
  });
  if (keys.length) {
    panel.append(button('db-tab', 'Add filter', () => {
      v.filter.push({ key: keys[0], op: '=', value: '' });
      save_();
    }));
  }

  panel.append(field('Sort', select([['', 'None'], ['name', 'Name'], ...keys.map((k) => [k, k])], v.sort.split(' ')[0] ?? '', (x) => {
    v.sort = x ? `${x} ${v.sort.split(' ')[1] === 'desc' ? 'desc' : 'asc'}` : '';
    save_();
  }, 'Sort property')));
  if (v.sort) {
    panel.append(field('Order', select([['asc', 'Ascending'], ['desc', 'Descending']], v.sort.split(' ')[1] ?? 'asc', (x) => {
      v.sort = `${v.sort.split(' ')[0]} ${x}`;
      save_();
    }, 'Sort order')));
  }

  if (['board', 'donut'].includes(v.view)) {
    panel.append(field('Group by', select(keyOpts(true), v.group, (x) => { v.group = x; save_(); }, 'Group by')));
  }
  if (['number', 'donut'].includes(v.view)) {
    panel.append(field('Value', select(keyOpts(true), v.value, (x) => { v.value = x; save_(); }, 'Value property')));
    panel.append(field('Calculate', select(AGGS.map((a) => [a, AGG_LABEL[a]]), v.agg || 'count', (x) => { v.agg = x; save_(); }, 'Calculation')));
  }
  if (v.view === 'gallery') {
    const previews = [['auto', 'Automatic'], ['cover', 'Cover property'], ['image', 'First image in note'], ['none', 'No image'], ...keys.map((k) => [`property:${k}`, `Property: ${k}`])];
    panel.append(field('Image', select(previews, v.preview || 'auto', (x) => { v.preview = x; save_(); }, 'Card image')));
    panel.append(field('Size', select([['small', 'Small'], ['medium', 'Medium'], ['large', 'Large']], v.size || 'medium', (x) => { v.size = x; save_(); }, 'Card size')));
    panel.append(field('Fit', select([['crop', 'Crop to fill'], ['fit', 'Fit whole picture']], v.fit || 'crop', (x) => { v.fit = x; save_(); }, 'Image fit')));
  }

  const actions = el('div', 'db-set-actions');
  actions.append(
    button('db-tab', 'Duplicate view', () => {
      cfg.views.splice(i + 1, 0, { ...v, filter: v.filter.map((f) => ({ ...f })), show: [...v.show] });
      b.activeView = i + 1;
      save_();
    }),
  );
  if (cfg.views.length > 1) {
    actions.append(
      button('db-tab', 'Delete view', () => {
        cfg.views.splice(i, 1);
        b.activeView = Math.max(0, i - 1);
        save_();
      }),
    );
  }
  panel.append(actions);
  return panel;
}
