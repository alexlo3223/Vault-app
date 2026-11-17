// A page shown over the current view: a small window in the middle ('center') or a glass panel on the right ('side').
// shortcut: the page loads in an iframe running this same app (?peek), so it costs a second start; render in place if that is slow.
let current = null;

export function closePeek() {
  current?.close();
}

export function openPeek(path, { mode = 'side', rect = null, isNew = false, onClose = () => {}, onExpand = () => {} } = {}) {
  closePeek();
  const back = document.createElement('div');
  back.className = `peek-back ${mode}`;
  const win = document.createElement('div');
  win.className = `peek ${mode}`;
  const bar = document.createElement('div');
  bar.className = 'peek-bar';
  const btn = (label, title, fn) => {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'peek-btn';
    b.textContent = label;
    b.title = title;
    b.addEventListener('click', fn);
    return b;
  };
  const frame = document.createElement('iframe');
  frame.className = 'peek-frame';
  frame.src = `${location.pathname}?peek=${isNew ? 'new' : '1'}#/${encodeURIComponent(path)}`;
  const close = async () => {
    if (current?.close !== close) return;
    current = null;
    document.removeEventListener('keydown', onKey, true);
    // Typing is saved a moment later; save it now so removing the frame loses nothing.
    try {
      await frame.contentWindow?.vaultFlush?.();
    } catch {
      // a frame that failed to load has nothing to save
    }
    back.remove();
    onClose();
  };
  const onKey = (e) => e.key === 'Escape' && !e.defaultPrevented && close();
  bar.append(btn('⤢', 'Abrir a pantalla completa', () => { close(); onExpand(); }), btn('✕', 'Cerrar (Esc)', close));
  win.append(bar, frame);
  back.append(win);
  back.addEventListener('mousedown', (e) => e.target === back && close());
  document.addEventListener('keydown', onKey, true);
  document.body.append(back);
  if (rect) { // grow from where the click was
    const w = win.getBoundingClientRect();
    win.style.transformOrigin = `${rect.left + rect.width / 2 - w.left}px ${rect.top + rect.height / 2 - w.top}px`;
  }
  current = { close };
}
