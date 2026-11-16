// Desktop entry point (Electron main process). Runs the Vault server inside the app on a random
// 127.0.0.1 port that only this window uses, and shows the UI in a native window.
import { app, BrowserWindow, dialog, Menu, shell } from 'electron';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createApp } from '../server.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const ICON = join(HERE, 'icon.png');
const CONFIG = () => join(app.getPath('userData'), 'config.json');

let win = null;
let server = null;
let notesDir = null;

async function readConfig() {
  try {
    return JSON.parse(await readFile(CONFIG(), 'utf8'));
  } catch {
    return {};
  }
}

async function chooseNotesFolder() {
  const { canceled, filePaths } = await dialog.showOpenDialog(win, {
    title: 'Elegir carpeta de notas',
    defaultPath: notesDir,
    properties: ['openDirectory', 'createDirectory'],
  });
  if (canceled || !filePaths[0] || filePaths[0] === notesDir) return;
  await mkdir(dirname(CONFIG()), { recursive: true });
  await writeFile(CONFIG(), JSON.stringify({ ...(await readConfig()), notesDir: filePaths[0] }, null, 2));
  app.relaunch();
  app.quit();
}

function buildMenu() {
  const dev = !app.isPackaged;
  return Menu.buildFromTemplate([
    {
      label: 'Archivo',
      submenu: [
        { label: 'Abrir carpeta de notas', click: () => shell.openPath(notesDir) },
        { label: 'Cambiar carpeta de notas…', click: () => chooseNotesFolder() },
        { type: 'separator' },
        { label: 'Salir', role: 'quit' },
      ],
    },
    {
      label: 'Editar',
      submenu: [
        { label: 'Deshacer', role: 'undo' },
        { label: 'Rehacer', role: 'redo' },
        { type: 'separator' },
        { label: 'Cortar', role: 'cut' },
        { label: 'Copiar', role: 'copy' },
        { label: 'Pegar', role: 'paste' },
        { label: 'Seleccionar todo', role: 'selectAll' },
      ],
    },
    {
      label: 'Ver',
      submenu: [
        { label: 'Recargar', role: 'reload' },
        ...(dev ? [{ label: 'Herramientas de desarrollo', role: 'toggleDevTools' }] : []),
        { type: 'separator' },
        { label: 'Tamaño real', role: 'resetZoom' },
        { label: 'Acercar', role: 'zoomIn' },
        { label: 'Alejar', role: 'zoomOut' },
        { type: 'separator' },
        { label: 'Pantalla completa', role: 'togglefullscreen' },
      ],
    },
  ]);
}

// Web links, e-mail addresses and phone numbers open in the system's own apps.
const isExternal = (url) => /^(https?:\/\/|mailto:|tel:)/i.test(url);

function createWindow(origin) {
  win = new BrowserWindow({
    width: 1280,
    height: 800,
    minWidth: 480,
    minHeight: 360,
    title: 'Vault',
    icon: ICON,
    backgroundColor: '#0b0b0f',
    show: false,
    webPreferences: { contextIsolation: true, nodeIntegration: false, sandbox: true },
  });
  win.once('ready-to-show', () => win.show());
  // Links to the web open in the system browser; nothing else may open a new window.
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (isExternal(url) && !url.startsWith(origin)) shell.openExternal(url);
    return { action: 'deny' };
  });
  win.webContents.on('will-navigate', (e, url) => {
    if (url.startsWith(origin)) return;
    e.preventDefault();
    if (isExternal(url)) shell.openExternal(url);
  });
  win.on('closed', () => (win = null));
  win.loadURL(`${origin}/`);
}

if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on('second-instance', () => {
    if (!win) return;
    if (win.isMinimized()) win.restore();
    win.focus();
  });

  app.whenReady().then(async () => {
    notesDir = (await readConfig()).notesDir ?? join(app.getPath('documents'), 'Vault');
    try {
      await mkdir(notesDir, { recursive: true });
    } catch (err) {
      dialog.showErrorBox('Vault', `No se puede usar la carpeta de notas:\n${notesDir}\n\n${err.message}`);
      app.quit();
      return;
    }
    server = createApp({ root: notesDir });
    await new Promise((ok, fail) => server.once('error', fail).listen(0, '127.0.0.1', ok));
    Menu.setApplicationMenu(buildMenu());
    createWindow(`http://127.0.0.1:${server.address().port}`);
  });

  app.on('window-all-closed', () => {
    server?.close();
    app.quit();
  });
}
