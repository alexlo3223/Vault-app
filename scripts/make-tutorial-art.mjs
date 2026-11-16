// Draws the pictures of the tutorial notes (banners, book covers, icons) into notes/attachments/.
// Run with: npm run art. Electron draws on a canvas with no window; the pictures are kept in the repo.
// Every picture is deterministic (a seeded random), so running this again gives the same files.
import { app, BrowserWindow } from 'electron';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

const out = (name) => fileURLToPath(new URL(`../notes/attachments/${name}`, import.meta.url));

// Runs inside the page (one call per picture): `spec` says what to draw.
function render(spec) {
  const { kind, w, h, seed } = spec;
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d');
  let s = seed >>> 0 || 1;
  const rand = () => {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
    return s / 4294967296;
  };
  const between = (a, b) => a + (b - a) * rand();
  const rgba = (hex, a) => {
    const n = parseInt(hex.slice(1), 16);
    return `rgba(${n >> 16},${(n >> 8) & 255},${n & 255},${a})`;
  };
  const roundRect = (x, y, rw, rh, r) => {
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.arcTo(x + rw, y, x + rw, y + rh, r);
    ctx.arcTo(x + rw, y + rh, x, y + rh, r);
    ctx.arcTo(x, y + rh, x, y, r);
    ctx.arcTo(x, y, x + rw, y, r);
    ctx.closePath();
  };
  const glow = (x, y, r, color, a) => {
    const g = ctx.createRadialGradient(x, y, 0, x, y, r);
    g.addColorStop(0, rgba(color, a));
    g.addColorStop(1, rgba(color, 0));
    ctx.globalCompositeOperation = 'screen';
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, w, h);
    ctx.globalCompositeOperation = 'source-over';
  };

  // ---------- banners: a dark gradient, soft glows, one motif, and a vignette ----------
  if (kind === 'banner') {
    const { c0, c1, glows, motif } = spec;
    const base = ctx.createLinearGradient(0, 0, w, h);
    base.addColorStop(0, c0);
    base.addColorStop(1, c1);
    ctx.fillStyle = base;
    ctx.fillRect(0, 0, w, h);
    for (const [fx, fy, fr, color, a] of glows) glow(fx * w, fy * h, fr * w, color, a);

    if (motif === 'stars') {
      for (let i = 0; i < 260; i++) {
        const x = rand() * w;
        const y = rand() * h;
        const r = rand() < 0.06 ? between(1.8, 3) : between(0.5, 1.3);
        ctx.fillStyle = `rgba(255,255,255,${between(0.25, 0.9)})`;
        ctx.beginPath();
        ctx.arc(x, y, r, 0, 7);
        ctx.fill();
      }
      ctx.strokeStyle = 'rgba(255,200,87,0.35)';
      ctx.lineWidth = 2;
      for (let i = 0; i < 3; i++) {
        ctx.beginPath();
        ctx.ellipse(w * 0.72, h * 0.62, w * (0.12 + i * 0.07), h * (0.12 + i * 0.07), -0.35, 0, 7);
        ctx.stroke();
      }
    } else if (motif === 'lines') {
      // a page of text: rows of rounded bars
      for (let row = 0; row < 11; row++) {
        const y = h * 0.14 + row * h * 0.075;
        let x = w * 0.08;
        while (x < w * 0.62) {
          const len = between(w * 0.04, w * 0.16);
          ctx.fillStyle = row === 0 ? 'rgba(255,200,87,0.55)' : `rgba(255,255,255,${between(0.05, 0.16)})`;
          roundRect(x, y, Math.min(len, w * 0.62 - x), row === 0 ? 20 : 11, 6);
          ctx.fill();
          x += len + w * 0.012;
        }
      }
      ctx.fillStyle = 'rgba(255,200,87,0.18)';
      roundRect(w * 0.7, h * 0.18, w * 0.2, h * 0.5, 22);
      ctx.fill();
      ctx.fillStyle = 'rgba(255,200,87,0.5)';
      for (let i = 0; i < 4; i++) {
        roundRect(w * 0.72, h * 0.24 + i * h * 0.1, w * 0.16, h * 0.04, 8);
        ctx.fill();
      }
    } else if (motif === 'grid') {
      const cols = 9;
      const rows = 5;
      const x0 = w * 0.1;
      const y0 = h * 0.16;
      const cw = (w * 0.8) / cols;
      const ch = (h * 0.62) / rows;
      const tint = ['#b48cff', '#7ab8ff', '#6fd39a', '#ff9f5a'];
      for (let r = 0; r < rows; r++) {
        for (let c = 0; c < cols; c++) {
          if (rand() < 0.4) {
            ctx.fillStyle = rgba(tint[Math.floor(rand() * tint.length)], between(0.16, 0.42));
            roundRect(x0 + c * cw + 6, y0 + r * ch + 6, cw - 12, ch - 12, 10);
            ctx.fill();
          }
        }
      }
      ctx.strokeStyle = 'rgba(255,255,255,0.14)';
      ctx.lineWidth = 2;
      for (let r = 0; r <= rows; r++) {
        ctx.beginPath();
        ctx.moveTo(x0, y0 + r * ch);
        ctx.lineTo(x0 + cols * cw, y0 + r * ch);
        ctx.stroke();
      }
      for (let c = 0; c <= cols; c++) {
        ctx.beginPath();
        ctx.moveTo(x0 + c * cw, y0);
        ctx.lineTo(x0 + c * cw, y0 + rows * ch);
        ctx.stroke();
      }
    } else if (motif === 'graph') {
      const nodes = [];
      for (let i = 0; i < 26; i++) nodes.push([between(0.06, 0.94) * w, between(0.12, 0.88) * h, between(5, 13)]);
      ctx.strokeStyle = 'rgba(122,184,255,0.3)';
      ctx.lineWidth = 2;
      for (let i = 0; i < nodes.length; i++) {
        for (let j = i + 1; j < nodes.length; j++) {
          const d = Math.hypot(nodes[i][0] - nodes[j][0], nodes[i][1] - nodes[j][1]);
          if (d < w * 0.17) {
            ctx.beginPath();
            ctx.moveTo(nodes[i][0], nodes[i][1]);
            ctx.lineTo(nodes[j][0], nodes[j][1]);
            ctx.stroke();
          }
        }
      }
      nodes.forEach(([x, y, r], i) => {
        ctx.fillStyle = i % 5 === 0 ? 'rgba(255,200,87,0.95)' : 'rgba(180,215,255,0.85)';
        ctx.beginPath();
        ctx.arc(x, y, r, 0, 7);
        ctx.fill();
      });
    } else if (motif === 'books') {
      const tint = ['#ffc857', '#ff9f5a', '#b48cff', '#7ab8ff', '#ff7ab8', '#6fd39a'];
      let x = w * 0.04;
      const shelf = h * 0.86;
      while (x < w * 0.96) {
        const bw = between(w * 0.018, w * 0.04);
        const bh = between(h * 0.32, h * 0.7);
        const g = ctx.createLinearGradient(x, shelf - bh, x + bw, shelf);
        const color = tint[Math.floor(rand() * tint.length)];
        g.addColorStop(0, rgba(color, 0.75));
        g.addColorStop(1, rgba(color, 0.35));
        ctx.fillStyle = g;
        roundRect(x, shelf - bh, bw, bh, 4);
        ctx.fill();
        ctx.fillStyle = 'rgba(0,0,0,0.25)';
        ctx.fillRect(x + bw * 0.2, shelf - bh + bh * 0.12, bw * 0.6, 3);
        x += bw + w * 0.004;
      }
      ctx.fillStyle = 'rgba(255,255,255,0.12)';
      ctx.fillRect(w * 0.02, shelf, w * 0.96, 6);
    }

    // a vignette, so the edges are quiet and text placed over it stays readable
    const v = ctx.createRadialGradient(w / 2, h / 2, h * 0.3, w / 2, h / 2, w * 0.62);
    v.addColorStop(0, 'rgba(8,9,13,0)');
    v.addColorStop(1, 'rgba(8,9,13,0.6)');
    ctx.fillStyle = v;
    ctx.fillRect(0, 0, w, h);
    const fade = ctx.createLinearGradient(0, h * 0.7, 0, h);
    fade.addColorStop(0, 'rgba(11,13,19,0)');
    fade.addColorStop(1, 'rgba(11,13,19,0.55)');
    ctx.fillStyle = fade;
    ctx.fillRect(0, h * 0.7, w, h * 0.3);
  }

  // ---------- book covers (portrait) ----------
  if (kind === 'book') {
    const { top, bottom, title, author, art } = spec;
    const g = ctx.createLinearGradient(0, 0, 0, h);
    g.addColorStop(0, top);
    g.addColorStop(1, bottom);
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, w, h);
    if (art === 'sun') {
      glow(w * 0.5, h * 0.36, w * 0.7, '#ffd68a', 0.55);
      ctx.fillStyle = '#ffe7b3';
      ctx.beginPath();
      ctx.arc(w * 0.5, h * 0.36, w * 0.2, 0, 7);
      ctx.fill();
      for (let i = 0; i < 4; i++) {
        ctx.fillStyle = `rgba(${90 - i * 18},${45 - i * 9},${20 - i * 4},${0.9})`;
        ctx.beginPath();
        ctx.moveTo(0, h * (0.55 + i * 0.09));
        for (let x = 0; x <= w; x += 20) ctx.lineTo(x, h * (0.55 + i * 0.09) - Math.sin(x / (95 - i * 12) + i * 2) * (28 - i * 4));
        ctx.lineTo(w, h);
        ctx.lineTo(0, h);
        ctx.fill();
      }
    } else if (art === 'wind') {
      for (let i = 0; i < 120; i++) {
        ctx.fillStyle = `rgba(255,255,255,${between(0.2, 0.85)})`;
        ctx.beginPath();
        ctx.arc(rand() * w, rand() * h * 0.7, between(0.6, 1.8), 0, 7);
        ctx.fill();
      }
      ctx.lineWidth = 5;
      for (let i = 0; i < 6; i++) {
        ctx.strokeStyle = `rgba(150,225,235,${0.8 - i * 0.1})`;
        ctx.beginPath();
        const y = h * (0.3 + i * 0.07);
        ctx.moveTo(w * 0.05, y);
        ctx.bezierCurveTo(w * 0.35, y - 70, w * 0.55, y + 80, w * 0.95, y - 20 - i * 8);
        ctx.stroke();
      }
    } else if (art === 'halls') {
      ctx.strokeStyle = 'rgba(255,255,255,0.35)';
      ctx.lineWidth = 6;
      for (let i = 0; i < 3; i++) {
        const cx = w * (0.22 + i * 0.28);
        ctx.beginPath();
        ctx.moveTo(cx - 62, h * 0.62);
        ctx.lineTo(cx - 62, h * 0.36);
        ctx.arc(cx, h * 0.36, 62, Math.PI, 0);
        ctx.lineTo(cx + 62, h * 0.62);
        ctx.stroke();
      }
      for (let i = 0; i < 7; i++) {
        ctx.strokeStyle = `rgba(255,255,255,${0.32 - i * 0.04})`;
        ctx.beginPath();
        for (let x = 0; x <= w; x += 12) ctx.lineTo(x, h * (0.66 + i * 0.045) + Math.sin(x / 38 + i) * 9);
        ctx.stroke();
      }
    }
    const vign = ctx.createLinearGradient(0, h * 0.55, 0, h);
    vign.addColorStop(0, 'rgba(0,0,0,0)');
    vign.addColorStop(1, 'rgba(0,0,0,0.55)');
    ctx.fillStyle = vign;
    ctx.fillRect(0, h * 0.55, w, h * 0.45);
    ctx.textAlign = 'center';
    ctx.fillStyle = '#fff';
    ctx.shadowColor = 'rgba(0,0,0,0.5)';
    ctx.shadowBlur = 14;
    ctx.font = '700 62px Georgia, serif';
    title.forEach((line, i) => ctx.fillText(line, w / 2, h * 0.77 + i * 66));
    ctx.shadowBlur = 0;
    ctx.fillStyle = 'rgba(255,255,255,0.82)';
    ctx.font = '400 30px Georgia, serif';
    ctx.fillText(author, w / 2, h * 0.77 + title.length * 66 + 8);
  }

  // ---------- icons (square) ----------
  if (kind === 'icon') {
    const g = ctx.createLinearGradient(0, 0, w, h);
    g.addColorStop(0, spec.c0);
    g.addColorStop(1, spec.c1);
    roundRect(0, 0, w, h, w * 0.22);
    ctx.fillStyle = g;
    ctx.fill();
    ctx.save();
    ctx.clip();
    glow(w * 0.3, h * 0.2, w * 0.7, '#ffffff', 0.35);
    ctx.restore();
    const tint = ['#0b0d13', '#1c2030', '#323849'];
    [[0.2, 0.32, 0.18, 0.5], [0.42, 0.22, 0.18, 0.6], [0.64, 0.3, 0.16, 0.52]].forEach(([x, y, bw, bh], i) => {
      ctx.fillStyle = tint[i];
      roundRect(w * x, h * y, w * bw, h * bh, w * 0.03);
      ctx.fill();
      ctx.fillStyle = 'rgba(255,200,87,0.9)';
      ctx.fillRect(w * (x + 0.03), h * (y + 0.08), w * (bw - 0.06), h * 0.02);
    });
  }
  // Gradients do not compress as PNG (about 1.8 MB a banner); JPEG keeps them at a few hundred KB.
  return spec.name.endsWith('.jpg') ? canvas.toDataURL('image/jpeg', 0.88) : canvas.toDataURL('image/png');
}

const BANNER = { w: 1920, h: 720 };
const pictures = [
  { name: 'banner-inicio.jpg', kind: 'banner', ...BANNER, seed: 11, c0: '#0b0d13', c1: '#1a1530', motif: 'stars', glows: [[0.78, 0.55, 0.45, '#b48cff', 0.55], [0.2, 0.3, 0.4, '#ffc857', 0.32], [0.5, 1, 0.5, '#7ab8ff', 0.18]] },
  { name: 'banner-editor.jpg', kind: 'banner', ...BANNER, seed: 23, c0: '#0b0d13', c1: '#241a0e', motif: 'lines', glows: [[0.8, 0.4, 0.42, '#ffc857', 0.38], [0.1, 0.9, 0.4, '#ff9f5a', 0.2]] },
  { name: 'banner-bases.jpg', kind: 'banner', ...BANNER, seed: 37, c0: '#0b0d13', c1: '#14122b', motif: 'grid', glows: [[0.25, 0.5, 0.5, '#7ab8ff', 0.3], [0.85, 0.3, 0.4, '#b48cff', 0.4]] },
  { name: 'banner-vistas.jpg', kind: 'banner', ...BANNER, seed: 41, c0: '#0b0d13', c1: '#0e1f2b', motif: 'graph', glows: [[0.5, 0.5, 0.55, '#6fd39a', 0.22], [0.15, 0.2, 0.35, '#7ab8ff', 0.3]] },
  { name: 'banner-biblioteca.jpg', kind: 'banner', ...BANNER, seed: 59, c0: '#0b0d13', c1: '#2a1411', motif: 'books', glows: [[0.7, 0.3, 0.5, '#ff9f5a', 0.4], [0.15, 0.4, 0.4, '#ff7ab8', 0.22]] },
  { name: 'portada-dune.jpg', kind: 'book', w: 600, h: 800, seed: 3, top: '#f6c883', bottom: '#8a3f1c', title: ['DUNE'], author: 'Frank Herbert', art: 'sun' },
  { name: 'portada-nombre-del-viento.jpg', kind: 'book', w: 600, h: 800, seed: 5, top: '#0e1b3d', bottom: '#2f6f8a', title: ['EL NOMBRE', 'DEL VIENTO'], author: 'Patrick Rothfuss', art: 'wind' },
  { name: 'portada-piranesi.jpg', kind: 'book', w: 600, h: 800, seed: 7, top: '#a9c4d4', bottom: '#3c566b', title: ['PIRANESI'], author: 'Susanna Clarke', art: 'halls' },
  { name: 'icono-biblioteca.png', kind: 'icon', w: 256, h: 256, seed: 1, c0: '#ffc857', c1: '#ff7a3d' },
];

app.whenReady().then(async () => {
  await mkdir(out(''), { recursive: true });
  const win = new BrowserWindow({ show: false, webPreferences: { offscreen: true } });
  await win.loadURL('about:blank');
  for (const spec of pictures) {
    const url = await win.webContents.executeJavaScript(`(${render.toString()})(${JSON.stringify(spec)})`);
    const png = Buffer.from(url.split(',')[1], 'base64');
    await writeFile(out(spec.name), png);
    console.log(`${spec.name}  ${(png.length / 1024).toFixed(0)} KB`);
  }
  // the app's own icon is the icon of the tutorial itself
  await writeFile(out('icono-vault.png'), await readFile(fileURLToPath(new URL('../app/desktop/icon.png', import.meta.url))));
  console.log('icono-vault.png  (copy of the app icon)');
  app.quit();
});
