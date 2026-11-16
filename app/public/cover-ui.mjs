// The banner editor: the whole image with, on top of it, the window the banner will show. Drag the window to move
// the image inside the banner, change the zoom and the height, and read how much of the image will be seen.
// The maths is in cover.mjs. No inline style attributes (the page's CSP forbids them): positions and sizes are
// set through the CSSOM.
import { LIMITS, coverPatch, coverSrc, describe, frameRect, frameStyle, posFromFrame, reframe, visible } from './cover.mjs';

const el = (tag, cls = '', text = '') => {
  const n = document.createElement(tag);
  if (cls) n.className = cls;
  if (text !== '') n.textContent = text;
  return n;
};
const button = (cls, text, onClick) => {
  const b = el('button', cls, text);
  b.type = 'button';
  b.addEventListener('click', onClick);
  return b;
};
const clamp = (n, lo, hi) => Math.min(hi, Math.max(lo, n));
const row = (label, control, value) => {
  const r = el('label', 'cv-row');
  r.append(el('span', 'cv-label', label), control, value);
  return r;
};

// o: { cover: { src, x, y, zoom, height }, pagePath, boxWidth (the banner's width on the page, in px),
//      focus: 'source' to start on the image field, upload(file) → Promise<name of the stored file>,
//      onSave(patch), onRemove() }
export function openCoverEditor(o) {
  const st = { ...o.cover };
  const boxW = o.boxWidth > 0 ? o.boxWidth : 1000;
  let img = { w: 0, h: 0 }; // natural size of the loaded image; 0 until it is there
  let typing = false; // the image field is being used: the keyboard stays there
  const ready = () => img.w > 0 && img.h > 0;
  const vis = () => visible(img.w, img.h, boxW, st.height, st.zoom);

  const dlg = el('dialog', 'cover-dlg');
  dlg.setAttribute('aria-label', 'Portada de la página');

  // ---- the image
  const source = el('input', 'pop-input');
  source.type = 'text';
  source.placeholder = 'https://… o un archivo del vault (banner.png)';
  source.setAttribute('aria-label', 'Imagen de la portada');
  source.value = st.src;
  const file = el('input');
  file.type = 'file';
  file.accept = 'image/*';
  file.hidden = true;
  const upload = button('db-tab', 'Subir imagen…', () => file.click());
  const sourceRow = el('div', 'cv-source');
  sourceRow.append(source, upload, file);
  const msg = el('div', 'pop-msg cv-msg');

  // ---- the stage: the whole image, with the window the banner shows
  const stage = el('div', 'cv-stage');
  const stageImg = el('img', 'cv-img');
  stageImg.alt = '';
  stageImg.draggable = false;
  const frame = el('div', 'cv-frame');
  frame.tabIndex = 0;
  frame.setAttribute('role', 'slider');
  frame.setAttribute('aria-label', 'Zona de la imagen que se verá en el banner. Flechas para mover, + y − para el zoom');
  stage.append(stageImg, frame);
  const stageBox = el('div', 'cv-stage-box');
  stageBox.append(stage);
  const readout = el('div', 'cv-readout');

  // ---- zoom, height, centre
  const zoom = el('input');
  zoom.type = 'range';
  zoom.min = String(LIMITS.zoom[0] * 100);
  zoom.max = String(LIMITS.zoom[1] * 100);
  zoom.step = '5';
  zoom.setAttribute('aria-label', 'Zoom');
  const zoomValue = el('span', 'cv-value');
  const height = el('input');
  height.type = 'range';
  height.min = String(LIMITS.height[0]);
  height.max = String(LIMITS.height[1]);
  height.step = '10';
  height.setAttribute('aria-label', 'Altura del banner');
  const heightValue = el('span', 'cv-value');
  const centre = button('db-tab', 'Centrar', () => {
    st.x = 50;
    st.y = 50;
    draw();
  });
  const controls = el('div', 'cv-controls');
  controls.append(row('Zoom', zoom, zoomValue), row('Altura', height, heightValue), centre);

  // ---- how the banner will look
  const preview = el('div', 'cv-preview');
  preview.setAttribute('aria-label', 'Vista previa del banner');
  const previewImg = el('img');
  previewImg.alt = '';
  preview.append(previewImg);
  const previewBox = el('div', 'cv-preview-box');
  previewBox.append(el('div', 'cv-label', 'Así se verá'), preview);

  // ---- footer
  const save = button('db-tab db-done', 'Guardar', () => {
    if (!ready()) return;
    dlg.close();
    o.onSave(coverPatch(st));
  });
  const foot = el('div', 'cv-foot');
  if (o.cover.src) foot.append(button('db-tab cv-remove', 'Quitar portada', () => (dlg.close(), o.onRemove())));
  foot.append(el('span', 'cv-tip mono', 'Arrastra el marco · flechas · Ctrl+Enter guarda · Esc cierra'), button('db-tab', 'Cancelar', () => dlg.close()), save);

  const head = el('div', 'fx-head');
  head.append(el('span', 'fx-title', 'Portada'));
  dlg.append(head, sourceRow, msg, stageBox, readout, controls, previewBox, foot);

  // ---- drawing
  function draw() {
    const on = ready();
    for (const c of [zoom, height, centre]) c.disabled = !on;
    save.disabled = !on;
    frame.hidden = !on;
    zoom.value = String(Math.round(st.zoom * 100));
    height.value = String(st.height);
    zoomValue.textContent = `${Math.round(st.zoom * 100)} %`;
    heightValue.textContent = `${st.height} px`;
    preview.style.aspectRatio = `${boxW} / ${st.height}`;
    Object.assign(previewImg.style, { objectFit: 'cover', ...frameStyle(st) });
    if (!on) {
      readout.textContent = '';
      return;
    }
    const v = vis();
    const f = frameRect(v, st.x, st.y);
    frame.style.left = `${f.left * 100}%`;
    frame.style.top = `${f.top * 100}%`;
    frame.style.width = `${f.width * 100}%`;
    frame.style.height = `${f.height * 100}%`;
    readout.textContent = describe(v);
    frame.setAttribute('aria-valuetext', readout.textContent);
  }

  function load() {
    const url = coverSrc(st.src, o.pagePath);
    img = { w: 0, h: 0 };
    msg.textContent = '';
    stageImg.removeAttribute('src');
    previewImg.removeAttribute('src');
    if (!url) {
      if (st.src) msg.textContent = 'Eso no es una imagen válida: usa una dirección https:// o un archivo del vault (png, jpg, gif, webp…)';
      return draw();
    }
    stageImg.onload = () => {
      img = { w: stageImg.naturalWidth, h: stageImg.naturalHeight };
      draw();
      // Opened to frame the image: the window is what the keyboard should be on, as soon as there is one.
      if (o.focus !== 'source' && !typing) frame.focus();
    };
    stageImg.onerror = () => {
      img = { w: 0, h: 0 };
      msg.textContent = 'No se pudo cargar la imagen. Comprueba la dirección o el nombre del archivo.';
      draw();
    };
    stageImg.src = url;
    previewImg.src = url;
    draw();
  }

  // ---- changing the image
  const useSource = () => {
    st.src = source.value.trim();
    load();
  };
  source.addEventListener('input', () => (typing = true));
  source.addEventListener('change', useSource);
  source.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      useSource();
    }
  });
  file.addEventListener('change', async () => {
    const chosen = file.files?.[0];
    if (!chosen) return;
    msg.textContent = 'Subiendo…';
    try {
      st.src = await o.upload(chosen);
      source.value = st.src;
      load();
    } catch (e) {
      msg.textContent = e.message;
    }
    file.value = '';
  });

  // ---- moving the window: drag it, or press where it should be
  let grab = null;
  const pointer = (e) => {
    const r = stage.getBoundingClientRect();
    return { px: (e.clientX - r.left) / r.width, py: (e.clientY - r.top) / r.height };
  };
  const drag = (e) => {
    const { px, py } = pointer(e);
    const v = vis();
    Object.assign(st, posFromFrame(v, clamp(px - grab.dx, 0, 1 - v.w), clamp(py - grab.dy, 0, 1 - v.h)));
    draw();
  };
  stage.addEventListener('pointerdown', (e) => {
    if (!ready() || e.button > 0) return;
    const { px, py } = pointer(e);
    const f = frameRect(vis(), st.x, st.y);
    const inside = px >= f.left && px <= f.left + f.width && py >= f.top && py <= f.top + f.height;
    // On the window: it is carried. Outside it: the window jumps to centre on that point, then follows.
    grab = inside ? { dx: px - f.left, dy: py - f.top } : { dx: f.width / 2, dy: f.height / 2 };
    try {
      stage.setPointerCapture(e.pointerId); // keeps the drag going when the pointer leaves the image
    } catch {
      // not a pointer that can be captured: the drag still works while it is over the image
    }
    frame.focus();
    e.preventDefault();
    drag(e);
  });
  stage.addEventListener('pointermove', (e) => grab && drag(e));
  for (const type of ['pointerup', 'pointercancel']) stage.addEventListener(type, () => (grab = null));

  const setZoom = (value) => {
    const z = clamp(Math.round(value * 100) / 100, ...LIMITS.zoom);
    Object.assign(st, reframe(img, boxW, st, { zoom: z }), { zoom: z });
    draw();
  };
  const setHeight = (value) => {
    const h = Math.round(clamp(value, ...LIMITS.height));
    Object.assign(st, reframe(img, boxW, st, { height: h }), { height: h });
    draw();
  };
  zoom.addEventListener('input', () => ready() && setZoom(Number(zoom.value) / 100));
  height.addEventListener('input', () => ready() && setHeight(Number(height.value)));
  frame.addEventListener('keydown', (e) => {
    const step = e.shiftKey ? 5 : 1;
    const move = { ArrowLeft: [-step, 0], ArrowRight: [step, 0], ArrowUp: [0, -step], ArrowDown: [0, step] }[e.key];
    if (move) {
      st.x = clamp(st.x + move[0], 0, 100);
      st.y = clamp(st.y + move[1], 0, 100);
    } else if (e.key === '+' || e.key === '=') setZoom(st.zoom + 0.1);
    else if (e.key === '-') setZoom(st.zoom - 0.1);
    else if (e.key === 'Home') Object.assign(st, { x: 50, y: 50 });
    else return;
    e.preventDefault();
    draw();
  });

  dlg.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
      e.preventDefault();
      save.click();
    }
  });
  dlg.addEventListener('close', () => dlg.remove());
  document.body.append(dlg);
  dlg.showModal();
  load();
  (o.focus === 'source' || !st.src ? source : frame).focus();
}
