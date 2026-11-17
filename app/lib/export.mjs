#!/usr/bin/env node
// One note as a standalone HTML page: no scripts, pictures inside the file, databases as static tables.
// Pure: the server passes in how to find a picture (imageUri) and the rows of a database folder (rowsOf),
// so this file never touches the disk and can be tested with fakes.
import { bookmarkParts, buttonParts, embedSrc, isBookmark, isButton, isHttps, isList, listNumbers, parse, parseImage, renderInline } from '../public/blocks.mjs';
import { parseDb } from '../public/database.mjs';
import { PAGE_KEYS, computeRows, fullSchema } from '../public/properties.mjs';

const CALLOUT = /^\[!(\w+)\][ \t]?/;
// Shortcut: a database block becomes one plain table of its notes (every property, as written): no views, filters,
// sorting or charts. Charts are replaced by a notice, and the note says to open it in Vault to see them.

const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);

const STYLE = `
  :root { color-scheme: dark; }
  body { margin: 0; background: #0b0b0f; color: #d8d8e0; font: 16px/1.6 system-ui, sans-serif; }
  main { max-width: 760px; margin: 0 auto; padding: 48px 24px 96px; }
  h1, h2, h3 { color: #fff; line-height: 1.25; }
  h1 { font-size: 2em; } h2 { font-size: 1.5em; } h3 { font-size: 1.2em; }
  a { color: #ffc857; }
  pre { background: #161922; border: 1px solid #2a2e3a; border-radius: 8px; padding: 12px; overflow-x: auto; }
  code { font-family: ui-monospace, monospace; font-size: 0.9em; }
  blockquote { margin: 12px 0; padding: 8px 16px; border-left: 4px solid #ffc857; background: rgba(28,32,43,.4); }
  .callout { margin: 12px 0; padding: 10px 16px; border-left: 4px solid #7ab8ff; background: rgba(28,32,43,.4); border-radius: 8px; }
  .callout[data-kind="tip"], .callout[data-kind="success"] { border-left-color: #6fd39a; }
  .callout[data-kind="warning"], .callout[data-kind="danger"] { border-left-color: #ff6b6b; }
  .pre { white-space: pre-wrap; }
  table { border-collapse: collapse; margin: 12px 0; width: 100%; font-size: 14px; }
  th, td { border: 1px solid #2a2e3a; padding: 6px 10px; text-align: left; vertical-align: top; }
  th { background: rgba(50,56,73,.35); color: #fff; }
  img { max-width: 100%; height: auto; border-radius: 10px; }
  hr { border: 0; border-top: 1px solid #2a2e3a; margin: 24px 0; }
  .cols { display: grid; grid-template-columns: repeat(auto-fit, minmax(0, 1fr)); gap: 24px; }
  .missing, .notice { color: #8a8fa0; font-size: 14px; }
  .db-title { color: #8a8fa0; font-size: 13px; margin-top: 16px; }
`;

// Lists: consecutive items of one kind share one <ul> or <ol>. Indentation is flattened (a known limit).
function listHtml(items, nums) {
  const out = [];
  let run = null;
  for (const b of items) {
    const tag = b.type === 'numbered' ? 'ol' : 'ul';
    if (!run || run.tag !== tag) {
      if (run) out.push(`</${run.tag}>`);
      run = { tag };
      out.push(`<${tag}${tag === 'ol' && nums.get(b) > 1 ? ` start="${nums.get(b)}"` : ''}>`);
    }
    if (b.type === 'todo') out.push(`<li class="todo"><input type="checkbox" disabled${b.checked ? ' checked' : ''}> ${renderInline(b.text)}</li>`);
    else out.push(`<li>${renderInline(b.text)}</li>`);
  }
  if (run) out.push(`</${run.tag}>`);
  return out.join('');
}

export async function renderPageHtml({ markdown, title, from = '', imageUri = async () => null, rowsOf = async () => [], sourceOf = async () => '' }) {
  const doc = parse(markdown);
  const nums = listNumbers(doc.blocks);

  async function blocksHtml(blocks) {
    const out = [];
    for (let i = 0; i < blocks.length; i++) {
      const b = blocks[i];
      if (isList(b.type)) {
        // Collect the whole run of list items, so one list is one element.
        const run = [];
        while (i < blocks.length && isList(blocks[i].type)) run.push(blocks[i++]);
        i--;
        out.push(listHtml(run, nums));
        continue;
      }
      out.push(await blockHtml(b));
    }
    return out.join('\n');
  }

  async function blockHtml(b) {
    switch (b.type) {
      case 'h1':
      case 'h2':
      case 'h3':
        return `<${b.type}>${renderInline(b.text)}</${b.type}>`;
      case 'text':
        return `<p class="pre">${renderInline(b.text)}</p>`;
      case 'quote': {
        const kind = b.text.match(CALLOUT)?.[1];
        if (kind) {
          // The first line after the marker is the callout's title; the rest is its body.
          const [title, ...body] = b.text.replace(CALLOUT, '').split('\n');
          const head = title ? `<strong>${renderInline(title)}</strong>` : '';
          const rest = body.map((l) => renderInline(l)).join('<br>');
          return `<div class="callout" data-kind="${esc(kind)}">${head}${head && rest ? '<br>' : ''}${rest}</div>`;
        }
        return `<blockquote>${renderInline(b.text)}</blockquote>`;
      }
      case 'code': {
        if (b.info?.trim() === 'database') return databaseHtml(b);
        return `<pre><code>${esc(b.text)}</code></pre>`;
      }
      case 'divider':
        return '<hr>';
      case 'table': {
        const [head, ...body] = b.rows;
        const row = (cells, tag) => `<tr>${cells.map((c) => `<${tag}>${renderInline(c ?? '')}</${tag}>`).join('')}</tr>`;
        return `<table><thead>${row(head, 'th')}</thead><tbody>${body.map((r) => row(r, 'td')).join('')}</tbody></table>`;
      }
      case 'image': {
        const info = parseImage(b.text);
        if (!info) return `<p class="missing">${esc(b.text)}</p>`;
        const uri = await imageUri(info.src, from);
        if (!uri) return `<p class="missing">[imagen no incluida: ${esc(info.src)}]</p>`;
        return `<p><img src="${uri}" alt="${esc(info.alt ?? '')}"></p>`;
      }
      case 'embed': {
        const url = embedSrc(b.text);
        return isHttps(url) ? `<p><a href="${esc(url)}">${esc(url)}</a></p>` : `<p class="missing">[incrustación no incluida]</p>`;
      }
      case 'bookmark': {
        const p = isBookmark(b.text) ? bookmarkParts(b.text) : null;
        return p ? `<p><a href="${esc(p.url)}">${esc(p.title || p.url)}</a></p>` : '';
      }
      case 'button': {
        const p = isButton(b.text) ? buttonParts(b.text) : null;
        return p ? `<p class="notice">[botón: ${esc(p.label)}]</p>` : '';
      }
      case 'columns':
        return `<div class="cols">${(await Promise.all(b.cols.map(async (c) => `<div>${await blocksHtml(c.blocks)}</div>`))).join('')}</div>`;
      default:
        return `<p class="pre">${renderInline(b.text)}</p>`;
    }
  }

  async function databaseHtml(b) {
    const cfg = parseDb(b.text);
    // An embed names a database page (`page:`); its folder is read from that page. A block may also name the folder itself.
    // sourceOf gives { source, views, props } of the database page; a block's own folder has its own schema.
    const target = cfg.page ? await sourceOf(cfg.page) : { source: cfg.source, views: cfg.views, props: cfg.props };
    const source = target?.source ?? '';
    if (!source) return `<p class="notice">[base de datos ${cfg.page ? esc(cfg.page) : 'sin carpeta'}: ábrela en Vault]</p>`;
    const raw = (await rowsOf(source)) ?? [];
    // The same values the app shows: formulas computed, page keys (icon, cover, …) left out. Relations show their text.
    const schema = target.props ?? [];
    const rows = computeRows(raw, schema);
    const keys = fullSchema(schema, raw).map((p) => p.name).filter((k) => !PAGE_KEYS.has(k.toLowerCase()));
    const cell = (v) => {
      if (v === null || v === undefined || v === '') return '';
      if (Array.isArray(v)) return v.join(', ');
      if (v instanceof Date) return v.toISOString().slice(0, 10);
      if (typeof v === 'boolean') return v ? '✓' : '';
      return String(v);
    };
    const head = `<tr><th>Nombre</th>${keys.map((k) => `<th>${esc(k)}</th>`).join('')}</tr>`;
    const body = rows.map((r) => `<tr><td>${esc(r.name)}</td>${keys.map((k) => `<td>${esc(cell(r.values?.[k]))}</td>`).join('')}</tr>`).join('');
    const charts = (target.views ?? []).some((v) => ['bar', 'line', 'donut', 'number'].includes(v.view)) ? '<p class="notice">[gráficos de esta base: ábrela en Vault]</p>' : '';
    return `<p class="db-title">Base de datos · ${esc(source)}</p><table><thead>${head}</thead><tbody>${body}</tbody></table>${charts}`;
  }

  const body = await blocksHtml(doc.blocks);
  return `<!doctype html>
<html lang="es">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src data:; style-src 'unsafe-inline'">
<title>${esc(title)}</title>
<style>${STYLE}</style>
</head>
<body>
<main>
<h1>${esc(title)}</h1>
${body}
</main>
</body>
</html>
`;
}

