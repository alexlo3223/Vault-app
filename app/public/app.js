import { parse, serialize, newBlock, newColumn, isList, listNumbers, indentWidth, renderInline, renderedToRaw, formatTable, parseImage, embedLine, embedSrc, embedUrl, buttonLine, buttonParts, isButton, isEmbed, isHttps, bookmarkLine, bookmarkParts, mediaKind } from './blocks.mjs';
import { parseProps, setProp } from './graph.mjs';
import { cellHandlers, databaseEl, iconNode, loadData, schemaHandlers } from './database-ui.mjs';
import { extractDatabase, newDatabasePage, parseDb, replaceDatabase, serializeDb } from './database.mjs';
import { computeRows, fullSchema, isStored, newProp } from './properties.mjs';
import { addPropertyMenu, editValue, onPopoverClose, popoverOpen, propertyMenu, typeIcon, valueEl } from './props-ui.mjs';
import { icon, ago, renderOverview, renderGraphView } from './views.js';
import { FRAME_KEYS, coverSrc, frameStyle, isImageRef, readCover, removePatch } from './cover.mjs';
import { openCoverEditor } from './cover-ui.mjs';
import { summarize } from './similar.mjs';
import { openPeek } from './peek-ui.mjs';

// Inside a peek the app shows just the page (see peek-ui.mjs).
const peekParam = new URLSearchParams(location.search).get('peek');
if (peekParam) document.documentElement.classList.add('peek-mode');

// ---------- small helpers ----------
const $ = (sel) => document.querySelector(sel);
const enc = encodeURIComponent;
const el = (tag, className = '', text = '') => {
  const n = document.createElement(tag);
  if (className) n.className = className;
  if (text) n.textContent = text;
  return n;
};
const baseName = (p) => p.split('/').pop().replace(/\.md$/i, '');
const folderOf = (p) => p.slice(0, p.lastIndexOf('/') + 1);
const validName = (n) => !!n && !n.startsWith('.') && !/[\\/:*?"<>|#^[\]]/.test(n);
const BAD_NAME = 'Los nombres de página no pueden estar vacíos, empezar por “.” ni contener \\ / : * ? " < > | # ^ [ ]';
const safeDecode = (s) => {
  try {
    return decodeURIComponent(s);
  } catch {
    return s;
  }
};
const makeEditable = (node) => {
  try {
    node.contentEditable = 'plaintext-only';
  } catch {
    node.contentEditable = 'true'; // browsers without plaintext-only; paste and Enter are handled by hand anyway
  }
};

const blocksEl = $('#blocks');
const titleEl = $('#title');
makeEditable(titleEl);
const statusEl = $('#status');
const state = {
  tree: [], page: null, saveTimer: null, saving: Promise.resolve(), conflict: false, focusTitle: false,
  graph: null, byPath: new Map(), graphTimer: null, view: 'overview',
};
const narrow = matchMedia('(max-width: 860px)');
document.querySelectorAll('[data-icon]').forEach((n) => n.append(icon(n.dataset.icon, Number(n.dataset.size ?? 16))));

let expanded = new Set();
try {
  expanded = new Set(JSON.parse(localStorage.getItem('vault.expanded') || '[]'));
} catch {
  // storage unavailable: the tree just starts collapsed
}
const saveExpanded = () => {
  try {
    localStorage.setItem('vault.expanded', JSON.stringify([...expanded]));
  } catch {
    // ignore
  }
};
const setStatus = (msg) => {
  statusEl.textContent = msg;
};

async function api(method, url, body) {
  const res = await fetch(url, {
    method,
    headers: body ? { 'content-type': 'application/json' } : {},
    body: body ? JSON.stringify(body) : undefined,
  }).catch(() => {
    throw new Error('El servidor de Vault no está en marcha: abre Vault.exe (o npm start) y recarga');
  });
  const data = await res.json().catch(() => ({}));
  // Only the web version answers 401: the session ended, so sign in again and come back here.
  if (res.status === 401) location.assign(`/login.html?next=${enc(location.pathname + location.search + location.hash)}`);
  if (!res.ok) {
    const err = new Error(data.error || res.statusText);
    err.status = res.status;
    throw err;
  }
  return data;
}

// ---------- page tree ----------
async function loadTree() {
  state.tree = (await api('GET', '/api/tree')).tree;
  renderTree();
  renderCrumbs();
  await loadGraph();
}

// ---------- graph data and the three views ----------
const views = { overview: $('#view-overview'), graph: $('#view-graph'), page: $('#view-page') };
const viewHandlers = {
  go: (path) => go(path),
  create: (name) => (name ? followLink(name) : createPage()),
};

async function loadGraph() {
  try {
    state.graph = await api('GET', '/api/graph');
  } catch {
    return; // the tree still works; the views just keep their last data
  }
  state.byPath = new Map(state.graph.nodes.map((n) => [n.path, n]));
  const { nodes, edges, tags } = state.graph;
  const links = edges.reduce((s, e) => s + e.count, 0);
  $('#vault-stats').textContent = `${nodes.length} nota${nodes.length === 1 ? '' : 's'} · ${links} enlace${links === 1 ? '' : 's'}`;
  const box = $('#tags');
  box.replaceChildren(
    ...tags.slice(0, 24).map(({ tag, count }) => {
      const b = el('button', 'tag-chip', `#${tag}`);
      b.type = 'button';
      b.title = `${count} nota${count === 1 ? '' : 's'}`;
      b.addEventListener('click', () => openSwitcher(`tag:${tag}`));
      return b;
    }),
  );
  if (!tags.length) box.append(el('span', 'tree-empty', 'Aún no hay etiquetas'));
  if (state.view === 'overview') renderOverview(views.overview, state.graph, viewHandlers);
  else if (state.view === 'graph') renderGraphView(views.graph, state.graph, viewHandlers);
}

function scheduleGraph() {
  clearTimeout(state.graphTimer);
  state.graphTimer = setTimeout(loadGraph, 1200);
}

function showView(name) {
  state.view = name;
  for (const [key, node] of Object.entries(views)) node.hidden = key !== name;
  $('main').classList.toggle('no-scroll', name === 'graph');
  $('#nav-overview').classList.toggle('active', name === 'overview');
  $('#nav-graph').classList.toggle('active', name === 'graph');
  if (name !== 'page') {
    state.page = null;
    renderTree();
    renderCrumbs();
  }
  closeMenu();
  if (narrow.matches) document.body.classList.add('sidebar-hidden');
}

function setNotice(text = '') {
  const box = $('#notice');
  box.textContent = text;
  box.hidden = !text;
}

function showOverview(notice = '') {
  showView('overview');
  setNotice(notice);
  document.title = 'Vault';
  renderOverview(views.overview, state.graph, viewHandlers);
  $('main').scrollTop = 0;
}

function showGraph() {
  showView('graph');
  setNotice();
  document.title = 'Grafo · Vault';
  renderGraphView(views.graph, state.graph, viewHandlers);
}

function renderProps(frontmatter) {
  if (state.rowDb && state.rowDb.path === state.page?.path) return renderRowProps();
  const box = $('#props');
  box.replaceChildren();
  let rows = frontmatter ? parseProps(frontmatter) : [];
  // How the page looks (icon, banner and its framing, width) is seen as the page itself, so the card leaves it out.
  if (rows) rows = rows.filter((r) => !LOOK_KEYS.has(r.key));
  box.hidden = !frontmatter || (rows && !rows.length);
  if (box.hidden) return;
  const head = el('div', 'props-head');
  head.append(el('span', 'eyebrow mono', 'Propiedades'), el('span', 'count mono', rows ? `${rows.length} clave${rows.length === 1 ? '' : 's'}` : 'sin analizar'));
  box.append(head);
  if (!rows) return void box.append(el('pre', 'props-raw', frontmatter.replace(/^---\n/, '').replace(/\n?---\n?$/, '')));
  const grid = el('div', 'props-grid');
  for (const r of rows) {
    grid.append(el('span', 'prop-key', r.key));
    const val = el('span', 'prop-val');
    if (r.list) {
      for (const item of r.list) {
        const chip = el(/^tags?$/i.test(r.key) ? 'button' : 'span', 'tag-chip', /^tags?$/i.test(r.key) ? `#${item}` : item);
        if (chip.tagName === 'BUTTON') {
          chip.type = 'button';
          chip.addEventListener('click', () => openSwitcher(`tag:${item}`));
        }
        val.append(chip);
      }
    } else {
      val.textContent = r.value;
    }
    grid.append(val);
  }
  box.append(grid);
}

// A page inside a database's folder is one of its rows: its header shows every property of the database, typed and
// editable, with "+ Añadir propiedad" (like a Notion database page). Values are written into this page's frontmatter.
function renderRowProps() {
  const box = $('#props');
  const { cfg, raw, related, page } = state.rowDb;
  const path = state.page.path;
  const own = raw.find((r) => r.path === path) ?? { path, mtime: state.page.mtime, ctime: state.page.mtime };
  const parsed = (state.page.frontmatter && parseProps(state.page.frontmatter)) || [];
  const current = { ...own, name: baseName(path), props: Object.fromEntries(parsed.map((r) => [r.key, r.list ?? r.value])) };
  const [row] = computeRows([current], cfg.props, related);
  const props = fullSchema(cfg.props, [current]);
  const owner = { cfg, edit: (fn) => updateSchema(page, fn).then(() => loadRowDb(path), (e) => setStatus(e.message)) };
  // Renaming or deleting a property rewrites every row on disk, this page included: save first, reload after.
  const ctx = {
    ...dbCtx,
    setProp: (_, key, value) => {
      setPageProp(key, value);
      return Promise.resolve();
    },
    renameRowsProp: async (folder, from, to) => {
      await flushSave();
      await dbCtx.renameRowsProp(folder, from, to);
      await openPage(path);
    },
  };
  const handlers = schemaHandlers(owner, { props, raw: [current], related }, ctx);
  const o = {
    ctx,
    owner,
    act: (p) => p.catch((e) => setStatus(e.message)),
    refocus: (_, name) => {
      state.rowFocus = { name, at: Date.now() };
    },
  };

  box.replaceChildren();
  box.hidden = false;
  const head = el('div', 'props-head');
  const dbLink = el('a', 'count mono', `Base de datos · ${baseName(page)}`);
  dbLink.href = `#/${enc(page)}`;
  head.append(el('span', 'eyebrow mono', 'Propiedades'), dbLink);
  const grid = el('div', 'props-grid row-props');
  for (const p of props) {
    const key = el('button', 'prop-key prop-key-btn');
    key.type = 'button';
    key.title = `${p.name} · clic para ver opciones`;
    key.append(typeIcon(p.type, 13), el('span', '', p.name));
    key.addEventListener('click', () => propertyMenu(key, p, handlers(p)));
    const val = el('div', `prop-val prop-cell${isStored(p.type) ? ' editable' : ''}`);
    val.append(valueEl(p, row.values[p.name], { error: row.errors[p.name], open: openByName, empty: 'Vacío' }));
    if (isStored(p.type)) {
      val.tabIndex = 0;
      val.dataset.prop = p.name;
      const edit = (e) => {
        if (e.target.closest('a')) return;
        editValue(val, p, row.values[p.name], cellHandlers(current, p, o));
      };
      val.addEventListener('click', edit);
      val.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          edit(e);
        }
      });
    }
    grid.append(key, val);
  }
  const add = el('button', 'prop-add', '+ Añadir propiedad');
  add.type = 'button';
  add.addEventListener('click', () =>
    addPropertyMenu(add, { names: props.map((p) => p.name), create: (name, type) => owner.edit((c) => c.props.push(newProp(name, type))) }),
  );
  box.append(head, grid, add);
  focusRow();
}

// After a value is saved the panel is drawn again: the keyboard goes back to the value that was edited, so a row can be
// filled in one value after another. A panel that is still open (picking several options) keeps the focus until it closes.
function focusRow() {
  const want = state.rowFocus;
  if (!want) return;
  if (Date.now() - want.at > 3000) return void (state.rowFocus = null);
  if (popoverOpen()) return;
  const target = [...document.querySelectorAll('#props .prop-cell[data-prop]')].find((c) => c.dataset.prop === want.name);
  if (!target) return;
  target.focus({ preventScroll: true });
  state.rowFocus = null;
}
// The redraw after a save comes a moment after the panel closes and focuses the value itself; this only covers a panel
// that stayed open while values changed, so it waits for any such redraw first.
onPopoverClose(() => setTimeout(focusRow, 400));

// The database this page is a row of (a database whose source is the page's folder), with its schema and rows.
async function loadRowDb(path) {
  const folder = path.includes('/') ? path.slice(0, path.lastIndexOf('/')) : '';
  let next = null;
  if (folder) {
    try {
      const { databases } = await api('GET', '/api/databases');
      const db = databases.find((d) => d.source.replace(/\/+$/, '').toLowerCase() === folder.toLowerCase());
      if (db) {
        const page = await api('GET', `/api/page?path=${enc(db.path)}`);
        const cfg = parseDb(extractDatabase(page.content) ?? '');
        const { raw, related } = await loadData(cfg, dbCtx);
        next = { path, page: db.path, cfg, raw, related };
      }
    } catch (e) {
      setStatus(e.message);
    }
  }
  if (state.page?.path !== path) return; // the user moved on meanwhile
  state.rowDb = next;
  renderProps(state.page.frontmatter);
}

// Rewrites the database block of another page (its schema or views), keeping the rest of that page.
async function updateSchema(page, fn) {
  const data = await api('GET', `/api/page?path=${enc(page)}`);
  const text = extractDatabase(data.content);
  if (text === null) throw new Error('Esa página no tiene base de datos');
  const cfg = parseDb(text);
  fn(cfg);
  await api('PUT', '/api/page', { path: page, content: replaceDatabase(data.content, serializeDb(cfg)), baseMtime: data.mtime });
}

// Opens a page by name, as a relation chip links it ("Quote 1" or "Quotes/Quote 1"); never creates one.
async function openByName(name) {
  try {
    const { path } = await api('GET', `/api/resolve?link=${enc(name)}&from=${enc(state.page?.path ?? '')}`);
    if (path) go(path);
    else setStatus(`No hay ninguna página llamada “${name}”`);
  } catch (e) {
    setStatus(e.message);
  }
}

function updateMeta() {
  const p = state.page;
  if (!p) return;
  const text = flatBlocks().map((b) => (b.type === 'table' ? b.rows.flat().join(' ') : b.type === 'image' ? '' : b.text));
  const words = (text.join(' ').match(/\S+/g) ?? []).length;
  $('#meta').textContent = `${words} palabra${words === 1 ? '' : 's'} · ${Math.max(1, Math.round(words / 200))} min de lectura · ${p.dirty ? 'editando' : `actualizada ${ago(p.mtime)}`}`;
}

function allPages() {
  const out = [];
  const walk = (nodes) =>
    nodes.forEach((n) => {
      if (n.path) out.push(n.path);
      walk(n.children);
    });
  walk(state.tree);
  return out;
}

// Same rule as Obsidian's fileToLinktext: the bare name when unique, otherwise the path.
function linktext(path, pages) {
  const name = baseName(path).toLowerCase();
  return pages.filter((p) => baseName(p).toLowerCase() === name).length > 1 ? path.slice(0, -3) : baseName(path);
}

function renderTree() {
  const ul = $('#tree');
  ul.replaceChildren(...state.tree.map((n) => treeNode(n, 0)));
  if (!state.tree.length) ul.append(el('li', 'tree-empty', 'Aún no hay páginas'));
}

function treeNode(node, depth) {
  const li = el('li');
  const row = el('div', 'row');
  row.style.paddingLeft = `${4 + depth * 14}px`;
  const active = node.path && node.path === state.page?.path;
  if (active) row.classList.add('active');
  const open = expanded.has(node.key);

  const chev = el('button', 'chev', node.children.length ? (open ? '▾' : '▸') : '');
  chev.type = 'button';
  if (node.children.length) {
    chev.setAttribute('aria-label', `${open ? 'Contraer' : 'Desplegar'} ${node.name}`);
    chev.setAttribute('aria-expanded', String(open));
    chev.addEventListener('click', () => toggleNode(node.key));
  } else {
    chev.disabled = true;
    chev.tabIndex = -1;
    chev.setAttribute('aria-hidden', 'true');
  }

  const name = el('button', node.path ? 'name' : 'name folder', node.name);
  name.type = 'button';
  if (active) name.setAttribute('aria-current', 'page');
  name.addEventListener('click', () => (node.path ? go(node.path) : toggleNode(node.key)));
  if (!node.path) {
    name.title = 'Doble clic para cambiar el nombre';
    name.addEventListener('dblclick', () => renameFolder(node));
  }

  const rowButton = (label, title, onClick) => {
    const b = el('button', 'icon', typeof label === 'string' ? label : '');
    if (typeof label !== 'string') b.append(label);
    b.type = 'button';
    b.title = title;
    b.setAttribute('aria-label', `${title}: ${node.name}`);
    b.addEventListener('click', onClick);
    return b;
  };
  if (node.icon) name.prepend(iconNode({ icon: node.icon, path: node.path }));
  row.append(chev, name, rowButton('+', 'Añadir una página dentro', () => createPage(`${node.key}/`)));
  if (!node.path) row.append(rowButton(icon('folder', 13), 'Añadir una carpeta dentro', () => createFolder(`${node.key}/`)));
  row.append(rowButton('×', 'Mover a la papelera', () => (node.path ? deletePage(node) : deleteFolder(node))));

  // Drag a page or folder onto another one to move it inside; onto the "Pages" header for the top level.
  row.draggable = true;
  row.addEventListener('dragstart', (e) => {
    treeDrag = node;
    e.dataTransfer.effectAllowed = 'move';
    e.dataTransfer.setData('application/x-vault-page', node.key);
  });
  row.addEventListener('dragend', () => (treeDrag = null));
  row.addEventListener('dragover', (e) => {
    if (!canDropInto(node.key)) return;
    e.preventDefault();
    row.classList.add('drop-into');
  });
  row.addEventListener('dragleave', () => row.classList.remove('drop-into'));
  row.addEventListener('drop', (e) => {
    row.classList.remove('drop-into');
    if (!canDropInto(node.key)) return;
    e.preventDefault();
    moveNode(treeDrag, node.key);
  });
  li.append(row);
  if (open && node.children.length) {
    const ul = el('ul');
    ul.append(...node.children.map((c) => treeNode(c, depth + 1)));
    li.append(ul);
  }
  return li;
}

let treeDrag = null;
const parentKey = (key) => key.slice(0, Math.max(0, key.lastIndexOf('/')));
// Not into itself, its own sub-tree, or the folder it is already in.
const canDropInto = (key) => !!treeDrag && key !== treeDrag.key && !key.startsWith(`${treeDrag.key}/`) && parentKey(treeDrag.key) !== key;

// A rename rewrites the links that pointed at the moved note. If that changed the open page (already saved, see
// flushSave), show it from disk: otherwise its next save would be refused as a conflict.
const reloadIfRelinked = (res) => (state.page && res.relinked?.includes(state.page.path) ? openPage(state.page.path) : null);

async function moveNode(node, target) {
  const toKey = target ? `${target}/${node.name}` : node.name;
  if (toKey === node.key) return;
  await flushSave();
  let res;
  try {
    if (node.path) res = await api('POST', '/api/rename', { from: node.path, to: `${toKey}.md` });
    else res = await api('POST', '/api/rename', { from: node.key, to: toKey, folder: true });
  } catch (e) {
    return setStatus(e.message);
  }
  movedKey(node.key, toKey);
  await reloadIfRelinked(res);
  if (target) expanded.add(target);
  saveExpanded();
  await loadTree();
}

// Keep the open page and expanded folders pointing at their new place after a move or rename.
function movedKey(from, to) {
  const re = (k) => (k === from || k.startsWith(`${from}/`) ? to + k.slice(from.length) : k);
  expanded = new Set([...expanded].map(re));
  const page = state.page;
  if (page && re(page.path.slice(0, -3)) !== page.path.slice(0, -3)) {
    page.path = `${re(page.path.slice(0, -3))}.md`;
    history.replaceState(null, '', `#/${enc(page.path)}`);
    renderCrumbs();
  }
}

async function createFolder(prefix = '') {
  const name = (await askText('Nombre de la carpeta nueva'))?.replace(/\s+/g, ' ').trim();
  if (!name) return;
  if (!validName(name)) return setStatus(BAD_NAME.replace('de página', 'de carpeta'));
  try {
    await api('POST', '/api/folder', { path: prefix + name });
  } catch (e) {
    return setStatus(e.message);
  }
  if (prefix) expanded.add(prefix.slice(0, -1));
  saveExpanded();
  await loadTree();
}

async function renameFolder(node) {
  const name = (await askText('Cambiar el nombre de la carpeta', node.name))?.replace(/\s+/g, ' ').trim();
  if (!name || name === node.name) return;
  if (!validName(name)) return setStatus(BAD_NAME.replace('de página', 'de carpeta'));
  const parent = parentKey(node.key);
  const to = parent ? `${parent}/${name}` : name;
  await flushSave();
  let res;
  try {
    res = await api('POST', '/api/rename', { from: node.key, to, folder: true });
  } catch (e) {
    return setStatus(e.message);
  }
  movedKey(node.key, to);
  await reloadIfRelinked(res);
  saveExpanded();
  await loadTree();
}

async function deleteFolder(node) {
  if (!confirm(`¿Mover la carpeta “${node.name}” y todo lo que contiene a la papelera (carpeta .trash)?`)) return;
  await flushSave();
  try {
    await api('POST', '/api/delete', { path: node.key, folder: true });
  } catch (e) {
    return setStatus(e.message);
  }
  const cur = state.page?.path;
  if (cur?.startsWith(`${node.key}/`)) {
    state.page.dirty = false;
    location.hash = '';
  }
  await loadTree();
}

function toggleNode(key) {
  if (expanded.has(key)) expanded.delete(key);
  else expanded.add(key);
  saveExpanded();
  renderTree();
}

function renderCrumbs() {
  const nav = $('#crumbs');
  nav.replaceChildren();
  if (!state.page) {
    nav.append(el('span', 'crumb', 'Vault'), el('span', 'sep', '/'), el('span', 'crumb', state.view === 'graph' ? 'Grafo' : 'Resumen'));
    return;
  }
  const root = el('button', '', 'Vault');
  root.type = 'button';
  root.addEventListener('click', () => (location.hash = '#overview'));
  nav.append(root, el('span', 'sep', '/'));
  const parts = state.page.path.slice(0, -3).split('/');
  const pages = new Set(allPages());
  parts.forEach((part, i) => {
    if (i) nav.append(el('span', 'sep', '/'));
    const key = parts.slice(0, i + 1).join('/');
    if (i < parts.length - 1 && pages.has(`${key}.md`)) {
      const b = el('button', '', part);
      b.type = 'button';
      b.addEventListener('click', () => go(`${key}.md`));
      nav.append(b);
    } else {
      nav.append(el('span', 'crumb', part));
    }
  });
}

async function createPage(prefix = '', title = 'Sin título') {
  const taken = new Set(allPages().map((p) => p.toLowerCase()));
  let name = title;
  for (let n = 2; taken.has(`${prefix}${name}.md`.toLowerCase()); n++) name = `${title} ${n}`;
  const path = `${prefix}${name}.md`;
  try {
    await api('PUT', '/api/page', { path, content: '', baseMtime: null });
  } catch (e) {
    return setStatus(e.message);
  }
  if (prefix) {
    expanded.add(prefix.slice(0, -1));
    saveExpanded();
  }
  await loadTree();
  go(path, { focusTitle: true });
}

async function deletePage(node) {
  const kids = node.children.length ? ' y sus subpáginas' : '';
  if (!confirm(`¿Mover “${node.name}”${kids} a la papelera (carpeta .trash)?`)) return;
  await flushSave();
  try {
    await api('POST', '/api/delete', { path: node.path });
  } catch (e) {
    return setStatus(e.message);
  }
  const cur = state.page?.path;
  if (cur && (cur === node.path || cur.startsWith(`${node.key}/`))) {
    state.page.dirty = false;
    location.hash = '';
  }
  await loadTree();
}

// ---------- routing and loading ----------
function go(path, { focusTitle = false } = {}) {
  state.focusTitle = focusTitle;
  const hash = `#/${enc(path)}`;
  if (location.hash === hash) openPage(path);
  else location.hash = hash;
}

async function route() {
  const hash = location.hash;
  if (hash.startsWith('#/')) return openPage(safeDecode(hash.slice(2)));
  await flushSave();
  if (hash === '#graph') return showGraph();
  showOverview();
}

const showEmpty = (msg) => showOverview(msg);

async function openPage(path) {
  await flushSave();
  if (state.page?.dirty && state.page.path !== path) {
    if (!confirm('Esta página tiene cambios que no se han podido guardar. ¿Salir de todos modos?')) {
      history.replaceState(null, '', `#/${enc(state.page.path)}`);
      return;
    }
  }
  state.conflict = false;
  $('#conflict').hidden = true;
  let data;
  try {
    data = await api('GET', `/api/page?path=${enc(path)}`);
  } catch (e) {
    return showEmpty(e.status === 404 ? `“${baseName(path)}” no existe.` : e.message);
  }
  const doc = parse(data.content);
  state.page = { path, mtime: data.mtime, frontmatter: doc.frontmatter, trailing: doc.trailing, blocks: doc.blocks, dirty: false };
  for (let k = folderOf(path).slice(0, -1); k; k = k.slice(0, Math.max(0, k.lastIndexOf('/')))) expanded.add(k);
  saveExpanded();

  showView('page');
  setNotice();
  titleEl.textContent = baseName(path);
  document.title = `${baseName(path)} · Vault`;
  if (state.rowDb?.path !== path) state.rowDb = null;
  renderProps(doc.frontmatter);
  renderCover(doc.frontmatter);
  updateMeta();
  setStatus('');
  renderCrumbs();
  renderTree();
  rerender();
  loadRowDb(path);
  loadRelated(path);
  $('main').scrollTop = 0;
  if (state.focusTitle) {
    state.focusTitle = false;
    titleEl.focus();
    getSelection().selectAllChildren(titleEl);
  }
}

// ---------- saving ----------
function changed() {
  if (!state.page) return;
  state.page.dirty = true;
  setStatus('Editando…');
  updateMeta();
  clearTimeout(state.saveTimer);
  state.saveTimer = setTimeout(() => save(), 700);
}

// Saves run one at a time so each one sends the mtime the previous one got back.
function save(force = false) {
  clearTimeout(state.saveTimer);
  state.saveTimer = null;
  state.saving = state.saving.then(() => doSave(force));
  return state.saving;
}

async function doSave(force) {
  const page = state.page;
  if (!page || !page.dirty || (state.conflict && !force)) return;
  page.dirty = false;
  setStatus('Guardando…');
  try {
    const { mtime } = await api('PUT', '/api/page', { path: page.path, content: serialize(page), baseMtime: page.mtime, force });
    page.mtime = mtime;
    if (state.page === page) {
      setStatus('Guardado');
      updateMeta();
    }
    scheduleGraph();
  } catch (e) {
    page.dirty = true;
    if (e.status === 409) {
      state.conflict = true;
      $('#conflict').hidden = false;
      setStatus('Sin guardar');
    } else {
      setStatus('No se pudo guardar, reintentando…');
      state.saveTimer = setTimeout(() => save(), 3000);
    }
  }
}

async function flushSave() {
  if (state.page?.dirty && !state.conflict) await save();
  else await state.saving;
}
// The peek that holds this page saves it before closing (peek-ui.mjs).
if (peekParam) window.vaultFlush = flushSave;

$('#reload-disk').addEventListener('click', () => {
  state.page.dirty = false;
  state.conflict = false;
  openPage(state.page.path);
});
$('#keep-mine').addEventListener('click', () => {
  state.conflict = false;
  $('#conflict').hidden = true;
  state.page.dirty = true;
  save(true);
});

// ---------- title = file name ----------
titleEl.addEventListener('keydown', (e) => {
  if (e.key === 'Enter' || e.key === 'ArrowDown') {
    e.preventDefault();
    const first = state.page && flatBlocks()[0];
    if (first) focusBlock(first.id, 0);
  }
});
titleEl.addEventListener('focusout', async () => {
  const page = state.page;
  if (!page) return;
  const name = titleEl.textContent.replace(/\s+/g, ' ').trim();
  const current = baseName(page.path);
  if (name === current) return;
  if (!validName(name)) {
    titleEl.textContent = current;
    return setStatus(BAD_NAME);
  }
  const to = `${folderOf(page.path)}${name}.md`;
  let res;
  try {
    await flushSave();
    res = await api('POST', '/api/rename', { from: page.path, to });
  } catch (e) {
    if (state.page === page) titleEl.textContent = current;
    return setStatus(e.message);
  }
  if (state.page === page) {
    page.path = to;
    history.replaceState(null, '', `#/${enc(to)}`);
    document.title = `${name} · Vault`;
    await reloadIfRelinked(res);
  }
  await loadTree();
});

// ---------- block rendering ----------
const PLACEHOLDER = {
  text: "Escribe '/' para insertar, '[[' para enlazar una página",
  h1: 'Título 1',
  h2: 'Título 2',
  h3: 'Título 3',
  todo: 'Tarea',
  bullet: 'Lista',
  numbered: 'Lista',
  quote: 'Cita',
  code: 'Código',
};
const sentinel = () => el('br', 'sentinel'); // makes a trailing newline visible in contenteditable

function setRaw(content, b) {
  content.textContent = b.text;
  if (b.text.endsWith('\n')) content.append(sentinel());
  content.dataset.mode = 'edit';
  content.classList.toggle('is-empty', b.text === '');
}

// Obsidian's callout marker, e.g. "[!tip] Title": a quote whose first line starts with it.
const CALLOUT = /^\[!(\w+)\][ \t]?/;

function showRendered(content, b) {
  if (b.type === 'code') content.textContent = b.text;
  else content.innerHTML = renderInline(b.type === 'quote' ? b.text.replace(CALLOUT, '') : b.text); // renderInline escapes all note text
  if (b.text.endsWith('\n')) content.append(sentinel());
  content.dataset.mode = 'view';
  content.classList.toggle('is-empty', b.text === '');
}

const blockEls = (list) => {
  if (!list.length) list.push(newBlock());
  const nums = listNumbers(list);
  return list.map((b) => blockEl(b, nums.get(b)));
};

function rerender() {
  blocksEl.replaceChildren(...blockEls(state.page.blocks));
}

function blockEl(b, num) {
  const wrap = el('div', `block b-${b.type}`);
  wrap.dataset.id = b.id;
  if (isList(b.type)) wrap.style.marginLeft = `${Math.ceil(indentWidth(b.indent) / 4) * 24}px`;
  const handle = el('button', 'handle', '⋮⋮');
  handle.type = 'button';
  handle.draggable = true;
  handle.tabIndex = -1;
  handle.title = 'Arrastra para mover · clic para ver opciones';
  handle.setAttribute('aria-label', 'Mover o borrar el bloque');
  handle.addEventListener('click', () => blockMenu(b, handle));
  wrap.append(handle);
  if (b.type === 'divider' || b.type === 'image') {
    const d = b.type === 'divider' ? el('div', 'divider') : imageEl(b);
    d.tabIndex = 0;
    if (b.type === 'divider') {
      d.setAttribute('role', 'separator');
      d.append(el('hr'));
    }
    d.addEventListener('keydown', (e) => dividerKey(e, b));
    wrap.append(d);
    return wrap;
  }
  if (b.type === 'table') {
    wrap.append(tableEl(b));
    return wrap;
  }
  if (b.type === 'embed') {
    wrap.append(embedEl(b));
    return wrap;
  }
  if (b.type === 'bookmark') {
    wrap.append(bookmarkEl(b));
    return wrap;
  }
  if (b.type === 'button') {
    wrap.append(buttonEl(b));
    return wrap;
  }
  if (b.type === 'code' && b.info?.trim() === 'database' && !b.showSource) {
    wrap.append(databaseEl(b, dbCtx));
    return wrap;
  }
  if (b.type === 'columns') {
    const grid = el('div', 'columns');
    grid.style.gridTemplateColumns = b.cols.map((c) => `minmax(0, ${c.ratio ?? 1}fr)`).join(' ');
    for (const col of b.cols) {
      const c = el('div', 'column');
      c.append(...blockEls(col.blocks));
      grid.append(c);
    }
    wrap.append(grid);
    return wrap;
  }
  if (b.type === 'todo') {
    const box = el('input');
    box.type = 'checkbox';
    box.checked = !!b.checked;
    box.setAttribute('aria-label', 'Hecha');
    box.addEventListener('change', () => {
      b.checked = box.checked;
      b.mark = box.checked ? 'x' : ' ';
      wrap.classList.toggle('done', box.checked);
      changed();
    });
    wrap.classList.toggle('done', !!b.checked);
    wrap.append(box);
  }
  if (b.type === 'bullet') wrap.append(el('span', 'marker', '•'));
  if (b.type === 'numbered') wrap.append(el('span', 'marker', `${num}${b.delim ?? '.'}`));
  const content = el(b.type === 'code' ? 'pre' : 'div', 'content');
  makeEditable(content);
  content.spellcheck = b.type !== 'code';
  content.dataset.placeholder = PLACEHOLDER[b.type] ?? '';
  showRendered(content, b);
  const kind = b.type === 'quote' ? b.text.match(CALLOUT)?.[1] : null;
  if (kind) {
    wrap.classList.add('callout');
    wrap.dataset.kind = kind.toLowerCase();
  }
  wrap.append(content);
  if (b.type === 'code' && b.info?.trim() === 'database') {
    const done = el('button', 'db-tab db-done', 'Hecho');
    done.type = 'button';
    done.addEventListener('click', () => {
      b.showSource = false;
      rerender();
    });
    wrap.append(done);
  }
  return wrap;
}

// Blocks live in the page list or inside a column; these walk both in document order.
function* walkBlocks(list = state.page?.blocks ?? []) {
  for (const b of list) {
    yield [b, list];
    if (b.type === 'columns') for (const c of b.cols) yield* walkBlocks(c.blocks);
  }
}
const ownerList = (b) => [...walkBlocks()].find(([x]) => x === b)?.[1];

// A block that gets new neighbours must not keep "no blank line before me": next to a list item that would
// turn it into list text when the Markdown is read back. Undefined lets serialize pick the gap.
const resetGap = (b) => b && (b.blankBefore = undefined);

function removeBlock(b) {
  const list = ownerList(b);
  const i = list.indexOf(b);
  list.splice(i, 1);
  resetGap(list[i]);
  changed();
  rerender();
  const t = list[i - 1] ?? list[i];
  if (t) focusBlock(t.id, 'end');
}

function blockMenu(b, anchor) {
  const at = lastCell?.b === b ? lastCell : null;
  const items = [];
  if (b.type === 'table') {
    items.push({ label: 'Añadir fila', op: 'addRow' }, { label: 'Añadir columna', op: 'addCol' });
    if (at?.r > 0) items.push({ label: 'Borrar fila', hint: `fila ${at.r}`, op: 'delRow' });
    if (at && b.align.length > 1) items.push({ label: 'Borrar columna', hint: `columna ${at.c + 1}`, op: 'delCol' });
  }
  items.push({ label: 'Borrar', hint: 'bloque', op: 'delete' });
  menuMeta = { title: 'Bloque', right: b.type, foot: 'Arrastra ⋮⋮ para mover' };
  openMenu(items, anchor.getBoundingClientRect(), (it) => (it.op === 'delete' ? removeBlock(b) : tableEdit(b, it.op, at?.r, at?.c)));
}

// ---------- images ----------
const imageSrc = (src) => (/^(https?:|data:image\/)/i.test(src) ? src : `/api/file?link=${enc(safeDecode(src))}&from=${enc(state.page.path)}`);

// A stored file in the note: a picture, a video or audio player, or a download card for anything else.
function imageEl(b) {
  const info = parseImage(b.text);
  const fig = el('figure', 'img-block');
  fig.setAttribute('aria-label', `${mediaKind(info.src)} ${info.alt || info.src}`);
  const kind = mediaKind(info.src);
  if (kind === 'video' || kind === 'audio') {
    const media = el(kind);
    media.controls = true;
    media.preload = 'metadata';
    media.src = imageSrc(info.src);
    media.addEventListener('error', () => fig.append(el('figcaption', 'mono', `No se pudo reproducir: ${info.src}`)), { once: true });
    fig.append(media);
    return fig;
  }
  if (kind === 'file') {
    const card = el('a', 'file-card', info.src.split('/').pop());
    card.href = imageSrc(info.src);
    card.download = info.src.split('/').pop();
    card.prepend(icon('file', 16));
    fig.append(card);
    return fig;
  }
  const img = el('img');
  img.alt = info.alt;
  img.draggable = false;
  if (info.width) img.width = info.width;
  img.addEventListener('error', () => fig.append(el('figcaption', 'mono', `No se encuentra la imagen: ${info.src}`)), { once: true });
  img.src = imageSrc(info.src);
  fig.append(img);
  return fig;
}

async function uploadImage(file) {
  const res = await fetch(`/api/upload?name=${enc(file.name || 'image.png')}`, {
    method: 'POST',
    headers: { 'content-type': file.type || 'application/octet-stream' },
    body: file,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || res.statusText);
  return data.name;
}

async function insertImages(files, list, index) {
  const images = files.filter((f) => f.type.startsWith('image/'));
  if (!images.length) return setStatus('Solo se pueden añadir imágenes');
  const page = state.page;
  setStatus('Subiendo…');
  const added = [];
  for (const f of images) {
    try {
      added.push(newBlock('image', `![[${await uploadImage(f)}]]`));
    } catch (e) {
      setStatus(e.message);
    }
  }
  if (state.page !== page || !added.length) return;
  list.splice(index, 0, ...added);
  resetGap(list[index + added.length]);
  if (list[list.length - 1] === added[added.length - 1]) list.push(newBlock());
  changed();
  rerender();
  loadTree();
}

// ---------- tables ----------
let lastCell = null; // the table cell edited last, so the block menu can delete its row or column

const cellPos = (td) => [Number(td.dataset.r), Number(td.dataset.c)];
const focusCell = (b, r, c) => blocksEl.querySelector(`.block[data-id="${b.id}"] .cell[data-r="${r}"][data-c="${c}"]`)?.focus();

function tableEdit(b, op, r = b.rows.length - 1, c = b.align.length - 1) {
  if (op === 'addRow') b.rows.splice(r + 1, 0, b.align.map(() => ''));
  if (op === 'addCol') {
    b.rows.forEach((row) => row.splice(c + 1, 0, ''));
    b.align.splice(c + 1, 0, '');
  }
  if (op === 'delRow' && r > 0) b.rows.splice(r, 1);
  if (op === 'delCol' && b.align.length > 1) {
    b.rows.forEach((row) => row.splice(c, 1));
    b.align.splice(c, 1);
  }
  b.text = formatTable(b.rows, b.align);
  lastCell = null;
  changed();
  rerender();
  if (op === 'addRow') focusCell(b, r + 1, 0);
  if (op === 'addCol') focusCell(b, 0, c + 1);
}

function tableEl(b) {
  const box = el('div', 'tbl-wrap');
  const table = el('table', 'tbl');
  b.rows.forEach((row, r) => {
    const tr = el('tr');
    row.forEach((text, c) => {
      const td = el(r ? 'td' : 'th', 'cell');
      makeEditable(td);
      td.dataset.r = r;
      td.dataset.c = c;
      if (b.align[c]) td.style.textAlign = b.align[c];
      td.innerHTML = renderInline(text); // renderInline escapes all note text
      tr.append(td);
    });
    table.append(tr);
  });
  table.addEventListener('mousedown', (e) => {
    if (e.target.closest('a')) e.preventDefault(); // follow the link instead of editing the cell
  });
  table.addEventListener('focusin', (e) => {
    const td = e.target.closest('.cell');
    const [r, c] = cellPos(td);
    lastCell = { b, r, c };
    td.textContent = b.rows[r][c];
    setSelection(td, td.textContent.length);
  });
  table.addEventListener('focusout', (e) => {
    const td = e.target.closest('.cell');
    const [r, c] = cellPos(td);
    if (b.rows[r]) td.innerHTML = renderInline(b.rows[r][c] ?? '');
  });
  table.addEventListener('input', (e) => {
    const td = e.target.closest('.cell');
    const [r, c] = cellPos(td);
    b.rows[r][c] = td.textContent.replace(/\n/g, ' ');
    b.text = formatTable(b.rows, b.align);
    changed();
  });
  table.addEventListener('paste', (e) => {
    e.preventDefault();
    document.execCommand('insertText', false, (e.clipboardData?.getData('text/plain') ?? '').replace(/\s*\n\s*/g, ' '));
  });
  table.addEventListener('keydown', (e) => {
    const td = e.target.closest('.cell');
    if (!td || e.isComposing) return;
    const [r, c] = cellPos(td);
    const cols = b.align.length;
    let to;
    if (e.key === 'Tab') {
      const i = r * cols + c + (e.shiftKey ? -1 : 1);
      if (i < 0) return;
      e.preventDefault();
      if (i >= b.rows.length * cols) return tableEdit(b, 'addRow');
      to = [Math.floor(i / cols), i % cols];
    } else if (e.key === 'Enter') {
      e.preventDefault();
      if (r === b.rows.length - 1) return tableEdit(b, 'addRow', r);
      to = [r + 1, c];
    } else if (e.key === 'Escape') {
      return td.blur();
    } else {
      return;
    }
    focusCell(b, ...to);
  });
  const addCol = el('button', 'tbl-add tbl-add-col', '+');
  addCol.type = 'button';
  addCol.title = 'Añadir columna';
  addCol.addEventListener('click', () => tableEdit(b, 'addCol'));
  const addRow = el('button', 'tbl-add tbl-add-row', '+');
  addRow.type = 'button';
  addRow.title = 'Añadir fila';
  addRow.addEventListener('click', () => tableEdit(b, 'addRow'));
  box.append(table, addCol, addRow);
  return box;
}

function insertStructure(b, item, start) {
  const list = ownerList(b);
  const replace = b.type === 'text' && b.text === '';
  if (item.type === 'image') {
    const input = el('input');
    input.type = 'file';
    input.accept = 'image/png,image/jpeg,image/gif,image/webp,image/avif,image/bmp';
    input.multiple = true;
    input.addEventListener('change', () => insertImages([...input.files], list, list.indexOf(b) + 1));
    changed();
    structural(b.id, start);
    return input.click();
  }
  const nb =
    item.type === 'table'
      ? newBlock('table', '', { rows: [['Columna 1', 'Columna 2', 'Columna 3'], ['', '', ''], ['', '', '']], align: ['', '', ''] })
      : newBlock('columns', '', { cols: (item.ratios ?? Array.from({ length: item.n })).map((ratio) => ({ ...newColumn(), ratio })) });
  if (nb.type === 'table') nb.text = formatTable(nb.rows, nb.align);
  const i = list.indexOf(b);
  list.splice(replace ? i : i + 1, replace ? 1 : 0, nb);
  resetGap(list[list.indexOf(nb) + 1]);
  if (list[list.length - 1] === nb) list.push(newBlock());
  changed();
  closeMenu();
  rerender();
  if (nb.type === 'table') focusCell(nb, 1, 0);
  else focusBlock(nb.cols[0].blocks[0].id, 0);
}

// ---------- drag and drop: blocks by their ⋮⋮ handle, image files from the desktop ----------
let dragged = null;
const dropLine = el('div', 'drop-line');
dropLine.hidden = true;
document.body.append(dropLine);
const hasFiles = (e) => [...(e.dataTransfer?.types ?? [])].includes('Files');

// The block the pointer is over (inside a column when over one), and whether to drop before or after it.
function dropTarget(e) {
  const col = e.target.closest?.('.column');
  const scope = col && dragged?.type !== 'columns' ? col : blocksEl; // columns don't nest
  let node = null;
  let before = false;
  for (const k of scope.children) {
    if (!k.classList.contains('block')) continue;
    node = k;
    const r = k.getBoundingClientRect();
    if (e.clientY < r.top + r.height / 2) {
      before = true;
      break;
    }
  }
  return node && { node, before, block: blockOf(node) };
}

blocksEl.addEventListener('dragstart', (e) => {
  const handle = e.target.closest?.('.handle');
  if (!handle) return;
  dragged = blockOf(handle);
  const wrap = handle.closest('.block');
  e.dataTransfer.effectAllowed = 'move';
  e.dataTransfer.setData('application/x-vault-block', String(dragged.id));
  e.dataTransfer.setDragImage(wrap, 12, 12);
  wrap.classList.add('dragging');
  closeMenu();
});

// Dropping a block at the left or right edge of a top-level block (or in the margin beside it) puts the two side
// by side in columns. Columns never nest, so only top-level blocks take part.
function sideDrop(e, node) {
  if (!dragged || dragged.type === 'columns' || node.parentElement !== blocksEl) return null;
  const r = node.getBoundingClientRect();
  if (e.clientX < r.left + 40) return 'left';
  if (e.clientX > r.right - 40) return 'right';
  return null;
}

// Makes a row of two columns: the dragged block and the target, in the order the side says.
function dropBeside(target, side) {
  const from = ownerList(dragged);
  const at = from.indexOf(dragged);
  from.splice(at, 1);
  resetGap(from[at]);
  const mine = { frontmatter: '', blocks: [dragged], trailing: 2 };
  const theirs = { frontmatter: '', blocks: [target], trailing: 2 };
  resetGap(dragged);
  resetGap(target);
  if (target.type === 'columns') target.cols[side === 'left' ? 'unshift' : 'push'](mine);
  else {
    const list = ownerList(target);
    const grid = newBlock('columns', '', { cols: side === 'left' ? [mine, theirs] : [theirs, mine] });
    list.splice(list.indexOf(target), 1, grid);
    resetGap(list[list.indexOf(grid) + 1]);
  }
  changed();
  rerender();
}

blocksEl.addEventListener('dragover', (e) => {
  if (!dragged && !hasFiles(e)) return;
  const t = dropTarget(e);
  if (!t || t.block === dragged) {
    dropLine.hidden = true;
    return;
  }
  e.preventDefault();
  e.dataTransfer.dropEffect = dragged ? 'move' : 'copy';
  const r = t.node.getBoundingClientRect();
  const side = sideDrop(e, t.node);
  // A vertical line at the chosen edge means "make columns"; a horizontal one means "place before or after".
  dropLine.style.left = `${side === 'left' ? r.left - 8 : side === 'right' ? r.right + 5 : r.left}px`;
  dropLine.style.width = side ? '3px' : `${r.width}px`;
  dropLine.style.height = side ? `${r.height}px` : '3px';
  dropLine.style.top = side ? `${r.top}px` : `${t.before ? r.top - 2 : r.bottom}px`;
  dropLine.hidden = false;
});

blocksEl.addEventListener('dragleave', (e) => {
  if (!blocksEl.contains(e.relatedTarget)) dropLine.hidden = true;
});

blocksEl.addEventListener('drop', (e) => {
  dropLine.hidden = true;
  if (!dragged && !hasFiles(e)) return;
  const t = dropTarget(e);
  e.preventDefault();
  if (!t || t.block === dragged) return;
  const side = dragged && sideDrop(e, t.node);
  if (side) return dropBeside(t.block, side);
  const list = ownerList(t.block);
  if (!dragged) return insertImages([...e.dataTransfer.files], list, list.indexOf(t.block) + (t.before ? 0 : 1));
  const from = ownerList(dragged);
  const at = from.indexOf(dragged);
  from.splice(at, 1);
  resetGap(from[at]);
  list.splice(list.indexOf(t.block) + (t.before ? 0 : 1), 0, dragged);
  resetGap(dragged);
  resetGap(list[list.indexOf(dragged) + 1]);
  changed();
  rerender();
});

blocksEl.addEventListener('dragend', () => {
  dragged = null;
  dropLine.hidden = true;
  blocksEl.querySelector('.dragging')?.classList.remove('dragging');
});

// A file dropped anywhere else must not make the browser navigate away to it.
for (const type of ['dragover', 'drop']) addEventListener(type, (e) => hasFiles(e) && e.preventDefault());
const flatBlocks = () => [...walkBlocks()].map(([b]) => b).filter((b) => b.type !== 'columns');
const blockOf = (node) => {
  const id = Number(node.closest('.block')?.dataset.id);
  return [...walkBlocks()].find(([b]) => b.id === id)?.[0];
};

// ---------- caret helpers (offsets are in the block's raw text) ----------
function offsets(content) {
  const sel = getSelection();
  const len = content.textContent.length;
  if (!sel.rangeCount || !content.contains(sel.anchorNode)) return [len, len];
  const r = sel.getRangeAt(0);
  const pre = document.createRange();
  pre.selectNodeContents(content);
  pre.setEnd(r.startContainer, r.startOffset);
  const start = pre.toString().length;
  return [start, start + r.toString().length];
}

function locate(content, offset) {
  const walker = document.createTreeWalker(content, NodeFilter.SHOW_TEXT);
  let node;
  let left = offset;
  while ((node = walker.nextNode())) {
    if (left <= node.data.length) return { node, offset: left };
    left -= node.data.length;
  }
  const last = content.lastChild?.classList?.contains('sentinel') ? 1 : 0;
  return { node: content, offset: content.childNodes.length - last };
}

function setSelection(content, start, end = start) {
  const a = locate(content, start);
  const b = locate(content, end);
  const range = document.createRange();
  range.setStart(a.node, a.offset);
  range.setEnd(b.node, b.offset);
  const sel = getSelection();
  sel.removeAllRanges();
  sel.addRange(range);
}

function caretRect() {
  const sel = getSelection();
  if (!sel.rangeCount) return null;
  const rects = sel.getRangeAt(0).getClientRects();
  return rects.length ? rects[rects.length - 1] : null;
}

function onEdgeLine(content, dir, offset) {
  const text = content.textContent;
  const rect = caretRect();
  if (!rect || !rect.height) return dir === 'up' ? !text.slice(0, offset).includes('\n') : !text.slice(offset).includes('\n');
  const box = content.getBoundingClientRect();
  const lh = parseFloat(getComputedStyle(content).lineHeight) || 24;
  return dir === 'up' ? rect.top - box.top < lh : box.bottom - rect.bottom < lh;
}

function pointToCaret(x, y) {
  if (document.caretPositionFromPoint) {
    const p = document.caretPositionFromPoint(x, y);
    return p && { node: p.offsetNode, offset: p.offset };
  }
  if (document.caretRangeFromPoint) {
    const r = document.caretRangeFromPoint(x, y);
    return r && { node: r.startContainer, offset: r.startOffset };
  }
  return null;
}

function focusBlock(id, offset = 0) {
  const wrap = blocksEl.querySelector(`.block[data-id="${id}"]`);
  if (!wrap) return;
  const content = wrap.querySelector(':scope > .content');
  if (!content) return wrap.querySelector('.divider, .img-block, .cell')?.focus();
  const b = blockOf(content);
  setRaw(content, b);
  content.focus();
  setSelection(content, offset === 'end' ? b.text.length : Math.min(offset, b.text.length));
}

function focusSibling(b, dir) {
  const blocks = flatBlocks();
  const target = blocks[blocks.indexOf(b) + dir];
  if (target) return focusBlock(target.id, dir < 0 ? 'end' : 0);
  if (dir < 0) {
    titleEl.focus();
    getSelection().selectAllChildren(titleEl);
    getSelection().collapseToEnd();
  }
}

function structural(id, offset, then) {
  closeMenu();
  rerender();
  focusBlock(id, offset);
  then?.();
}

// ---------- editing operations ----------
function setType(b, type) {
  b.type = type;
  b.blankBefore = undefined;
  if (!isList(type)) b.indent = '';
  if (type === 'todo') b.checked = false;
  if (type === 'code') {
    b.fence = '```';
    b.info = '';
  }
  if (type === 'divider') b.text = '---';
}

const listProps = (b) => (isList(b.type) ? { indent: b.indent, marker: b.marker, delim: b.delim, checked: false } : {});

function insertText(content, b, str, start, end) {
  b.text = b.text.slice(0, start) + str + b.text.slice(end);
  setRaw(content, b);
  setSelection(content, start + str.length);
  changed();
}

function wrapSelection(content, b, mark, start, end) {
  const t = b.text;
  b.text = t.slice(0, start) + mark + t.slice(start, end) + mark + t.slice(end);
  setRaw(content, b);
  setSelection(content, start + mark.length, end + mark.length);
  changed();
}

function splitBlock(b, start, end) {
  const blocks = ownerList(b);
  const i = blocks.indexOf(b);
  if (isList(b.type) && b.text === '') {
    // Enter on an empty list item leaves the list (outdenting first), like Notion
    if (b.indent) return indentBlock(b, -1, 0);
    setType(b, 'text');
    changed();
    return structural(b.id, 0);
  }
  const before = b.text.slice(0, start);
  const after = b.text.slice(end);
  if (before === '' && after !== '') {
    blocks.splice(i, 0, newBlock(isList(b.type) ? b.type : 'text', '', listProps(b)));
    changed();
    return structural(b.id, 0);
  }
  b.text = before;
  const nb = newBlock(isList(b.type) ? b.type : 'text', after, listProps(b));
  blocks.splice(i + 1, 0, nb);
  changed();
  structural(nb.id, 0);
}

function backspaceAtStart(b) {
  const blocks = ownerList(b);
  const i = blocks.indexOf(b);
  if (isList(b.type) && b.indent) return indentBlock(b, -1, 0);
  if (b.type !== 'text' && (b.type !== 'code' || b.text === '')) {
    setType(b, 'text');
    changed();
    return structural(b.id, 0);
  }
  if (b.type === 'code') return;
  const prev = blocks[i - 1];
  if (!prev) return;
  if (prev.type === 'divider') {
    blocks.splice(i - 1, 1);
    changed();
    return structural(b.id, 0);
  }
  const at = prev.text.length;
  prev.text += b.text;
  blocks.splice(i, 1);
  changed();
  structural(prev.id, at);
}

function mergeNext(b) {
  const blocks = ownerList(b);
  const i = blocks.indexOf(b);
  const next = blocks[i + 1];
  if (!next) return;
  const at = b.text.length;
  if (next.type !== 'divider') b.text += next.text;
  blocks.splice(i + 1, 1);
  changed();
  structural(b.id, at);
}

function indentBlock(b, dir, caret) {
  if (dir > 0) {
    const list = ownerList(b);
    const prev = list[list.indexOf(b) - 1];
    if (!prev || !isList(prev.type) || indentWidth(prev.indent) < indentWidth(b.indent)) return;
    b.indent = `\t${b.indent}`;
  } else {
    if (!b.indent) return;
    b.indent = b.indent.replace(/(\t| {1,4})$/, '');
  }
  changed();
  structural(b.id, caret);
}

function dividerKey(e, b) {
  const blocks = ownerList(b);
  const i = blocks.indexOf(b);
  if (e.key === 'Backspace' || e.key === 'Delete') {
    e.preventDefault();
    blocks.splice(i, 1);
    resetGap(blocks[i]);
    changed();
    rerender();
    const t = blocks[i - 1] ?? blocks[i];
    if (t) focusBlock(t.id, 'end');
  } else if (e.key === 'ArrowUp' || e.key === 'ArrowDown') {
    e.preventDefault();
    focusSibling(b, e.key === 'ArrowUp' ? -1 : 1);
  } else if (e.key === 'Enter') {
    e.preventDefault();
    const nb = newBlock();
    blocks.splice(i + 1, 0, nb);
    changed();
    structural(nb.id, 0);
  }
}

// ---------- inserting from the menus (slash command and right-click) ----------
// Puts blocks after `b`, or in place of it when it is empty text. Returns the first new block.
function insertBlocks(b, nbs) {
  const list = ownerList(b);
  const i = list.indexOf(b);
  const replace = b.type === 'text' && b.text === '';
  list.splice(replace ? i : i + 1, replace ? 1 : 0, ...nbs);
  const last = nbs[nbs.length - 1];
  resetGap(list[list.indexOf(last) + 1]);
  if (list[list.length - 1] === last) list.push(newBlock());
  changed();
  closeMenu();
  rerender();
  return nbs[0];
}

// Notes that read like this one, shown under the page. Taken from the text alone; the panel stays hidden when there are none.
async function loadRelated(path) {
  const box = $('#related');
  box.hidden = true;
  box.replaceChildren();
  let found;
  try {
    found = await api('GET', `/api/related?path=${enc(path)}`);
  } catch {
    return; // the panel is optional: a failed lookup just leaves it out
  }
  if (state.page?.path !== path || !found.related.length) return;
  box.append(el('p', 'eyebrow mono', 'Notas relacionadas'));
  for (const r of found.related) {
    const a = el('a', 'related-link', r.name);
    a.href = `#/${enc(r.path)}`;
    a.addEventListener('click', (e) => {
      e.preventDefault();
      go(r.path);
    });
    box.append(a);
  }
  box.hidden = false;
}

// Saves the open page first, then downloads it as one standalone HTML file (pictures inside; see lib/export.mjs).
async function exportPage() {
  if (!state.page) return;
  await flushSave();
  const link = el('a');
  link.href = `/api/export?path=${enc(state.page.path)}`;
  link.download = '';
  document.body.append(link);
  link.click();
  link.remove();
  setStatus('Exportación iniciada: el HTML se descarga con las imágenes dentro');
}

async function insertItem(b, item) {
  switch (item.type) {
    case 'callout':
      return focusBlock(insertBlocks(b, [newBlock('quote', '[!note] ')]).id, 'end');
    case 'embed': {
      const raw = await askText('Dirección web que incrustar (https://…). Los enlaces de YouTube se convierten solos.');
      if (!raw?.trim()) return;
      const url = embedUrl(raw.trim());
      if (!isHttps(url)) return setStatus('Solo se pueden incrustar direcciones https://');
      return insertBlocks(b, [newBlock('embed', embedLine(url))]);
    }
    case 'button': {
      const label = (await askText('Texto del botón', 'Nueva nota'))?.replace(/[<>"]/g, '').trim();
      if (!label) return;
      const folder = await askText('Carpeta de la nota nueva (vacío = raíz)', folderOf(state.page.path).slice(0, -1));
      if (folder === null) return;
      if (/["<>]/.test(folder)) return setStatus('Los nombres de carpeta no pueden contener " < >');
      return insertBlocks(b, [newBlock('button', buttonLine(folder.trim(), label))]);
    }
    case 'database':
      return openDatabasePicker(b, item);
    case 'subpages': {
      const kids = (pageNode(state.page.path.slice(0, -3))?.children ?? []).filter((c) => c.path);
      if (!kids.length) return setStatus('Esta página no tiene subpáginas');
      return insertBlocks(
        b,
        kids.map((c) => newBlock('bullet', `[[${c.name}]]`)),
      );
    }
    case 'cover':
      return editCover('source');
    case 'export':
      return exportPage();
    case 'summary': {
      // Sentences of this note that carry its main words, as a callout. Nothing is written that the note does not already say.
      const lines = summarize(state.page.blocks.map((x) => x.text).join('\n'), 3);
      if (!lines.length) return setStatus('La nota es demasiado corta para resumirla');
      return insertBlocks(b, [newBlock('quote', ['[!note] Resumen', ...lines].join('\n'))]);
    }
    case 'tags': {
      // Tags this note does not have yet, as a line to keep or delete. Suggested from the words only.
      const { tags } = await api('GET', `/api/related?path=${enc(state.page.path)}`);
      if (!tags.length) return setStatus('No hay etiquetas que sugerir');
      return insertBlocks(b, [newBlock('text', `Etiquetas sugeridas: ${tags.map((t) => `#${t}`).join(' ')}`)]);
    }
    case 'icon': {
      const emoji = await askText('Icono de la página: un emoji o una imagen (un archivo del vault o una dirección https://). Déjalo vacío para quitarlo.', '');
      if (emoji === null) return;
      return setPageProp('icon', emoji.trim());
    }
    case 'link': {
      const nb = insertBlocks(b, [newBlock('text', '[[')]);
      return structural(nb.id, 2, () => inputTriggers(blockContent(nb), nb));
    }
    case 'media':
      return pickMedia(b, item.kind);
    case 'bookmark': {
      const url = await askText('Dirección web (https://…)');
      if (url === null) return;
      if (!isHttps(url.trim())) return setStatus('Los marcadores necesitan una dirección https://');
      const title = await askText('Título del marcador', url.trim().replace(/^https:\/\//, '').split('/')[0]);
      if (title === null) return;
      return insertBlocks(b, [newBlock('bookmark', bookmarkLine(url.trim(), title.trim() || url.trim()))]);
    }
    case 'fullwidth':
      return setPageProp('width', (state.page.frontmatter ?? '').includes('width: full') ? '' : 'full');
    case 'divider':
      return insertBlocks(b, [newBlock('divider', '---')]);
    default: {
      const nb = insertBlocks(b, [newBlock(item.type, item.text ?? '')]);
      return focusBlock(nb.id, 'end');
    }
  }
}

// Right-click menu: tables, images and columns use their own builders; the rest goes through insertItem.
const insertPicker = (b) => (item) =>
  item.type === 'table' || item.type === 'image' || item.type === 'columns' ? insertStructure(b, item, b.text.length) : insertItem(b, item);

const pageNode = (key, nodes = state.tree) => {
  for (const n of nodes) {
    if (n.key === key) return n;
    const found = pageNode(key, n.children);
    if (found) return found;
  }
  return null;
};

// Sets a property of the open page; it is saved with the rest of the page.
function setPageProp(key, value) {
  setPageProps({ [key]: value });
}

// Sets several properties of the open page with one save ('' removes a key).
function setPageProps(patch) {
  for (const [key, value] of Object.entries(patch)) state.page.frontmatter = setProp(state.page.frontmatter, key, value);
  renderProps(state.page.frontmatter);
  renderCover(state.page.frontmatter);
  changed();
  if ('icon' in patch) treeIcon(state.page.path, patch.icon);
}

// Shows a page's new icon in the sidebar without reloading the tree.
function treeIcon(path, icon) {
  const find = (nodes) => nodes.find((n) => n.path === path) ?? nodes.map((n) => find(n.children)).find(Boolean);
  const node = find(state.tree);
  if (!node) return;
  node.icon = icon || undefined;
  renderTree();
}

const LOOK_KEYS = new Set([...FRAME_KEYS, 'icon', 'cover', 'width']);
const pageValues = () => Object.fromEntries(((state.page?.frontmatter && parseProps(state.page.frontmatter)) || []).map((r) => [r.key, r.value]));

// The banner: its image framed as the page says (see cover.mjs), with buttons that appear when the pointer is over it.
function renderCover(frontmatter) {
  const rows = (frontmatter && parseProps(frontmatter)) || [];
  const values = Object.fromEntries(rows.map((r) => [r.key, r.value]));
  const c = readCover(values);
  const from = state.page?.path ?? '';
  const src = coverSrc(c.src, from);
  const cover = $('#cover');
  cover.replaceChildren();
  cover.classList.remove('broken');
  cover.hidden = !src;
  if (src) {
    cover.style.height = `${c.height}px`; // CSSOM: the page's CSP forbids style attributes
    const img = el('img');
    img.src = src;
    img.alt = '';
    img.draggable = false;
    Object.assign(img.style, frameStyle(c));
    img.addEventListener('error', () => {
      cover.classList.add('broken');
      cover.replaceChildren(el('span', '', 'No se pudo cargar la portada'), coverBar());
    });
    cover.append(img, coverBar());
  }
  document.querySelector('.page-layout').classList.toggle('full', values.width === 'full');
  const iconBox = $('#page-icon');
  iconBox.replaceChildren();
  const iconValue = values.icon ?? '';
  const iconUrl = isImageRef(iconValue) ? coverSrc(iconValue, from) : '';
  if (iconUrl) {
    const img = el('img', 'page-icon-img');
    img.src = iconUrl;
    img.alt = '';
    iconBox.append(img);
  } else iconBox.textContent = iconValue;
  iconBox.hidden = !iconValue;
}

function coverBar() {
  const bar = el('div', 'cover-bar');
  for (const [label, focus] of [['Encuadrar', 'frame'], ['Cambiar imagen', 'source']]) {
    const b = el('button', '', label);
    b.type = 'button';
    b.addEventListener('click', () => editCover(focus));
    bar.append(b);
  }
  const remove = el('button', '', 'Quitar');
  remove.type = 'button';
  remove.addEventListener('click', () => setPageProps(removePatch()));
  bar.append(remove);
  return bar;
}

// The framing editor for this page's banner; with no banner yet it starts on the image field.
function editCover(focus) {
  const cover = readCover(pageValues());
  openCoverEditor({
    cover,
    pagePath: state.page.path,
    boxWidth: $('#cover').clientWidth || document.querySelector('.page-layout').clientWidth - 96,
    focus,
    upload: uploadImage,
    onSave: setPageProps,
    onRemove: () => setPageProps(removePatch()),
  });
}

// Changes one property of another note, through its file so the rest of the note is kept as it is.
async function setNoteProp(path, key, value) {
  const data = await api('GET', `/api/page?path=${enc(path)}`);
  const fm = data.content.match(/^---\n(?:[\s\S]*?\n)?---(?:\n|$)/)?.[0] ?? '';
  const next = setProp(fm, key, value) + data.content.slice(fm.length);
  await api('PUT', '/api/page', { path, content: next, baseMtime: data.mtime });
}

const embedEl = (b) => {
  const src = embedSrc(b.text);
  if (!isHttps(src)) return el('p', 'db-empty', 'Esta incrustación necesita una dirección https://. Bórrala y añade otra.');
  const frame = el('iframe', 'embed');
  frame.src = src;
  frame.title = 'Contenido incrustado';
  frame.loading = 'lazy';
  frame.referrerPolicy = 'no-referrer';
  frame.setAttribute('sandbox', 'allow-scripts allow-same-origin allow-popups allow-forms allow-presentation');
  return frame;
};

const buttonEl = (b) => {
  const parts = buttonParts(b.text) ?? { folder: '', label: 'Button' };
  const btn = el('button', 'btn-block', parts.label);
  btn.type = 'button';
  btn.addEventListener('click', () => createPage(parts.folder ? `${parts.folder.replace(/\/+$/, '')}/` : '', 'Sin título'));
  return btn;
};


// Menu like Notion's: a database that already exists (a page with a database block), or a new one made in this page.
async function openDatabasePicker(b, item) {
  try {
    const rect = caretRect() ?? blockContent(b).getBoundingClientRect();
    const { databases } = await api('GET', '/api/databases');
    // The page itself is left out: embedding a database inside its own page would show it recursively.
    const found = databases.filter((d) => d.path !== state.page.path).map((d) => d.path.slice(0, -3));
    const items = [...found.map((page) => ({ label: page, hint: 'existente', key: page })), { label: 'Crear una base de datos nueva', hint: 'nueva', key: null }];
    menuMeta = { title: 'Elige una base de datos', right: `${found.length} existentes`, foot: '↑↓ moverse · ↵ elegir · esc cerrar' };
    openMenu(items, rect, async (pick) => {
      try {
        const page = pick.key ?? (await createDatabase(b, item));
        if (page) embedDatabase(b, page);
      } catch (e) {
        setStatus(e.message);
      }
    });
  } catch (e) {
    setStatus(e.message);
  }
}

// A new database lives inside the current page: "Page/Name.md" is its page and "Page/Name/" holds its rows.
// Returns the page path without ".md" (the same name the embed block uses), or null when cancelled.
async function createDatabase(b, item) {
  const name = (await askText('Nombre de la base de datos nueva', 'Base de datos'))?.replace(/\s+/g, ' ').trim();
  if (!name) return null;
  if (!validName(name)) {
    setStatus(BAD_NAME.replace('de página', 'de base de datos'));
    return null;
  }
  const stem = state.page.path.slice(0, -3);
  const source = `${stem}/${name}`;
  await api('POST', '/api/folder', { path: source });
  await api('PUT', '/api/page', { path: `${source}.md`, content: newDatabasePage(source, item.view), baseMtime: null });
  expanded.add(stem);
  saveExpanded();
  await loadTree();
  return source;
}

// The note only embeds the database page ("page: Page/Name"), so the same database can be shown in many notes.
function embedDatabase(b, page) {
  return insertBlocks(b, [newBlock('code', `page: ${page}`, { info: 'database', fence: '```', indent: '' })]);
}

// A new note in the database folder, opened straight away.
async function createDbRow(cfg, rect) {
  const folder = cfg.source.replace(/\/+$/, '');
  const taken = new Set(allPages().map((p) => p.toLowerCase()));
  let name = 'Sin título';
  for (let n = 2; taken.has(`${folder}/${name}.md`.toLowerCase()); n++) name = `Sin título ${n}`;
  const path = `${folder}/${name}.md`;
  await api('PUT', '/api/page', { path, content: '', baseMtime: null });
  await loadTree();
  openPeek(path, { mode: 'center', rect, isNew: true, onClose: () => loadTree().then(route), onExpand: () => go(path, { focusTitle: true }) });
}

// Video, audio or any file: pick it, store it in attachments, and insert it as a block.
function pickMedia(b, kind) {
  const input = el('input');
  input.type = 'file';
  input.accept = kind === 'video' ? 'video/*' : kind === 'audio' ? 'audio/*' : '';
  input.multiple = kind === 'file';
  input.addEventListener('change', async () => {
    const files = [...input.files];
    if (!files.length) return;
    setStatus('Subiendo…');
    const names = [];
    try {
      for (const f of files) names.push(await uploadImage(f));
    } catch (e) {
      return setStatus(e.message);
    }
    setStatus('');
    insertBlocks(b, names.map((n) => newBlock('image', `![[${n}]]`)));
  });
  return input.click();
}

// A web bookmark card: the title is the one the user typed, nothing is fetched from the site.
const bookmarkEl = (b) => {
  const parts = bookmarkParts(b.text);
  if (!parts) return el('p', 'db-empty', 'Este marcador necesita una dirección https://. Bórralo y añade otro.');
  const a = el('a', 'bookmark-card');
  a.href = parts.url;
  a.target = '_blank';
  a.rel = 'noopener noreferrer';
  a.append(icon('globe', 18), el('span', 'bookmark-title', parts.title), el('span', 'bookmark-host', new URL(parts.url).host));
  return a;
};

// What the database blocks need from the editor (see database-ui.mjs).
const dbCtx = {
  rerender: () => rerender(),
  changed,
  api,
  setStatus,
  setProp: setNoteProp,
  createRow: (source, rect) => createDbRow({ source }, rect),
  peek: (path) => openPeek(path, { mode: 'side', onClose: () => loadTree().then(route), onExpand: () => go(path) }),
  editSource: (b) => {
    b.showSource = true;
    rerender();
  },
  updateSchema,
  renameRowsProp: (folder, from, to) => api('POST', '/api/db/prop', { folder, from, to }),
  open: openByName,
};

// ---------- popup menu (slash commands, link picker) ----------
const menuEl = $('#menu');
const menu = { open: false, items: [], index: 0, pick: null };
let menuMeta = {}; // header/footer text for the next openMenu call

function openMenu(items, rect, pick) {
  if (!items.length) return closeMenu();
  Object.assign(menu, { open: true, items, index: 0, pick });
  const head = el('div', 'menu-head');
  head.append(el('span', '', menuMeta.title ?? ''), el('span', 'meta-r', menuMeta.right ?? ''));
  const list = el('div', 'menu-list');
  let section = null;
  items.forEach((it, i) => {
    // Section headings appear where the group changes; they are not rows, so row indexes stay as they were.
    if (it.group && it.group !== section) {
      section = it.group;
      list.append(el('div', 'menu-group', it.group));
    }
    const row = el('div', 'menu-item');
    row.id = `menu-${i}`;
    row.setAttribute('role', 'option');
    if (it.icon) {
      const ic = icon(it.icon, 16);
      ic.setAttribute('class', 'menu-icon');
      row.append(ic);
    }
    row.append(el('span', 'label', it.label));
    if (it.hint) row.append(el('span', 'hint', it.hint));
    if (it.desc) row.append(el('span', 'desc', it.desc));
    row.addEventListener('mousedown', (e) => {
      e.preventDefault(); // keep the caret in the block
      chooseMenu(i);
    });
    list.append(row);
  });
  menuEl.replaceChildren(head, list, el('div', 'menu-foot', menuMeta.foot ?? ''));
  menuMeta = {};
  menuEl.hidden = false;
  highlightMenu();
  const below = rect.bottom + 4;
  const top = below + menuEl.offsetHeight > innerHeight ? Math.max(8, rect.top - 4 - menuEl.offsetHeight) : below;
  menuEl.style.left = `${Math.max(8, Math.min(rect.left, innerWidth - menuEl.offsetWidth - 8))}px`;
  menuEl.style.top = `${top}px`;
}

function closeMenu() {
  menu.open = false;
  menuEl.hidden = true;
}

function highlightMenu() {
  const rows = menuEl.querySelectorAll('.menu-item');
  rows.forEach((row, i) => {
    row.classList.toggle('active', i === menu.index);
    row.setAttribute('aria-selected', String(i === menu.index));
  });
  rows[menu.index]?.scrollIntoView({ block: 'nearest' });
}

function chooseMenu(i) {
  const { pick, items } = menu;
  closeMenu();
  pick(items[i]);
}

function menuKey(e) {
  const n = menu.items.length;
  if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
    menu.index = (menu.index + (e.key === 'ArrowDown' ? 1 : n - 1)) % n;
    highlightMenu();
  } else if (e.key === 'Enter' || e.key === 'Tab') {
    chooseMenu(menu.index);
  } else if (e.key === 'Escape') {
    closeMenu();
  } else {
    return false;
  }
  e.preventDefault();
  return true;
}

// The insert menu, in Notion's sections. `group` gives the section heading, `icon` the row icon.
const SLASH = [
  { group: 'Bloques básicos', label: 'Texto', type: 'text', icon: 'text', keys: 'text paragraph plain parrafo' },
  { group: 'Bloques básicos', label: 'Título 1', type: 'h1', icon: 'heading', keys: 'h1 title heading titulo encabezado', hint: '#' },
  { group: 'Bloques básicos', label: 'Título 2', type: 'h2', icon: 'heading', keys: 'h2 subtitle heading titulo subtitulo encabezado', hint: '##' },
  { group: 'Bloques básicos', label: 'Título 3', type: 'h3', icon: 'heading', keys: 'h3 heading titulo encabezado', hint: '###' },
  { group: 'Bloques básicos', label: 'Lista de tareas', type: 'todo', icon: 'check', keys: 'todo task checkbox casilla pendiente', hint: '[]' },
  { group: 'Bloques básicos', label: 'Lista de viñetas', type: 'bullet', icon: 'list', keys: 'bullet ul list vinetas puntos', hint: '-' },
  { group: 'Bloques básicos', label: 'Lista numerada', type: 'numbered', icon: 'numbered', keys: 'numbered ol list numeros', hint: '1.' },
  { group: 'Bloques básicos', label: 'Cita', type: 'quote', icon: 'quote', keys: 'quote blockquote', hint: '>' },
  { group: 'Bloques básicos', label: 'Callout (aviso)', type: 'callout', icon: 'alert', keys: 'note info tip warning box nota consejo advertencia destacado', hint: '[!]' },
  { group: 'Bloques básicos', label: 'Código', type: 'code', icon: 'code', keys: 'code snippet codigo', hint: '```' },
  { group: 'Bloques básicos', label: 'Divisor', type: 'divider', icon: 'divider', keys: 'divider hr line separator linea separador', hint: '---' },
  { group: 'Bloques básicos', label: 'Enlace a página', type: 'link', icon: 'link', keys: 'link wikilink mention page pagina', hint: '[[' },
  { group: 'Bloques básicos', label: 'Tabla simple', type: 'table', icon: 'table', keys: 'table grid rows spreadsheet markdown filas', hint: '|' },
  { group: 'Bloques básicos', label: 'Botón: nota nueva', type: 'button', icon: 'button', keys: 'button template create new note boton plantilla crear', hint: '[ ]' },
  { group: 'Base de datos', label: 'Tabla', type: 'database', view: 'table', icon: 'table', keys: 'database table list records registros', hint: '▦' },
  { group: 'Base de datos', label: 'Tablero', type: 'database', view: 'board', icon: 'board', keys: 'database board kanban status group estado', hint: '▦' },
  { group: 'Base de datos', label: 'Galería', type: 'database', view: 'gallery', icon: 'grid', keys: 'database gallery cards covers galeria tarjetas portadas', hint: '▦' },
  { group: 'Base de datos', label: 'Lista', type: 'database', view: 'list', icon: 'list', keys: 'database list rows filas', hint: '▦' },
  { group: 'Base de datos', label: 'Número', type: 'database', view: 'number', icon: 'hash', keys: 'database number chart count sum total numero grafico suma', hint: '#' },
  { group: 'Base de datos', label: 'Gráfico de donut', type: 'database', view: 'donut', icon: 'donut', keys: 'database donut pie chart share grafico tarta', hint: '◔' },
  { group: 'Base de datos', label: 'Gráfico de barras', type: 'database', view: 'bar', icon: 'bar', keys: 'database bar chart barras columnas grafico fecha mes', hint: '▮' },
  { group: 'Base de datos', label: 'Gráfico de líneas', type: 'database', view: 'line', icon: 'line', keys: 'database line chart lineas grafico evolucion fecha', hint: '⟋' },
  { group: 'Medios', label: 'Imagen', type: 'image', icon: 'image', keys: 'image picture photo upload foto subir', hint: '![[ ]]' },
  { group: 'Medios', label: 'Vídeo', type: 'media', kind: 'video', icon: 'video', keys: 'video movie clip mp4 upload subir', hint: '▶' },
  { group: 'Medios', label: 'Audio', type: 'media', kind: 'audio', icon: 'audio', keys: 'sound music mp3 upload sonido musica subir', hint: '♪' },
  { group: 'Medios', label: 'Archivo', type: 'media', kind: 'file', icon: 'file', keys: 'file document pdf attachment upload documento adjunto subir', hint: '⎘' },
  { group: 'Medios', label: 'Marcador web', type: 'bookmark', icon: 'bookmark', keys: 'bookmark link website url card enlace tarjeta', hint: '🔖' },
  { group: 'Medios', label: 'Incrustación o enlace de vídeo', type: 'embed', icon: 'globe', keys: 'embed iframe youtube web page clock timer incrustar', hint: '<>' },
  { group: 'Diseño', label: '2 columnas', type: 'columns', n: 2, icon: 'columns', keys: 'columns div layout side lado', hint: '▥' },
  { group: 'Diseño', label: '3 columnas', type: 'columns', n: 3, icon: 'columns', keys: 'columns div layout side lado', hint: '▥' },
  { group: 'Diseño', label: '3 columnas, estrecha · ancha · estrecha', type: 'columns', ratios: [16, 61, 22], icon: 'columns', keys: 'columns layout ratio book panel', hint: '▥' },
  { group: 'Página', label: 'Enlaces a subpáginas', type: 'subpages', icon: 'subpages', keys: 'subpages children links pages index subpaginas indice', hint: '↳' },
  { group: 'Página', label: 'Imagen de portada', type: 'cover', icon: 'image', keys: 'cover banner header picture page cabecera', hint: '▭' },
  { group: 'Página', label: 'Icono', type: 'icon', icon: 'smile', keys: 'icon emoji page symbol simbolo', hint: '☺' },
  { group: 'Página', label: 'Ancho completo', type: 'fullwidth', icon: 'expand', keys: 'full wide width page ancha', hint: '↔' },
  { group: 'Página', label: 'Exportar página (HTML)', type: 'export', icon: 'file', keys: 'export download html share archivo compartir exportar', hint: '⤓' },
  { group: 'Página', label: 'Resumen automático', type: 'summary', icon: 'quote', keys: 'resumen summary resumir extracto', hint: '…' },
  { group: 'Página', label: 'Etiquetas sugeridas', type: 'tags', icon: 'tag', keys: 'etiquetas tags sugerir', hint: '#' },
];
// Items that insert something new (a block, or a page property) instead of changing the current block's type.
const INSERTS = new Set(['callout', 'embed', 'button', 'database', 'subpages', 'cover', 'icon', 'media', 'bookmark', 'fullwidth']);

const SHORTCUTS = [
  [/^# $/, 'h1'],
  [/^## $/, 'h2'],
  [/^### $/, 'h3'],
  [/^\[ ?\] $/, 'todo'],
  [/^[-*+] $/, 'bullet'],
  [/^1[.)] $/, 'numbered'],
  [/^> $/, 'quote'],
  [/^```$/, 'code'],
];

function inputTriggers(content, b) {
  const [caret] = offsets(content);
  const before = b.text.slice(0, caret);
  if (b.type === 'text') {
    for (const [re, type] of SHORTCUTS) {
      if (re.test(before)) {
        b.text = b.text.slice(before.length);
        setType(b, type);
        changed();
        return structural(b.id, 0);
      }
    }
    if (b.text === '---') {
      setType(b, 'divider');
      const nb = newBlock();
      ownerList(b).splice(ownerList(b).indexOf(b) + 1, 0, nb);
      changed();
      return structural(nb.id, 0);
    }
  }
  if (b.type === 'code') return closeMenu();
  let m = before.match(/(?:^|\s)\/([^\s/]*)$/);
  if (m) return openSlash(content, b, m[1], caret - m[1].length - 1);
  m = before.match(/\[\[([^[\]|#\n]*)$/);
  if (m) return openLinkMenu(content, b, m[1], caret - m[1].length);
  closeMenu();
}

function openSlash(content, b, query, start) {
  const q = query.toLowerCase();
  const nested = ownerList(b) !== state.page.blocks;
  const items = SLASH.filter((it) => !(nested && it.type === 'columns') && `${it.label} ${it.keys}`.toLowerCase().includes(q));
  menuMeta = { title: 'Bloques', right: `${items.length}`, foot: '↑↓ moverse · ↵ insertar · esc cerrar' };
  openMenu(items, caretRect() ?? content.getBoundingClientRect(), (item) => {
    const [caret] = offsets(content);
    b.text = b.text.slice(0, start) + b.text.slice(caret); // drop the "/query"
    const blocks = ownerList(b);
    if (item.type === 'table' || item.type === 'image' || item.type === 'columns') return insertStructure(b, item, start);
    if (item.type === 'link') {
      b.text = `${b.text.slice(0, start)}[[${b.text.slice(start)}`;
      changed();
      return structural(b.id, start + 2, () => inputTriggers(content.isConnected ? content : blockContent(b), b));
    }
    if (item.type === 'divider') {
      let div = b;
      if (b.text.trim() === '') setType(b, 'divider');
      else {
        div = newBlock('divider', '---');
        blocks.splice(blocks.indexOf(b) + 1, 0, div);
      }
      let next = blocks[blocks.indexOf(div) + 1];
      if (!next || next.type === 'divider') {
        next = newBlock();
        blocks.splice(blocks.indexOf(div) + 1, 0, next);
      }
      changed();
      return structural(next.id, 0);
    }
    if (INSERTS.has(item.type)) return insertItem(b, item);
    setType(b, item.type);
    changed();
    structural(b.id, start);
  });
}

const blockContent = (b) => blocksEl.querySelector(`.block[data-id="${b.id}"] .content`);

function openLinkMenu(content, b, query, start) {
  const pages = allPages();
  const q = query.toLowerCase();
  const items = pages
    .map((path) => ({ path, lt: linktext(path, pages) }))
    .filter((x) => x.lt.toLowerCase().includes(q))
    .sort((x, y) => Number(y.lt.toLowerCase().startsWith(q)) - Number(x.lt.toLowerCase().startsWith(q)) || x.lt.localeCompare(y.lt))
    .slice(0, 8)
    .map((x) => ({ label: baseName(x.path), hint: x.lt.includes('/') ? folderOf(x.path) : '', desc: state.byPath.get(x.path)?.snippet ?? '', lt: x.lt }));
  const matches = items.length;
  const name = query.trim();
  if (validName(name) && !pages.some((p) => baseName(p).toLowerCase() === name.toLowerCase())) {
    items.push({ label: `Página nueva “${name}”`, hint: 'crear', create: name });
  }
  menuMeta = { title: 'Enlazar página', right: `${matches} coincidencia${matches === 1 ? '' : 's'}`, foot: '↵ insertar · ↑↓ moverse · esc cerrar' };
  openMenu(items, caretRect() ?? content.getBoundingClientRect(), async (item) => {
    const [caret] = offsets(content);
    const lt = item.lt ?? item.create;
    const rest = b.text.slice(caret);
    const close = rest.startsWith(']]') ? '' : ']]';
    b.text = b.text.slice(0, start) + lt + close + rest;
    setRaw(content, b);
    setSelection(content, start + lt.length + 2);
    changed();
    if (item.create) {
      try {
        await api('PUT', '/api/page', { path: `${item.create}.md`, content: '', baseMtime: null });
        await loadTree();
      } catch (e) {
        setStatus(e.message);
      }
    }
  });
}

// ---------- block events ----------
blocksEl.addEventListener('mousedown', (e) => {
  const content = e.target.closest('.content');
  if (!content || content.dataset.mode === 'edit' || e.button !== 0) return;
  e.preventDefault();
  if (e.target.closest('a')) return; // the click handler follows the link
  const b = blockOf(content);
  let shown = content.textContent.length;
  const pos = pointToCaret(e.clientX, e.clientY);
  if (pos && content.contains(pos.node)) {
    const r = document.createRange();
    r.selectNodeContents(content);
    r.setEnd(pos.node, pos.offset);
    shown = r.toString().length;
  }
  focusBlock(b.id, b.type === 'code' ? shown : renderedToRaw(b.text, shown));
});

blocksEl.addEventListener('click', (e) => {
  const a = e.target.closest('a');
  if (!a) return;
  if (a.classList.contains('wikilink')) {
    e.preventDefault();
    followLink(a.dataset.link);
  } else if (a.classList.contains('tag')) {
    e.preventDefault();
    openSwitcher(`tag:${a.dataset.tag}`);
  }
});

blocksEl.addEventListener('focusin', (e) => {
  const content = e.target.closest?.('.content');
  if (!content || content.dataset.mode === 'edit') return;
  const b = blockOf(content);
  setRaw(content, b);
  setSelection(content, b.text.length);
});

blocksEl.addEventListener('focusout', (e) => {
  const content = e.target.closest?.('.content');
  if (!content || !content.isConnected) return;
  const b = blockOf(content);
  if (b) showRendered(content, b);
  closeMenu();
});

blocksEl.addEventListener('input', (e) => {
  const content = e.target.closest?.('.content');
  if (!content) return;
  const b = blockOf(content);
  if (!b) return;
  b.text = content.textContent;
  if (b.text.endsWith('\n') && !content.querySelector('.sentinel')) content.append(sentinel());
  content.classList.toggle('is-empty', b.text === '');
  changed();
  inputTriggers(content, b);
});

blocksEl.addEventListener('paste', (e) => {
  const content = e.target.closest?.('.content');
  if (!content) return;
  e.preventDefault();
  const b = blockOf(content);
  const files = [...(e.clipboardData?.files ?? [])];
  if (files.some((f) => f.type.startsWith('image/'))) {
    const list = ownerList(b);
    return insertImages(files, list, list.indexOf(b) + 1);
  }
  const text = (e.clipboardData?.getData('text/plain') ?? '').replace(/\r\n?/g, '\n');
  const [start, end] = offsets(content);
  if (b.type === 'code' || !text.includes('\n')) return insertText(content, b, text, start, end);
  // Multi-line paste becomes real blocks, the way Notion turns pasted Markdown into blocks.
  const pasted = parse(text).blocks;
  if (!pasted.length) return;
  pasted[0].blankBefore = undefined;
  const blocks = ownerList(b);
  const i = blocks.indexOf(b);
  const after = b.text.slice(end);
  b.text = b.text.slice(0, start);
  const tail = after ? [newBlock('text', after)] : [];
  const replace = b.text === '' && b.type === 'text';
  blocks.splice(replace ? i : i + 1, replace ? 1 : 0, ...pasted, ...tail);
  const last = pasted[pasted.length - 1];
  changed();
  structural(last.id, last.text.length);
});

blocksEl.addEventListener('keydown', (e) => {
  const content = e.target.closest?.('.content');
  if (!content || e.isComposing) return;
  const b = blockOf(content);
  if (!b) return;
  if (menu.open && menuKey(e)) return;
  const mod = e.ctrlKey || e.metaKey;
  const [start, end] = offsets(content);
  const collapsed = start === end;
  if (mod && !e.shiftKey && !e.altKey && (e.key === 'b' || e.key === 'i') && b.type !== 'code') {
    e.preventDefault();
    return wrapSelection(content, b, e.key === 'b' ? '**' : '*', start, end);
  }
  if (mod && e.key === 'Enter' && b.type === 'todo') {
    e.preventDefault();
    b.checked = !b.checked;
    b.mark = b.checked ? 'x' : ' ';
    changed();
    return structural(b.id, start);
  }
  switch (e.key) {
    case 'Enter':
      e.preventDefault();
      if (e.shiftKey || b.type === 'code') return insertText(content, b, '\n', start, end);
      return splitBlock(b, start, end);
    case 'Backspace':
      if (collapsed && start === 0) {
        e.preventDefault();
        backspaceAtStart(b);
      }
      return;
    case 'Delete':
      if (collapsed && start === b.text.length) {
        e.preventDefault();
        mergeNext(b);
      }
      return;
    case 'Tab':
      e.preventDefault();
      if (b.type === 'code') return insertText(content, b, '\t', start, end);
      if (isList(b.type)) indentBlock(b, e.shiftKey ? -1 : 1, start);
      return;
    case 'ArrowUp':
    case 'ArrowLeft':
      if (collapsed && !e.shiftKey && (e.key === 'ArrowLeft' ? start === 0 : onEdgeLine(content, 'up', start))) {
        e.preventDefault();
        focusSibling(b, -1);
      }
      return;
    case 'ArrowDown':
    case 'ArrowRight':
      if (collapsed && !e.shiftKey && (e.key === 'ArrowRight' ? start === b.text.length : onEdgeLine(content, 'down', start))) {
        e.preventDefault();
        focusSibling(b, 1);
      }
      return;
    case 'Escape':
      content.blur();
      return;
    default:
  }
});

// Clicking below the last block adds a new one, like Notion.
$('#blocks-end').addEventListener('mousedown', (e) => {
  e.preventDefault();
  const blocks = state.page.blocks;
  const last = blocks[blocks.length - 1];
  if (last?.type === 'text' && last.text === '') return focusBlock(last.id, 0);
  const nb = newBlock();
  blocks.push(nb);
  structural(nb.id, 0);
});

async function followLink(target) {
  const link = safeDecode(target.split('#')[0]);
  if (!link) return;
  try {
    const { path } = await api('GET', `/api/resolve?link=${enc(link)}&from=${enc(state.page?.path ?? '')}`);
    if (path) return go(path);
    // Like Obsidian: following a link to a page that doesn't exist creates it.
    const name = link.replace(/\.md$/i, '');
    if (!name.split('/').every(validName)) return setStatus(BAD_NAME);
    await api('PUT', '/api/page', { path: `${name}.md`, content: '', baseMtime: null });
    await loadTree();
    go(`${name}.md`);
  } catch (e) {
    setStatus(e.message);
  }
}

// Text prompt in our own dialog: window.prompt() does not exist in Electron. Resolves to the text, or null on Cancel/Esc.
function askText(title, value = '', { placeholder = '' } = {}) {
  closeMenu();
  const dlg = $('#ask');
  const input = $('#ask-input');
  $('#ask-title').textContent = title;
  input.value = value;
  input.placeholder = placeholder;
  return new Promise((resolve) => {
    const form = $('#ask-form');
    const cancel = $('#ask-cancel');
    const done = (result) => {
      form.onsubmit = null;
      cancel.onclick = null;
      dlg.onclose = null;
      if (dlg.open) dlg.close();
      resolve(result);
    };
    form.onsubmit = (e) => {
      e.preventDefault();
      done(input.value);
    };
    cancel.onclick = () => done(null);
    dlg.onclose = () => done(null); // Esc
    dlg.showModal();
    input.focus();
    input.select();
  });
}

// ---------- quick switcher / search (Ctrl+K) ----------
const dlg = $('#switcher');
const qInput = $('#q');
const resultsEl = $('#results');
const sw = { items: [], index: 0, seq: 0, timer: null };

function openSwitcher(initial = '') {
  closeMenu();
  qInput.value = initial;
  if (!dlg.open) dlg.showModal();
  qInput.focus();
  updateSwitcher();
}

function renderResults() {
  resultsEl.replaceChildren(
    ...sw.items.map((it, i) => {
      const li = el('li', 'result');
      li.id = `result-${i}`;
      li.setAttribute('role', 'option');
      li.append(el('span', 'label', it.label));
      if (it.hint) li.append(el('span', 'hint', it.hint));
      if (it.snippet) li.append(el('span', 'snippet', it.snippet));
      li.addEventListener('click', () => pickResult(i));
      li.addEventListener('mousemove', () => {
        if (sw.index !== i) {
          sw.index = i;
          highlightResults();
        }
      });
      return li;
    }),
  );
  if (!sw.items.length) resultsEl.append(el('li', 'result none', 'Sin resultados'));
  highlightResults();
}

function highlightResults() {
  [...resultsEl.children].forEach((li, i) => {
    li.classList.toggle('active', i === sw.index);
    li.setAttribute('aria-selected', String(i === sw.index));
  });
  resultsEl.children[sw.index]?.scrollIntoView({ block: 'nearest' });
}

async function updateSwitcher() {
  const q = qInput.value.trim();
  const seq = ++sw.seq;
  const pages = allPages();
  const ql = q.toLowerCase();
  const isOperatorQuery = /[:"-]/.test(q);
  const titleHits = isOperatorQuery
    ? []
    : pages
        .filter((p) => baseName(p).toLowerCase().includes(ql))
        .slice(0, q ? 6 : 15)
        .map((p) => ({ path: p, label: baseName(p), hint: folderOf(p) }));
  const create = validName(q) && !pages.some((p) => baseName(p).toLowerCase() === ql) ? [{ create: q, label: `Crear la página “${q}”`, hint: 'página nueva' }] : [];
  sw.items = [...titleHits, ...create];
  sw.index = 0;
  renderResults();
  if (!q) return;
  let results;
  try {
    ({ results } = await api('GET', `/api/search?q=${enc(q)}`));
  } catch {
    return;
  }
  if (seq !== sw.seq) return; // a newer query is already showing
  const seen = new Set(titleHits.map((t) => t.path));
  const content = results
    .filter((r) => !seen.has(r.path))
    .map((r) => ({ path: r.path, label: r.name, hint: folderOf(r.path), snippet: r.snippet }));
  sw.items = [...titleHits, ...content, ...create];
  renderResults();
}

function pickResult(i) {
  const it = sw.items[i];
  if (!it) return;
  dlg.close();
  if (it.create) createPage('', it.create);
  else go(it.path);
}

qInput.addEventListener('input', () => {
  clearTimeout(sw.timer);
  sw.timer = setTimeout(updateSwitcher, 120);
});
qInput.addEventListener('keydown', (e) => {
  const n = sw.items.length;
  if ((e.key === 'ArrowDown' || e.key === 'ArrowUp') && n) {
    e.preventDefault();
    sw.index = (sw.index + (e.key === 'ArrowDown' ? 1 : n - 1)) % n;
    highlightResults();
  } else if (e.key === 'Enter') {
    e.preventDefault();
    pickResult(sw.index);
  }
});
dlg.addEventListener('click', (e) => {
  if (e.target === dlg) dlg.close(); // click on the backdrop
});

// ---------- global ----------
document.addEventListener('keydown', (e) => {
  if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') {
    e.preventDefault();
    if (dlg.open) dlg.close();
    else openSwitcher();
  }
});
$('main').addEventListener('scroll', closeMenu, { passive: true });
document.addEventListener('mousedown', (e) => {
  // composedPath is read now, before a picked row is replaced: a row removed by its own pick is no longer "inside".
  if (menu.open && !e.composedPath().includes(menuEl) && !e.target.closest?.('.content')) closeMenu();
});
document.addEventListener('keydown', (e) => {
  if (menu.open && !e.target.closest?.('.content') && menuKey(e)) e.stopPropagation(); // the ⋮⋮ block menu has no caret
});
$('#toggle-sidebar').addEventListener('click', () => document.body.classList.toggle('sidebar-hidden'));
$('#new-page').addEventListener('click', () => createPage());
$('#new-folder').addEventListener('click', () => createFolder());
const pagesHead = $('#pages-head');
pagesHead.addEventListener('dragover', (e) => {
  if (!treeDrag || !treeDrag.key.includes('/')) return;
  e.preventDefault();
  pagesHead.classList.add('drop-into');
});
pagesHead.addEventListener('dragleave', () => pagesHead.classList.remove('drop-into'));
pagesHead.addEventListener('drop', (e) => {
  pagesHead.classList.remove('drop-into');
  if (!treeDrag) return;
  e.preventDefault();
  moveNode(treeDrag, '');
});
$('#new-note').addEventListener('click', () => createPage());
$('#top-search').addEventListener('click', () => openSwitcher());
$('#open-search').addEventListener('click', () => openSwitcher());

// ---------- ajustes (desktop only: the cloud sign-in lives here, the menu bar is hidden) ----------
const settingsDlg = $('#settings');
const settingsActions = $('#settings-actions');
const settingsMsg = $('#settings-msg');
let cloudState = null;

function paintSettings() {
  const s = cloudState;
  const text = $('#settings-cloud');
  settingsActions.replaceChildren();
  if (!s.cloud) return (text.textContent = 'La nube no está configurada en esta copia de Vault (app/cloud.json).');
  const btn = (label, action) => {
    const b = el('button', 'db-tab', label);
    b.type = 'button';
    b.onclick = () => runSettings(action);
    return b;
  };
  if (s.user) {
    text.textContent = `Sesión iniciada como ${s.user}. Última sincronización: ${s.lastSync}.`;
    settingsActions.append(btn('Sincronizar ahora', 'sync'), btn('Cerrar sesión', 'signout'));
  } else {
    text.textContent = 'Sin sesión. Inicia sesión para sincronizar tus notas con la nube.';
    settingsActions.append(btn('Iniciar sesión en la nube…', 'signin'));
  }
}

async function runSettings(action) {
  settingsMsg.textContent = action === 'signin' ? 'Se abre el navegador. Cuando termines, vuelve a abrir Ajustes.' : '';
  const res = await fetch(`/api/desktop/${action}`, { method: 'POST' });
  const body = await res.json();
  if (!res.ok) return (settingsMsg.textContent = body.error);
  cloudState = body;
  paintSettings();
}

$('#open-settings').addEventListener('click', async () => {
  settingsMsg.textContent = '';
  cloudState = await (await fetch('/api/desktop')).json();
  paintSettings();
  settingsDlg.showModal();
});
$('#settings-close').addEventListener('click', () => settingsDlg.close());
fetch('/api/desktop').then((r) => {
  if (r.ok) $('#open-settings').hidden = false; // only the desktop app has the cloud settings
}).catch(() => {});
document.querySelectorAll('.kbd:empty').forEach((k) => (k.textContent = /Mac|iPhone|iPad/.test(navigator.platform) ? '⌘K' : 'Ctrl K'));
if (narrow.matches) document.body.classList.add('sidebar-hidden');

addEventListener('hashchange', route);
addEventListener('beforeunload', (e) => {
  if (state.page?.dirty) {
    save();
    e.preventDefault();
    e.returnValue = '';
  }
});
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'hidden') flushSave();
});
addEventListener('unhandledrejection', (e) => setStatus(e.reason?.message ?? 'Algo ha salido mal'));
// Right-click on a block opens the insert menu, unless text is selected (then the browser's copy/paste menu stays).
blocksEl.addEventListener('contextmenu', (e) => {
  if (!getSelection().isCollapsed) return;
  const wrap = e.target.closest?.('.block');
  const found = wrap && [...walkBlocks()].find(([x]) => String(x.id) === wrap.dataset.id);
  if (!found) return;
  e.preventDefault();
  const [b] = found;
  const nested = ownerList(b) !== state.page.blocks;
  menuMeta = { title: 'Insertar', right: '', foot: '↑↓ moverse · ↵ insertar · esc cerrar' };
  openMenu(SLASH.filter((it) => !(nested && it.type === 'columns')), { left: e.clientX, top: e.clientY, bottom: e.clientY }, insertPicker(b));
});

try {
  await loadTree();
  state.focusTitle = peekParam === 'new';
  await route();
} catch {
  showEmpty('No se pueden cargar tus notas. Reinicia Vault y prueba otra vez.');
}
