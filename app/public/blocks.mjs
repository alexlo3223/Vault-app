// Markdown <-> Notion-style blocks. Shared by the browser editor (app.js) and the tests.
// Anything the editor has no block type for (other HTML, h4-h6, indented code) stays as raw text,
// and blank-line gaps are remembered, so opening and saving a note does not rewrite it.
// Tables and images keep their source text until edited; columns are re-serialised in one exact format.

const LIST_TYPES = new Set(['bullet', 'numbered', 'todo']);
export const isList = (type) => LIST_TYPES.has(type);
export const indentWidth = (s = '') => [...s].reduce((w, c) => w + (c === '\t' ? 4 : 1), 0);

let nextId = 1;
export const newBlock = (type = 'text', text = '', extra = {}) => ({ id: nextId++, type, text, indent: '', ...extra });

// ---- tables (GFM) ----
const TABLE_SEP = /^\s*\|?\s*:?-+:?\s*(\|\s*:?-+:?\s*)*\|?\s*$/;
const isRow = (line) => /^\s*\|/.test(line ?? '');

function splitRow(line) {
  let s = line.trim();
  if (s.startsWith('|')) s = s.slice(1);
  if (s.endsWith('|') && !s.endsWith('\\|')) s = s.slice(0, -1);
  return s.split(/(?<!\\)\|/).map((c) => c.trim().replace(/\\\|/g, '|'));
}

const alignOf = (cell) => (cell.startsWith(':') && cell.endsWith(':') ? 'center' : cell.endsWith(':') ? 'right' : cell.startsWith(':') ? 'left' : '');

export function formatTable(rows, align) {
  const cell = (c) => (c ?? '').replace(/\n/g, ' ').replace(/\|/g, '\\|');
  const width = align.map((_, i) => Math.max(3, ...rows.map((r) => cell(r[i]).length)));
  const line = (r) => `| ${align.map((_, i) => cell(r[i]).padEnd(width[i])).join(' | ')} |`;
  const sep = align.map((a, i) => {
    const w = width[i];
    if (a === 'center') return `:${'-'.repeat(w - 2)}:`;
    if (a === 'left') return `:${'-'.repeat(w - 1)}`;
    if (a === 'right') return `${'-'.repeat(w - 1)}:`;
    return '-'.repeat(w);
  });
  return [line(rows[0]), `| ${sep.join(' | ')} |`, ...rows.slice(1).map(line)].join('\n');
}

// ---- images: ![alt](src) or Obsidian's ![[file.png|300]] ----
export function parseImage(line) {
  let m = line.match(/^!\[([^\]\n]*)\]\(([^)\s]+)\)$/);
  if (m) return { alt: m[1], src: m[2], embed: false };
  m = line.match(/^!\[\[([^\]|\n]+)(?:\|([^\]\n]*))?\]\]$/);
  if (m) return { alt: /^\d+$/.test(m[2] ?? '') ? '' : (m[2] ?? ''), src: m[1].trim(), width: /^\d+$/.test(m[2] ?? '') ? Number(m[2]) : null, embed: true };
  return null;
}

// ---- columns: one exact HTML shape, so the inner Markdown can be parsed and written back ----
const COLUMNS_OPEN = '<div class="columns">';
const COLUMN_OPEN = '<div class="column">';
// A column may carry a width weight, e.g. <div class="column" data-ratio="16">; the grid uses it as fr units.
const COLUMN_RE = /^<div class="column"(?: data-ratio="(\d{1,3})")?>$/;

function parseColumns(lines, i) {
  if (lines[i] !== COLUMNS_OPEN) return null;
  const cols = [];
  let cur = null;
  let ratio;
  for (let j = i + 1; j < lines.length; j++) {
    const t = lines[j];
    if (cur === null) {
      const m = t.match(COLUMN_RE);
      if (m) {
        cur = [];
        ratio = m[1] ? Number(m[1]) : undefined;
      } else if (t === '</div>' && cols.length) return { cols, end: j };
      else return null;
    } else if (t === '</div>') {
      cols.push({ ...parse(cur.map((l) => `${l}\n`).join('')), ratio });
      cur = null;
    } else if (/^\s*<\/?div\b/i.test(t)) {
      return null; // nested divs: leave the whole thing as raw text
    } else {
      cur.push(t);
    }
  }
  return null;
}

export const newColumn = () => ({ frontmatter: '', blocks: [newBlock('text', '', { blankBefore: 1 })], trailing: 2 });
// A blank line after <div class="column"> keeps the inside readable as Markdown (CommonMark HTML-block rule).
const columnBody = (c) => serialize({ ...c, blocks: c.blocks.map((b, i) => (i === 0 && b.blankBefore === undefined ? { ...b, blankBefore: 1 } : b)) });
const columnOpen = (c) => (c.ratio ? `<div class="column" data-ratio="${c.ratio}">` : COLUMN_OPEN);
const columnsText = (cols) => `${COLUMNS_OPEN}\n${cols.map((c) => `${columnOpen(c)}\n${columnBody(c)}</div>`).join('\n')}\n</div>`;

// ---- embeds and buttons: one HTML line each, kept exactly as written ----
const EMBED_RE = /^<iframe src="(https:\/\/[^"\s<>]+)"[^>]*><\/iframe>$/;
const BUTTON_RE = /^<button data-new="([^"]*)">([^<]*)<\/button>$/;
export const embedLine = (url) => `<iframe src="${url}"></iframe>`;
export const buttonLine = (folder, label) => `<button data-new="${folder}">${label}</button>`;
export const embedSrc = (line) => line.match(EMBED_RE)?.[1] ?? '';
export const buttonParts = (line) => {
  const m = line.match(BUTTON_RE);
  return m ? { folder: m[1], label: m[2] } : null;
};
export const isEmbed = (line) => EMBED_RE.test(line);
export const isButton = (line) => BUTTON_RE.test(line);
export const isHttps = (url) => /^https:\/\/[^\s"<>]+$/.test(url);

// Web bookmark: one HTML line with the address and a title. Its title is typed by the user, never fetched.
const BOOKMARK_RE = /^<a class="bookmark" href="(https:\/\/[^"\s<>]+)">([^<]*)<\/a>$/;
export const bookmarkLine = (url, title) => `<a class="bookmark" href="${url}">${title.replace(/[<>"]/g, '')}</a>`;
export const bookmarkParts = (line) => {
  const m = line.match(BOOKMARK_RE);
  return m ? { url: m[1], title: m[2] } : null;
};
export const isBookmark = (line) => BOOKMARK_RE.test(line);

// How a stored file is shown: pictures, videos, audio, or a download card for anything else.
const MEDIA_KIND = { png: 'image', jpg: 'image', jpeg: 'image', gif: 'image', webp: 'image', avif: 'image', bmp: 'image', mp4: 'video', webm: 'video', mov: 'video', mp3: 'audio', wav: 'audio', m4a: 'audio', ogg: 'audio' };
export const mediaKind = (name) => MEDIA_KIND[name.includes('.') ? name.slice(name.lastIndexOf('.') + 1).toLowerCase() : ''] ?? 'file';

// Watch and short links of YouTube become their embeddable form; other URLs are returned unchanged.
export function embedUrl(url) {
  const yt = url.match(/^https:\/\/(?:www\.|m\.)?youtube\.com\/watch\?(?:.*&)?v=([\w-]{6,})/) ?? url.match(/^https:\/\/youtu\.be\/([\w-]{6,})/);
  return yt ? `https://www.youtube-nocookie.com/embed/${yt[1]}` : url;
}

export function parse(markdown) {
  const md = markdown.replace(/\r\n?/g, '\n');
  const fm = md.match(/^---\n(?:[\s\S]*?\n)?---(?:\n|$)/);
  const frontmatter = fm ? fm[0] : '';
  const lines = md.slice(frontmatter.length).split('\n');
  const blocks = [];
  let blanks = 0;
  let open = null; // the block that absorbs following plain lines (paragraph, list item, quote)
  const add = (type, text, extra) => {
    const b = newBlock(type, text, { blankBefore: blanks, ...extra });
    blocks.push(b);
    blanks = 0;
    return b;
  };

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    let m;
    if (line.trim() === '') {
      blanks++;
      open = null;
      continue;
    }
    if ((m = line.match(/^(\s*)(`{3,}|~{3,})(.*)$/)) && !(m[2][0] === '`' && m[3].includes('`'))) {
      const fence = m[2];
      const body = [];
      while (++i < lines.length) {
        const t = lines[i].trim();
        if (t.length >= fence.length && t === fence[0].repeat(t.length)) break;
        body.push(lines[i]);
      }
      add('code', body.join('\n'), { indent: m[1], fence, info: m[3] });
      open = null;
      continue;
    }
    if (!open && isRow(line) && TABLE_SEP.test(lines[i + 1] ?? '') && lines[i + 1].includes('|')) {
      const raw = [line, lines[++i]];
      while (isRow(lines[i + 1])) raw.push(lines[++i]);
      const head = splitRow(line);
      const align = splitRow(raw[1]).map(alignOf);
      const n = Math.max(head.length, align.length);
      const pad = (r) => Array.from({ length: n }, (_, k) => r[k] ?? '');
      add('table', raw.join('\n'), { rows: [head, ...raw.slice(2).map(splitRow)].map(pad), align: pad(align) });
      continue;
    }
    if (!open && parseImage(line)) {
      add('image', line);
      continue;
    }
    if (!open && (isEmbed(line) || isButton(line) || isBookmark(line))) {
      add(isEmbed(line) ? 'embed' : isButton(line) ? 'button' : 'bookmark', line);
      continue;
    }
    if (!open && (m = parseColumns(lines, i))) {
      add('columns', lines.slice(i, m.end + 1).join('\n'), { cols: m.cols });
      i = m.end;
      continue;
    }
    if (open?.type === 'text' && /^ {0,3}(=+|-+) *$/.test(line)) {
      open.text += '\n' + line; // setext heading underline belongs to its paragraph
      continue;
    }
    if ((m = line.match(/^(#{1,3}) (.*)$/))) {
      add(`h${m[1].length}`, m[2]);
      open = null;
      continue;
    }
    if (/^ {0,3}([-*_])(?: *\1){2,} *$/.test(line)) {
      add('divider', line);
      open = null;
      continue;
    }
    if ((m = line.match(/^(\s*)([-*+]) \[([ xX])\](?: (.*))?$/))) {
      open = add('todo', m[4] ?? '', { indent: m[1], marker: m[2], checked: m[3] !== ' ', mark: m[3] });
      continue;
    }
    if ((m = line.match(/^(\s*)([-*+])(?: (.*))?$/))) {
      open = add('bullet', m[3] ?? '', { indent: m[1], marker: m[2] });
      continue;
    }
    if ((m = line.match(/^(\s*)(\d{1,9})([.)])(?: (.*))?$/))) {
      open = add('numbered', m[4] ?? '', { indent: m[1], num: Number(m[2]), delim: m[3] });
      continue;
    }
    if ((m = line.match(/^ {0,3}> ?(.*)$/))) {
      if (open?.type === 'quote') open.text += '\n' + m[1];
      else open = add('quote', m[1]);
      continue;
    }
    if (open) {
      open.text += '\n' + line;
      continue;
    }
    open = add('text', line);
  }
  return { frontmatter, blocks, trailing: blanks };
}

// Numbered items count up from the first item's number in each run; other blocks end the run.
export function listNumbers(blocks) {
  const nums = new Map();
  let counters = new Map();
  for (const b of blocks) {
    if (!isList(b.type)) {
      counters = new Map();
      continue;
    }
    const w = indentWidth(b.indent);
    for (const k of [...counters.keys()]) if (k > w) counters.delete(k);
    if (b.type !== 'numbered') {
      counters.delete(w);
      continue;
    }
    const n = counters.has(w) ? counters.get(w) + 1 : (b.num ?? 1);
    counters.set(w, n);
    nums.set(b, n);
  }
  return nums;
}

function blockText(b, num) {
  switch (b.type) {
    case 'h1':
    case 'h2':
    case 'h3':
      return `${'#'.repeat(Number(b.type[1]))} ${b.text}`;
    case 'bullet':
      return `${b.indent}${b.marker ?? '-'} ${b.text}`;
    case 'numbered':
      return `${b.indent}${num}${b.delim ?? '.'} ${b.text}`;
    case 'todo':
      return `${b.indent}${b.marker ?? '-'} [${b.checked ? (b.mark ?? 'x') : ' '}] ${b.text}`;
    case 'quote':
      return b.text
        .split('\n')
        .map((l) => (l ? `> ${l}` : '>'))
        .join('\n');
    case 'code': {
      const fence = b.fence ?? '```';
      const indent = b.indent ?? '';
      return `${indent}${fence}${b.info ?? ''}\n${b.text ? b.text + '\n' : ''}${indent}${fence}`;
    }
    case 'divider':
      return b.text || '---';
    case 'columns':
      return columnsText(b.cols);
    default:
      return b.text;
  }
}

export function serialize({ frontmatter = '', blocks, trailing = 1 }) {
  if (!blocks.length) return frontmatter + '\n'.repeat(Math.max(0, trailing - 1));
  const nums = listNumbers(blocks);
  let out = frontmatter;
  blocks.forEach((b, i) => {
    const gap = b.blankBefore ?? (i === 0 ? 0 : isList(b.type) && isList(blocks[i - 1].type) ? 0 : 1);
    out += (i === 0 ? '' : '\n') + '\n'.repeat(gap) + blockText(b, nums.get(b));
  });
  return out + '\n'.repeat(trailing);
}

// ---- inline Markdown: tokens carry both the raw source and the visible text ----

const INLINE = new RegExp(
  [
    String.raw`\[\[([^\]\n]+?)\]\]`, // 1 wikilink
    String.raw`\x60([^\x60\n]+)\x60`, // 2 inline code
    String.raw`\*\*([^*\n]+?)\*\*`, // 3 bold
    String.raw`(?<!\*)\*([^*\s](?:[^*\n]*?[^*\s])?)\*(?!\*)`, // 4 italic *
    String.raw`(?<![\p{L}\p{N}_])_([^_\s](?:[^_\n]*?[^_\s])?)_(?![\p{L}\p{N}_])`, // 5 italic _
    String.raw`\[([^\]\n]+)\]\(([^)\s]+)\)`, // 6 text, 7 url: Markdown link
    String.raw`(?<![\p{L}\p{N}_#/&])#([\p{L}_][\p{L}\p{N}_/-]*)`, // 8 tag
    String.raw`https?:\/\/[^\s<>]*[^\s<>.,;:!?'")\]]`, // bare url
  ].join('|'),
  'gu',
);

const textToken = (s) => ({ kind: 'text', raw: s, text: s, pre: 0 });

function tokenFor(m) {
  const raw = m[0];
  if (m[1] !== undefined) {
    const bar = m[1].indexOf('|');
    const target = (bar < 0 ? m[1] : m[1].slice(0, bar)).trim();
    const alias = bar < 0 ? '' : m[1].slice(bar + 1);
    return alias
      ? { kind: 'wikilink', raw, text: alias, pre: raw.length - 2 - alias.length, target }
      : { kind: 'wikilink', raw, text: m[1], pre: 2, target };
  }
  if (m[2] !== undefined) return { kind: 'code', raw, text: m[2], pre: 1 };
  if (m[3] !== undefined) return { kind: 'bold', raw, text: m[3], pre: 2 };
  if (m[4] !== undefined || m[5] !== undefined) return { kind: 'italic', raw, text: m[4] ?? m[5], pre: 1 };
  if (m[6] !== undefined) return { kind: 'link', raw, text: m[6], pre: 1, target: m[7] };
  if (m[8] !== undefined) return { kind: 'tag', raw, text: raw, pre: 0, target: m[8] };
  return { kind: 'url', raw, text: raw, pre: 0, target: raw };
}

export function tokenize(raw) {
  const out = [];
  let last = 0;
  for (const m of raw.matchAll(INLINE)) {
    if (m.index > last) out.push(textToken(raw.slice(last, m.index)));
    out.push(tokenFor(m));
    last = m.index + m[0].length;
  }
  if (last < raw.length) out.push(textToken(raw.slice(last)));
  return out;
}

const esc = (s) => s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);

const extLink = (href, text) => `<a class="ext" href="${esc(href)}" target="_blank" rel="noopener noreferrer">${text}</a>`;

export function renderInline(raw) {
  return tokenize(raw)
    .map((t) => {
      const text = esc(t.text);
      switch (t.kind) {
        case 'wikilink':
          return `<a class="wikilink" href="#" data-link="${esc(t.target)}">${text}</a>`;
        case 'code':
          return `<code>${text}</code>`;
        case 'bold':
          return `<strong>${text}</strong>`;
        case 'italic':
          return `<em>${text}</em>`;
        case 'tag':
          return `<a class="tag" href="#" data-tag="${esc(t.target)}">${text}</a>`;
        case 'url':
          return extLink(t.target, text);
        case 'link':
          if (/^(https?|mailto):/i.test(t.target)) return extLink(t.target, text);
          if (!/^[a-z][a-z0-9+.-]*:/i.test(t.target)) return `<a class="wikilink" href="#" data-link="${esc(t.target)}">${text}</a>`;
          return text; // other schemes (javascript:, data:) are shown as plain text
        default:
          return text;
      }
    })
    .join('');
}

// Map a caret offset in the rendered text back to the raw Markdown, so a click lands where the user clicked.
export function renderedToRaw(raw, offset) {
  let rawPos = 0;
  for (const t of tokenize(raw)) {
    if (offset < t.text.length) return rawPos + t.pre + offset; // a boundary belongs to the token that starts there
    offset -= t.text.length;
    rawPos += t.raw.length;
  }
  return raw.length;
}
