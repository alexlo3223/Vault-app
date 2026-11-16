// One-off: renders app/public/icon.svg to app/desktop/icon.png (512x512), the app and installer icon.
// Run with: npm run icon
import { app, BrowserWindow } from 'electron';
import { readFile, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

const SIZE = 512;
const svgFile = fileURLToPath(new URL('../app/public/icon.svg', import.meta.url));
const out = fileURLToPath(new URL('../app/desktop/icon.png', import.meta.url));

// Top-level await on app.whenReady() deadlocks an ESM main script in Electron, so this runs in a callback.
app.whenReady().then(async () => {
  const svg = await readFile(svgFile, 'utf8');
  const win = new BrowserWindow({ width: SIZE, height: SIZE, show: false, frame: false, transparent: true, useContentSize: true, webPreferences: { offscreen: true } });
  const html = `<style>html,body{margin:0;background:transparent}img{display:block;width:${SIZE}px;height:${SIZE}px}</style><img src="data:image/svg+xml;base64,${Buffer.from(svg).toString('base64')}">`;
  await win.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(html)}`);
  await new Promise((r) => setTimeout(r, 300));
  const img = (await win.webContents.capturePage({ x: 0, y: 0, width: SIZE, height: SIZE })).resize({ width: SIZE, height: SIZE });
  await writeFile(out, img.toPNG());
  console.log(`wrote ${out}`);
  app.quit();
});
