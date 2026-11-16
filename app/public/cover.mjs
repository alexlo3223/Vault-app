// The banner (cover) of a page: which image it shows and how that image is framed inside the banner.
// Pure logic (no DOM), shared by the page, the framing editor and the tests.
//
// The frame follows CSS: the image fills the banner (object-fit: cover), `x`/`y` are an object-position in percent
// (50/50 = centred, which is how banners looked before they could be moved), and `zoom` scales the image around
// that same point, so the point of the image at x%,y% stays at x%,y% of the banner whatever the zoom.

export const COVER = { x: 50, y: 50, zoom: 1, height: 220 };
export const LIMITS = { zoom: [1, 3], height: [120, 420] };
// Frontmatter keys of the banner; all but `cover` only describe the framing.
export const COVER_KEYS = ['cover', 'cover_x', 'cover_y', 'cover_zoom', 'cover_height'];
export const FRAME_KEYS = COVER_KEYS.slice(1);

const IMAGE_EXT = /\.(png|jpe?g|gif|webp|avif|bmp)$/i;
const clamp = (n, lo, hi) => Math.min(hi, Math.max(lo, n));
const num = (v, fallback) => {
  const n = Number(v);
  return String(v ?? '').trim() !== '' && Number.isFinite(n) ? n : fallback;
};

// The banner settings of a page, from its frontmatter values ({ cover: '…', cover_x: '30', … }), with limits and defaults.
export function readCover(values = {}) {
  return {
    src: String(values.cover ?? '').trim(),
    x: clamp(num(values.cover_x, COVER.x), 0, 100),
    y: clamp(num(values.cover_y, COVER.y), 0, 100),
    zoom: clamp(num(values.cover_zoom, COVER.zoom), ...LIMITS.zoom),
    height: Math.round(clamp(num(values.cover_height, COVER.height), ...LIMITS.height)),
  };
}

// "![[banner.png]]" / "[[banner.png|alias]]" → "banner.png"
const unwrap = (value) => {
  const v = String(value ?? '').trim();
  const wiki = v.match(/^!?\[\[([^\]|]+)(?:\|[^\]]*)?\]\]$/);
  return (wiki ? wiki[1] : v).trim();
};

// Where to load an image from: an https address as it is, or a file of the vault through /api/file. Anything else
// (http:, data:, javascript:, a file that is not an image) is refused with ''.
export function coverSrc(value, from = '') {
  const v = unwrap(value);
  if (!v) return '';
  if (/^https:\/\//i.test(v)) return v;
  if (/^[a-z][a-z0-9+.-]*:/i.test(v) || !IMAGE_EXT.test(v)) return '';
  return `/api/file?link=${encodeURIComponent(v)}&from=${encodeURIComponent(from)}`;
}

// A value that is an image (a file of the vault or an https address) rather than an emoji; for page icons.
export const isImageRef = (value) => {
  const v = unwrap(value);
  return /^https:\/\//i.test(v) || IMAGE_EXT.test(v);
};

// What part of the image shows: { w, h } as fractions (0–1) of its width and height.
export function visible(imgW, imgH, boxW, boxH, zoom = 1) {
  if (!(imgW > 0 && imgH > 0 && boxW > 0 && boxH > 0)) return { w: 1, h: 1 };
  const scale = Math.max(boxW / imgW, boxH / imgH) * zoom;
  // The axis that fills the banner exactly shows all of the image (1), not 0.9999999999999999.
  const whole = (v) => (v > 1 - 1e-9 ? 1 : v);
  return { w: whole(Math.min(1, boxW / (imgW * scale))), h: whole(Math.min(1, boxH / (imgH * scale))) };
}

// The visible window in image coordinates (0–1). With x% the image's x% point sits at the banner's x% point, so
// the window's left edge is x% of the room that is left over.
export function frameRect(vis, x, y) {
  return { left: (x / 100) * (1 - vis.w), top: (y / 100) * (1 - vis.h), width: vis.w, height: vis.h };
}

// The reverse: the x/y percent that put the window at left/top. With no room to move (the window is the whole
// image on that axis) there is nothing to choose: centred.
export function posFromFrame(vis, left, top) {
  const axis = (pos, room) => (room < 1e-6 ? 50 : clamp((pos / room) * 100, 0, 100));
  return { x: axis(left, 1 - vis.w), y: axis(top, 1 - vis.h) };
}

// Zoom or height changed: the new x/y that keep the middle of the window where it was.
// img: { w, h } natural size; from: { x, y, zoom, height }; to: { zoom, height }.
export function reframe(img, boxW, from, to) {
  const a = visible(img.w, img.h, boxW, from.height, from.zoom);
  const b = visible(img.w, img.h, boxW, to.height ?? from.height, to.zoom ?? from.zoom);
  const f = frameRect(a, from.x, from.y);
  const cx = f.left + a.w / 2;
  const cy = f.top + a.h / 2;
  return posFromFrame(b, clamp(cx - b.w / 2, 0, 1 - b.w), clamp(cy - b.h / 2, 0, 1 - b.h));
}

// "Se ve el 71 % del ancho y el 33 % del alto de la imagen"
export const describe = (vis) => `Se ve el ${Math.round(vis.w * 100)} % del ancho y el ${Math.round(vis.h * 100)} % del alto de la imagen`;

// The CSS that frames an image in the banner (set through the CSSOM: the page's CSP forbids style attributes).
export function frameStyle({ x, y, zoom }) {
  return { objectPosition: `${x}% ${y}%`, transformOrigin: `${x}% ${y}%`, transform: zoom === 1 ? '' : `scale(${zoom})` };
}

// The frontmatter to write for a banner: a key left at its default is removed, so a banner that is not changed
// leaves no trace in the note.
export function coverPatch({ src, x, y, zoom, height }) {
  const round = (n, d) => Math.round(n * 10 ** d) / 10 ** d;
  const keep = (value, def) => (value === def ? '' : value);
  return {
    cover: src,
    cover_x: keep(round(x, 1), COVER.x),
    cover_y: keep(round(y, 1), COVER.y),
    cover_zoom: keep(round(zoom, 2), COVER.zoom),
    cover_height: keep(Math.round(height), COVER.height),
  };
}

// Everything the banner writes, emptied: removes the cover and its framing.
export const removePatch = () => Object.fromEntries(COVER_KEYS.map((k) => [k, '']));
