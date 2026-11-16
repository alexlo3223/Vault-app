// Typed database properties in the page: how each value looks, the editors that change it, and the menus that add,
// configure, rename and delete properties (like Notion's). Shared by the database views and a row's property panel.
// No inline style attributes (the page's CSP forbids them): sizes go through the CSSOM, colours through classes.
import { icon } from './views.js';
import { FUNCTIONS, formatDate, toDate, valueType } from './formula.mjs';
import { CALCS, COLORS, DISPLAYS, FORMATS, TYPE, TYPES, barFraction, formatNumber, hasOptions, newProp, nextColor, validPropName } from './properties.mjs';

const SVG = 'http://www.w3.org/2000/svg';
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
const select = (options, value, onChange, label) => {
  const s = el('select', 'db-select');
  s.setAttribute('aria-label', label);
  for (const [v, text] of options) s.append(new Option(text, v));
  s.value = value;
  s.addEventListener('change', () => onChange(s.value));
  return s;
};
const row = (label, control) => {
  const r = el('label', 'pm-row');
  r.append(el('span', 'pm-label', label), control);
  return r;
};
const same = (a, b) => a.toLowerCase() === b.toLowerCase();

export const typeIcon = (type, size = 14) => icon(TYPE[type]?.icon ?? 'text', size);

// ---------- popover: one floating panel at a time ----------
let pop = null;
const closeHooks = [];
// Others can ask to be told when a panel closes (database-ui.mjs puts the keyboard back on the edited cell).
export const onPopoverClose = (fn) => closeHooks.push(fn);
export const popoverOpen = () => !!pop;
export function closePop() {
  if (!pop) return;
  const { node, anchor, onClose } = pop;
  pop = null;
  node.remove();
  document.removeEventListener('mousedown', outside, true);
  document.removeEventListener('keydown', escape, true);
  onClose?.();
  // The keyboard goes back to what opened the panel, if it is still on the page (a redraw may have replaced it).
  if (anchor?.isConnected && anchor.focus) anchor.focus({ preventScroll: true });
  for (const f of closeHooks) f();
}
function outside(e) {
  if (pop && !pop.node.contains(e.target) && !e.target.closest?.('dialog')) closePop();
}
function escape(e) {
  if (e.key === 'Escape' && pop) {
    e.preventDefault();
    e.stopPropagation();
    pop.onClose = null; // Esc cancels: nothing is saved
    closePop();
  }
}

export function popover(anchor, cls = '') {
  closePop();
  const node = el('div', `pop glass ${cls}`.trim());
  document.body.append(node);
  pop = { node, anchor, onClose: null };
  // Opened by a click: wait until that click is over, or it would count as a click outside.
  setTimeout(() => {
    document.addEventListener('mousedown', outside, true);
    document.addEventListener('keydown', escape, true);
  });
  const place = () => {
    // The view under the panel may have been redrawn (a value was saved): then the panel stays where it is.
    if (!anchor.isConnected && node.style.top) return;
    const r = anchor.getBoundingClientRect();
    const w = node.offsetWidth;
    const h = node.offsetHeight;
    const below = r.bottom + 4;
    node.style.left = `${Math.max(8, Math.min(r.left, innerWidth - w - 8))}px`;
    node.style.top = `${below + h > innerHeight - 8 ? Math.max(8, r.top - 4 - h) : below}px`;
  };
  return { node, place, onClose: (fn) => pop && pop.node === node && (pop.onClose = fn), close: closePop };
}

// ---------- values ----------
const chip = (text, color = 'gray', cls = '') => el('span', `chip c-${COLORS.includes(color) ? color : 'gray'} ${cls}`.trim(), text);
const optionColor = (prop, name) => prop.options?.find((o) => same(o.name, name))?.color ?? 'gray';

function numberEl(n, prop) {
  const box = el('span', 'pv-number');
  const text = formatNumber(n, prop);
  const display = DISPLAYS.includes(prop.display) ? prop.display : 'number';
  if (display === 'number') {
    box.textContent = text;
    return box;
  }
  const color = COLORS.includes(prop.color) ? prop.color : 'green';
  const frac = barFraction(n, prop);
  box.classList.add(`pv-${display}`, `c-${color}`);
  if (prop.numbers !== 'hide') box.append(el('span', 'pv-num-text', text));
  if (display === 'bar') {
    const track = el('span', 'pv-track');
    const fill = el('span', 'pv-fill');
    fill.style.width = `${frac * 100}%`; // CSSOM
    track.append(fill);
    box.append(track);
  } else {
    const svg = document.createElementNS(SVG, 'svg');
    svg.setAttribute('viewBox', '0 0 20 20');
    svg.setAttribute('class', 'pv-ring-svg');
    const circle = (cls, dash) => {
      const c = document.createElementNS(SVG, 'circle');
      for (const [k, v] of Object.entries({ cx: 10, cy: 10, r: 7, fill: 'none', 'stroke-width': 3, class: cls, 'stroke-dasharray': dash, transform: 'rotate(-90 10 10)', 'stroke-linecap': 'round' })) c.setAttribute(k, v);
      return c;
    };
    const len = 2 * Math.PI * 7;
    svg.append(circle('pv-ring-track', `${len} 0`), circle('pv-ring-fill', `${frac * len} ${len}`));
    box.prepend(svg);
  }
  return box;
}

const isDate = (v) => v instanceof Date;
const dateText = (d, withTime) => formatDate(d, withTime || d.getHours() || d.getMinutes() ? 'MMM D, YYYY HH:mm' : 'MMM D, YYYY');

// How a value looks. opts: { error, open(name), empty: text shown when there is no value }.
export function valueEl(prop, value, opts = {}) {
  const box = el('span', `pv pv-${prop.type}`);
  const empty = () => {
    if (opts.empty) box.append(el('span', 'pv-empty', opts.empty));
    return box;
  };
  if (opts.error) {
    const e = el('span', 'pv-error', '⚠ Error');
    e.title = opts.error;
    box.append(e);
    return box;
  }
  const t = prop.type;
  if (t === 'checkbox' || (typeof value === 'boolean' && (t === 'formula' || t === 'rollup'))) {
    box.append(el('span', `pv-check${value ? ' on' : ''}`, value ? '✓' : ''));
    return box;
  }
  if (value === null || value === undefined || value === '' || (Array.isArray(value) && !value.length)) return empty();
  switch (t) {
    case 'select':
      box.append(chip(String(value), optionColor(prop, String(value))));
      return box;
    case 'status': {
      const c = chip(String(value), optionColor(prop, String(value)), 'chip-status');
      c.prepend(el('span', 'chip-dot'));
      box.append(c);
      return box;
    }
    case 'multi-select':
      for (const v of value) box.append(chip(v, optionColor(prop, v)));
      return box;
    case 'relation':
      for (const name of value) {
        const a = el('a', 'chip c-gray chip-link', name.split('/').pop());
        a.href = '#';
        a.title = name;
        a.addEventListener('click', (e) => {
          e.preventDefault();
          e.stopPropagation();
          opts.open?.(name);
        });
        a.prepend(icon('file', 11));
        box.append(a);
      }
      return box;
    case 'url': {
      const a = el('a', 'pv-link', String(value).replace(/^https?:\/\/(www\.)?/, ''));
      a.href = /^https?:\/\//i.test(value) ? value : `https://${value}`;
      a.target = '_blank';
      a.rel = 'noopener noreferrer';
      a.addEventListener('click', (e) => e.stopPropagation());
      box.append(a);
      return box;
    }
    case 'email':
    case 'phone': {
      const a = el('a', 'pv-link', String(value));
      a.href = `${t === 'email' ? 'mailto' : 'tel'}:${String(value).replace(t === 'phone' ? /[^\d+]/g : /\s/g, '')}`;
      a.addEventListener('click', (e) => e.stopPropagation());
      box.append(a);
      return box;
    }
    case 'date':
    case 'created':
    case 'edited':
      if (isDate(value)) box.append(el('span', 'pv-date', dateText(value, t !== 'date')));
      else {
        // Text in a date property that is not a date: shown as it is, marked, so it can be corrected.
        const bad = el('span', 'pv-date pv-bad', String(value));
        bad.title = 'No es una fecha válida: usa AAAA-MM-DD o DD/MM/AAAA';
        box.append(bad);
      }
      return box;
    case 'number':
      if (typeof value === 'string') {
        const bad = el('span', 'pv-text pv-bad', value);
        bad.title = 'No es un número válido';
        box.append(bad);
      } else box.append(numberEl(value, prop));
      return box;
    default:
      break;
  }
  // text, or what a formula / rollup gives back
  if (typeof value === 'number') box.append(numberEl(value, prop));
  else if (isDate(value)) box.append(el('span', 'pv-date', dateText(value)));
  else if (Array.isArray(value)) for (const v of value) box.append(chip(isDate(v) ? dateText(v) : String(v)));
  else box.append(el('span', 'pv-text', String(value)));
  return box;
}

// ---------- editing one value ----------
// h: { save(value), addOption(name) → Promise (adds it to the schema), loadRelated() → Promise<rows> }
export function editValue(anchor, prop, value, h) {
  const t = prop.type;
  if (!TYPE[t] || TYPE[t].stored === false) return;
  if (t === 'checkbox') return h.save(!value);
  if (hasOptions(t)) return optionPicker(anchor, prop, value, h);
  if (t === 'relation') return relationPicker(anchor, prop, value, h);
  if (t === 'date') return dateEditor(anchor, value, h);

  const p = popover(anchor, 'pop-edit');
  const input = el(t === 'text' ? 'textarea' : 'input', 'pop-input');
  if (t === 'number') {
    input.type = 'number';
    input.step = 'any';
  } else if (t === 'url') input.type = 'url';
  else if (t === 'email') input.type = 'email';
  else if (t === 'phone') input.type = 'tel';
  input.value = value === null || value === undefined ? '' : String(value);
  // What the field really holds: a number field shows nothing for a text such as "0x10", and merely opening and
  // closing it must not clear that value.
  const start = input.value;
  input.setAttribute('aria-label', prop.name);
  if (t === 'text') input.rows = Math.min(8, Math.max(2, start.split('\n').length));
  const commit = () => {
    if (input.value !== start) h.save(t === 'number' ? (input.value === '' ? null : Number(input.value)) : input.value.trim());
  };
  input.addEventListener('keydown', (e) => {
    // Enter saves (Shift+Enter is a new line in a text); Tab saves too and leaves the panel.
    if ((e.key === 'Enter' && !e.shiftKey) || e.key === 'Tab') {
      e.preventDefault();
      p.close();
    }
  });
  p.node.append(input);
  if (start) {
    p.node.append(
      button('pop-link', 'Clear', () => {
        input.value = '';
        p.close();
      }),
    );
  }
  p.onClose(commit);
  p.place();
  input.focus();
  if (input.select) input.select();
}

// ---------- dates ----------
const dateInputText = (d) => formatDate(d, d.getHours() || d.getMinutes() ? 'YYYY-MM-DD HH:mm' : 'YYYY-MM-DD');
const startOfToday = () => {
  const d = new Date();
  return new Date(d.getFullYear(), d.getMonth(), d.getDate());
};

// A date is typed as text, so a half-typed year is never taken for a date (the native date field reports 0002-11-16
// after the first digit of the year, which used to save at once). Valid dates are shown back in words as you type, so
// 16/11/2026 is seen to mean 16 Nov 2026; only a complete, real date is ever saved.
function dateEditor(anchor, value, h) {
  const p = popover(anchor, 'pop-edit pop-date');
  const start = isDate(value) ? dateInputText(value) : value ? String(value) : '';
  const input = el('input', 'pop-input');
  input.type = 'text';
  input.autocomplete = 'off';
  input.value = start;
  input.placeholder = 'AAAA-MM-DD';
  input.setAttribute('aria-label', 'Fecha');
  const note = el('div', 'pop-hint pop-date-note');
  const msg = el('div', 'pop-msg');

  const parse = () => {
    const s = input.value.trim();
    if (!s) return { empty: true };
    if (/^(hoy|today)$/i.test(s)) return { date: startOfToday() };
    const date = toDate(s);
    return date ? { date } : { error: true };
  };
  const showNote = () => {
    const r = parse();
    msg.textContent = '';
    note.textContent = r.date ? `Se guardará: ${formatDate(r.date, r.date.getHours() || r.date.getMinutes() ? 'D MMM YYYY HH:mm' : 'D MMM YYYY')}` : r.empty ? 'AAAA-MM-DD · DD/MM/AAAA · hoy · con hora: 16/11/2026 14:30' : '';
  };
  // Saves when the panel closes (Enter, Tab, a click outside). Text that is not a date is not saved.
  const commit = () => {
    const r = parse();
    if (r.error) return;
    if (r.empty) return void (start && h.save(null));
    if (dateInputText(r.date) !== start) h.save(r.date);
  };
  // A choice made with a button replaces the text and closes at once, without the commit above.
  const finish = (date) => {
    p.onClose(null);
    h.save(date);
    p.close();
  };
  const leave = () => {
    if (parse().error) {
      msg.textContent = 'Escribe la fecha como 2026-11-16 o 16/11/2026 (día primero); la hora, si quieres, como 14:30';
      note.textContent = '';
      return;
    }
    p.close();
  };

  input.addEventListener('input', showNote);
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' || e.key === 'Tab') {
      e.preventDefault();
      leave();
    }
  });

  // The native calendar, for picking with the mouse; its day replaces the date and keeps the time of day.
  const native = el('input', 'pop-native');
  native.type = 'date';
  native.tabIndex = -1;
  native.setAttribute('aria-hidden', 'true');
  native.addEventListener('change', () => {
    const picked = toDate(native.value);
    if (!picked || picked.getFullYear() < 1000) return;
    const cur = parse().date;
    if (cur && (cur.getHours() || cur.getMinutes())) picked.setHours(cur.getHours(), cur.getMinutes());
    finish(picked);
  });
  const calendar = button('pop-link', 'Calendario', () => {
    const cur = parse().date;
    native.value = cur ? formatDate(cur, 'YYYY-MM-DD') : '';
    if (native.showPicker) native.showPicker();
    else native.focus();
  });

  const row = el('div', 'pop-date-actions');
  row.append(
    button('pop-link', 'Hoy', () => finish(startOfToday())),
    calendar,
    button('pop-link', 'Borrar', () => finish(null)),
  );
  p.node.append(input, note, msg, row, native);
  p.onClose(commit);
  showNote();
  p.place();
  input.focus();
  input.select();
}

function optionPicker(anchor, prop, value, h) {
  prop = { ...prop, options: [...(prop.options ?? [])] }; // a copy: the schema is only changed through h.addOption
  const multi = prop.type === 'multi-select';
  let chosen = multi ? [...(value ?? [])] : value ? [String(value)] : [];
  const p = popover(anchor, 'pop-options');
  const search = el('input', 'pop-input');
  search.placeholder = multi ? 'Search or create options…' : 'Search or create an option…';
  search.setAttribute('aria-label', 'Option');
  const picked = el('div', 'pop-chips');
  const list = el('div', 'pop-list');
  let active = 0;
  let items = [];

  const choose = async (name, isNew) => {
    if (isNew) {
      await h.addOption(name);
      if (!prop.options.some((o) => same(o.name, name))) prop.options = [...prop.options, { name, color: nextColor(prop.options) }];
    }
    if (multi) {
      chosen = chosen.some((c) => same(c, name)) ? chosen.filter((c) => !same(c, name)) : [...chosen, name];
      h.save(chosen);
      search.value = '';
      draw();
      search.focus();
    } else {
      h.save(chosen.some((c) => same(c, name)) ? '' : name);
      p.close();
    }
  };

  function draw() {
    picked.replaceChildren(
      ...chosen.map((name) => {
        const c = chip(name, optionColor(prop, name));
        const x = button('chip-x', '×', () => {
          chosen = chosen.filter((n) => n !== name);
          h.save(multi ? chosen : '');
          draw();
        }, `Remove ${name}`);
        c.append(x);
        return c;
      }),
    );
    picked.hidden = !chosen.length;
    const q = search.value.trim();
    const matches = prop.options.filter((o) => o.name.toLowerCase().includes(q.toLowerCase()));
    items = matches.map((o) => ({ name: o.name, isNew: false }));
    if (q && !prop.options.some((o) => same(o.name, q)) && validOption(q)) items.push({ name: q, isNew: true });
    active = Math.min(active, Math.max(0, items.length - 1));
    list.replaceChildren(
      ...items.map((it, i) => {
        const r = el('div', `pop-item${i === active ? ' active' : ''}`);
        if (it.isNew) r.append(el('span', 'pop-hint', 'Create'), chip(it.name, nextColor(prop.options)));
        else {
          r.append(chip(it.name, optionColor(prop, it.name)));
          if (chosen.some((c) => same(c, it.name))) r.append(el('span', 'pop-tick', '✓'));
        }
        r.addEventListener('mousedown', (e) => {
          e.preventDefault();
          choose(it.name, it.isNew);
        });
        return r;
      }),
    );
    if (!items.length) list.append(el('div', 'pop-empty', q ? 'Option names can’t contain , = or new lines' : 'Type to create the first option'));
    p.place();
  }
  search.addEventListener('input', () => {
    active = 0;
    draw();
  });
  search.addEventListener('keydown', (e) => {
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      active = (active + (e.key === 'ArrowDown' ? 1 : -1) + items.length) % Math.max(1, items.length);
      draw();
    } else if (e.key === 'Enter' && items[active]) {
      e.preventDefault();
      choose(items[active].name, items[active].isNew);
    } else if (e.key === 'Backspace' && !search.value && chosen.length) {
      chosen = chosen.slice(0, -1);
      h.save(multi ? chosen : '');
      draw();
    }
  });
  p.node.append(picked, search, list);
  draw();
  search.focus();
}
const validOption = (name) => !/[,=\n\r]/.test(name) && name.length <= 100;

function relationPicker(anchor, prop, value, h) {
  let chosen = [...(value ?? [])];
  const p = popover(anchor, 'pop-options');
  if (!prop.relation) {
    p.node.append(el('div', 'pop-empty', 'Choose the related database first: click the property name → Related database.'));
    p.place();
    return;
  }
  const search = el('input', 'pop-input');
  search.placeholder = 'Search pages…';
  search.setAttribute('aria-label', 'Search pages');
  const list = el('div', 'pop-list');
  let rows = [];
  const has = (r) => chosen.some((c) => same(c, r.name) || same(c, r.path.slice(0, -3)));
  const draw = () => {
    const q = search.value.trim().toLowerCase();
    const shown = rows.filter((r) => r.name.toLowerCase().includes(q)).slice(0, 100);
    list.replaceChildren(
      ...shown.map((r) => {
        const item = el('div', 'pop-item');
        item.append(icon('file', 13), el('span', 'pop-label', r.name));
        if (has(r)) item.append(el('span', 'pop-tick', '✓'));
        item.addEventListener('mousedown', (e) => {
          e.preventDefault();
          chosen = has(r) ? chosen.filter((c) => !(same(c, r.name) || same(c, r.path.slice(0, -3)))) : [...chosen, r.name];
          h.save(chosen);
          draw();
        });
        return item;
      }),
    );
    if (!shown.length) list.append(el('div', 'pop-empty', rows.length ? 'No pages match' : 'That database has no pages yet'));
    p.place();
  };
  search.addEventListener('input', draw);
  p.node.append(search, list);
  list.append(el('div', 'pop-empty', 'Loading…'));
  p.place();
  search.focus();
  h.loadRelated()
    .then((r) => {
      rows = r;
      draw();
    })
    .catch((e) => list.replaceChildren(el('div', 'pop-empty', e.message)));
}

// ---------- adding a property ----------
// h: { names: existing names, create(name, type) }
export function addPropertyMenu(anchor, h) {
  const p = popover(anchor, 'pop-add');
  const name = el('input', 'pop-input');
  name.placeholder = 'Property name';
  name.setAttribute('aria-label', 'Property name');
  const msg = el('div', 'pop-msg');
  const list = el('div', 'pop-list');
  list.append(el('div', 'pop-section', 'Type'));
  const create = (type) => {
    let n = name.value.trim() || TYPE[type].label;
    if (!validPropName(n)) return void (msg.textContent = 'Names can’t contain : , = [ ] # | " { }');
    const base = n;
    for (let i = 2; h.names.some((x) => same(x, n)); i++) n = `${base} ${i}`;
    p.close();
    h.create(n, type);
  };
  const rows = [];
  for (const t of TYPES) {
    const item = el('div', 'pop-item');
    item.append(typeIcon(t.type), el('span', 'pop-label', t.label));
    item.addEventListener('mousedown', (e) => {
      e.preventDefault();
      create(t.type);
    });
    list.append(item);
    rows.push(item);
  }
  // Keyboard: ↑/↓ highlight a type, Enter creates the property with it (no highlight: a Text).
  let active = -1;
  const mark = () => {
    rows.forEach((r, i) => r.classList.toggle('active', i === active));
    rows[active]?.scrollIntoView({ block: 'nearest' });
  };
  name.addEventListener('keydown', (e) => {
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      const step = e.key === 'ArrowDown' ? 1 : -1;
      active = active < 0 ? (step > 0 ? 0 : rows.length - 1) : (active + step + rows.length) % rows.length;
      mark();
    } else if (e.key === 'Enter') {
      e.preventDefault();
      create(active >= 0 ? TYPES[active].type : 'text');
    }
  });
  p.node.append(name, msg, list);
  p.place();
  name.focus();
}

// ---------- configuring a property ----------
// h: { props: the schema, update(next, previousName), rename(newName) → Promise, remove() → Promise,
//      hide?(), databases() → Promise<[{ source, name }]>, editFormula(prop) }
export function propertyMenu(anchor, prop, h) {
  let cur = structuredClone(prop);
  delete cur.inferred;
  const p = popover(anchor, 'pop-prop');
  const apply = () => h.update(structuredClone(cur), prop.name);

  const draw = () => {
    p.node.replaceChildren();
    // name
    const head = el('div', 'pm-head');
    const name = el('input', 'pop-input');
    name.value = cur.name;
    name.setAttribute('aria-label', 'Property name');
    const msg = el('div', 'pop-msg');
    const rename = async () => {
      const next = name.value.trim();
      if (next === cur.name) return;
      if (!validPropName(next)) return void (msg.textContent = 'Names can’t contain : , = [ ] # | " { }');
      if (h.props.some((x) => same(x.name, next) && !same(x.name, cur.name))) return void (msg.textContent = 'Another property has that name');
      try {
        await h.rename(next);
        prop = { ...prop, name: next };
        cur.name = next;
        msg.textContent = '';
      } catch (e) {
        msg.textContent = e.message;
      }
    };
    name.addEventListener('change', rename);
    name.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        name.blur();
      }
    });
    const ic = el('span', 'pm-icon');
    ic.append(typeIcon(cur.type, 16));
    head.append(ic, name);
    p.node.append(head, msg);

    // type
    p.node.append(
      row(
        'Type',
        select(TYPES.map((t) => [t.type, t.label]), cur.type, (x) => {
          const fresh = newProp(cur.name, x);
          cur = { ...cur, type: x, options: hasOptions(x) && !cur.options.length ? fresh.options : cur.options, calc: cur.calc || fresh.calc };
          apply();
          draw();
        }, 'Property type'),
      ),
    );

    if (hasOptions(cur.type)) p.node.append(optionsEditor(cur, apply, draw));

    if (cur.type === 'formula') {
      const box = el('div', 'pm-formula');
      box.append(el('code', 'pm-code', cur.formula || 'No formula yet'));
      box.append(button('db-tab', 'Edit formula', () => {
        closePop();
        h.editFormula(cur);
      }));
      p.node.append(box);
    }

    if (cur.type === 'relation') {
      const sel = select([['', 'Loading…']], '', () => {}, 'Related database');
      p.node.append(row('Related database', sel));
      h.databases().then((dbs) => {
        sel.replaceChildren(new Option('Choose…', ''), ...dbs.map((d) => new Option(d.name, d.source)));
        sel.value = cur.relation;
        if (cur.relation && sel.value !== cur.relation) sel.append(new Option(cur.relation, cur.relation));
        sel.value = cur.relation;
        sel.onchange = () => {
          cur.relation = sel.value;
          apply();
        };
      }).catch(() => sel.replaceChildren(new Option('Could not load databases', '')));
    }

    if (cur.type === 'rollup') {
      const rels = h.props.filter((x) => x.type === 'relation');
      p.node.append(
        row('Relation', select([['', rels.length ? 'Choose…' : 'Add a Relation property first'], ...rels.map((x) => [x.name, x.name])], cur.rollup, (x) => {
          cur.rollup = x;
          apply();
        }, 'Relation')),
      );
      const target = el('input', 'pop-input');
      target.value = cur.target;
      target.placeholder = 'Name';
      target.setAttribute('aria-label', 'Property of the related pages');
      target.addEventListener('change', () => {
        cur.target = target.value.trim();
        apply();
      });
      p.node.append(row('Property', target));
      p.node.append(row('Calculate', select(CALCS, cur.calc || 'count', (x) => {
        cur.calc = x;
        apply();
      }, 'Calculate')));
    }

    if (cur.type === 'number' || cur.type === 'formula' || cur.type === 'rollup') p.node.append(numberSettings(cur, apply, draw));

    // actions
    const acts = el('div', 'pm-actions');
    if (h.hide) acts.append(button('pm-action', 'Hide in this view', () => {
      closePop();
      h.hide();
    }));
    let armed = false;
    const del = button('pm-action pm-danger', 'Delete property', async () => {
      if (!armed) {
        armed = true;
        del.textContent = 'Click again to delete it from every page';
        return;
      }
      closePop();
      await h.remove();
    });
    acts.append(del);
    p.node.append(acts);
    p.place();
  };
  draw();
}

function optionsEditor(cur, apply, redraw) {
  const box = el('div', 'pm-options');
  box.append(el('div', 'pop-section', 'Options'));
  cur.options.forEach((o, i) => {
    const r = el('div', 'pm-option');
    const name = el('input', 'pop-input');
    name.value = o.name;
    name.setAttribute('aria-label', 'Option name');
    name.addEventListener('change', () => {
      const v = name.value.trim();
      if (!v || !validOption(v)) return void (name.value = o.name);
      o.name = v;
      apply();
    });
    const color = select(COLORS.map((c) => [c, c[0].toUpperCase() + c.slice(1)]), o.color, (c) => {
      o.color = c;
      apply();
      redraw();
    }, 'Option color');
    const dot = el('span', `chip c-${o.color} pm-swatch`);
    r.append(dot, name, color, button('chip-x', '×', () => {
      cur.options.splice(i, 1);
      apply();
      redraw();
    }, `Remove ${o.name}`));
    box.append(r);
  });
  const add = el('input', 'pop-input');
  add.placeholder = 'Add an option…';
  add.setAttribute('aria-label', 'New option');
  add.addEventListener('keydown', (e) => {
    if (e.key !== 'Enter') return;
    e.preventDefault();
    const v = add.value.trim();
    if (!v || !validOption(v) || cur.options.some((x) => same(x.name, v))) return;
    cur.options.push({ name: v, color: nextColor(cur.options) });
    apply();
    redraw();
  });
  box.append(add);
  return box;
}

function numberSettings(cur, apply, redraw) {
  const box = el('div', 'pm-number');
  box.append(row('Number format', select(FORMATS, cur.format || 'number', (x) => {
    cur.format = x === 'number' ? '' : x;
    apply();
  }, 'Number format')));
  box.append(row('Decimal places', select([['', 'Default'], ...[0, 1, 2, 3, 4].map((n) => [String(n), String(n)])], cur.decimals, (x) => {
    cur.decimals = x;
    apply();
  }, 'Decimal places')));
  box.append(el('div', 'pop-section', 'Show as'));
  const seg = el('div', 'pm-seg');
  for (const d of DISPLAYS) {
    const b = button(`pm-seg-btn${(cur.display || 'number') === d ? ' active' : ''}`, d === 'number' ? '42 Number' : d === 'bar' ? 'Bar' : 'Ring', () => {
      cur.display = d === 'number' ? '' : d;
      apply();
      redraw();
    });
    seg.append(b);
  }
  box.append(seg);
  if (cur.display === 'bar' || cur.display === 'ring') {
    box.append(row('Color', select(COLORS.map((c) => [c, c[0].toUpperCase() + c.slice(1)]), cur.color || 'green', (x) => {
      cur.color = x;
      apply();
    }, 'Color')));
    const max = el('input', 'pop-input');
    max.type = 'number';
    max.step = 'any';
    max.min = '0';
    max.value = cur.max;
    max.placeholder = cur.format === 'percent' ? '1 (100%)' : '100';
    max.setAttribute('aria-label', 'Divide by');
    max.addEventListener('change', () => {
      cur.max = Number(max.value) > 0 ? String(Number(max.value)) : '';
      apply();
    });
    box.append(row('Divide by', max));
    const show = el('input');
    show.type = 'checkbox';
    show.checked = cur.numbers !== 'hide';
    show.addEventListener('change', () => {
      cur.numbers = show.checked ? '' : 'hide';
      apply();
    });
    box.append(row('Show number', show));
  }
  return box;
}

// ---------- formula editor ----------
// h: { props: the schema (names to insert), preview(formula) → { value, error, rowName }, save(formula) }
export function formulaEditor(prop, h) {
  closePop();
  const dlg = el('dialog', 'formula-dlg');
  dlg.setAttribute('aria-label', `Edit formula: ${prop.name}`);
  const head = el('div', 'fx-head');
  head.append(el('span', 'fx-title', `Edit formula · ${prop.name}`), button('db-tab', 'Close', () => dlg.close()));
  const area = el('textarea', 'fx-input');
  area.value = prop.formula;
  area.spellcheck = false;
  area.placeholder = 'round(prop("Pages Read") / prop("Page Count") * 100) / 100';
  area.setAttribute('aria-label', 'Formula');
  const preview = el('div', 'fx-preview');
  const cols = el('div', 'fx-cols');
  const left = el('div', 'fx-list');
  const help = el('div', 'fx-help');

  const insert = (text, back = 0) => {
    const s = area.selectionStart;
    const e = area.selectionEnd;
    area.setRangeText(text, s, e, 'end');
    area.selectionStart = area.selectionEnd = s + text.length - back;
    area.focus();
    update();
  };
  const showHelp = (f) => {
    help.replaceChildren(el('div', 'fx-sig', f[1]), el('p', 'fx-desc', f[2]), el('code', 'fx-example', f[3]));
  };

  left.append(el('div', 'pop-section', 'Properties'));
  for (const x of h.props.filter((x) => x.name !== prop.name)) {
    const item = el('div', 'pop-item');
    item.append(typeIcon(x.type), el('span', 'pop-label', x.name));
    item.addEventListener('mousedown', (e) => {
      e.preventDefault();
      insert(`prop("${x.name}")`);
    });
    left.append(item);
  }
  left.append(el('div', 'pop-section', 'Functions'));
  for (const f of FUNCTIONS) {
    const item = el('div', 'pop-item');
    item.append(el('span', 'pop-label mono', f[0]));
    item.addEventListener('mouseenter', () => showHelp(f));
    item.addEventListener('mousedown', (e) => {
      e.preventDefault();
      showHelp(f);
      insert(f[0] === 'prop' ? 'prop("")' : `${f[0]}()`, f[0] === 'prop' ? 2 : 1);
    });
    left.append(item);
  }
  // Until a function is picked, the help explains the two ways to call a function.
  help.replaceChildren(
    el('div', 'fx-sig', 'valor.función(…)'),
    el('p', 'fx-desc', 'Lo mismo que función(valor, …). Las dos formas valen; la de punto se lee de izquierda a derecha.'),
    el('code', 'fx-example', 'if(prop("Estado").includes("Done"), "Hecho", "")'),
  );
  cols.append(left, help);

  const update = () => {
    const src = area.value.trim();
    preview.replaceChildren();
    if (!src) return void preview.append(el('span', 'pv-empty', 'Write a formula to see its result'));
    const out = h.preview(src);
    const label = el('span', 'fx-with', out.rowName ? `Preview with ${out.rowName}` : 'Preview (no pages yet)');
    if (out.error) {
      preview.append(label, el('span', 'pv-error', out.error));
      return;
    }
    preview.append(label, valueEl({ ...prop, formula: src, type: 'formula' }, out.value, { empty: 'Empty' }), el('span', 'fx-type', `Type: ${valueType(out.value)}`));
  };
  area.addEventListener('input', update);
  area.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
      e.preventDefault();
      saveBtn.click();
    }
  });

  const foot = el('div', 'fx-foot');
  const saveBtn = button('db-tab db-done', 'Save', () => {
    h.save(area.value.trim().replace(/\s*\n\s*/g, ' '));
    dlg.close();
  });
  foot.append(el('span', 'fx-tip mono', 'Ctrl+Enter saves · Esc closes'), button('db-tab', 'Cancel', () => dlg.close()), saveBtn);
  dlg.append(head, area, preview, cols, foot);
  dlg.addEventListener('close', () => dlg.remove());
  document.body.append(dlg);
  dlg.showModal();
  area.focus();
  update();
}
