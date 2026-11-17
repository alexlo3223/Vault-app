// Desktop entry point (Electron main process). Runs the Vault server inside the app on a random
// 127.0.0.1 port that only this window uses, and shows the UI in a native window.
import { app, BrowserWindow, dialog, Menu, shell } from 'electron';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { appendFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { createApp } from '../server.mjs';
import { seedNotes } from './seed.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const ICON = join(HERE, 'icon.png');
const CONFIG = () => join(app.getPath('userData'), 'config.json');
// Startup diary in the data folder (%APPDATA%\Vault\startup.log): one line per step, so a silent exit leaves a trace.
// It is rewritten on every launch, so it only ever holds the last run.
const STARTUP_LOG = () => join(app.getPath('userData'), 'startup.log');
let logStarted = false;
function log(step, detail = '') {
  try {
    const line = `${new Date().toISOString()} ${step}${detail ? ` ${detail}` : ''}\n`;
    appendFileSync(STARTUP_LOG(), line, logStarted ? undefined : { flag: 'w' });
    logStarted = true;
  } catch (err) {
    // logging must never stop the app; the reason is kept next to the system temp folder instead
    try {
      appendFileSync(join(tmpdir(), 'vault-startup-error.txt'), `${step}: ${err?.stack ?? err}\n`);
    } catch {
      // nothing else to do
    }
  }
}
process.on('uncaughtException', (err) => log('uncaughtException', err?.stack ?? String(err)));
process.on('unhandledRejection', (err) => log('unhandledRejection', err?.stack ?? String(err)));
log('start', `packaged=${app.isPackaged} argv=${process.argv.join(' ')}`);
app.on('will-quit', () => log('will-quit'));
app.on('quit', (_e, code) => log('quit', `exitCode=${code}`));
// The tutorial notes: beside the app when installed (extraResources in package.json), the repo's own when not.
const TUTORIAL = () => (app.isPackaged ? join(process.resourcesPath, 'notes') : join(HERE, '..', '..', 'notes'));

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

async function saveConfig(patch) {
  await mkdir(dirname(CONFIG()), { recursive: true });
  await writeFile(CONFIG(), JSON.stringify({ ...(await readConfig()), ...patch }, null, 2));
}

async function chooseNotesFolder() {
  const { canceled, filePaths } = await dialog.showOpenDialog(win, {
    title: 'Elegir carpeta de notas',
    defaultPath: notesDir,
    properties: ['openDirectory', 'createDirectory'],
  });
  if (canceled || !filePaths[0] || filePaths[0] === notesDir) return;
  await saveConfig({ notesDir: filePaths[0] });
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
  win.once('ready-to-show', () => {
    log('window ready-to-show');
    win.show();
  });
  win.webContents.on('did-fail-load', (_e, code, desc) => log('page failed to load', `${code} ${desc}`));
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

const gotLock = app.requestSingleInstanceLock();
log('single-instance lock', gotLock ? 'acquired' : 'NOT acquired: another instance is treated as running, quitting');
if (!gotLock) {
  app.quit();
} else {
  app.on('second-instance', () => {
    if (!win) return;
    if (win.isMinimized()) win.restore();
    win.focus();
  });

  app.whenReady().then(async () => {
    log('ready', `userData=${app.getPath('userData')}`);
    const config = await readConfig();
    notesDir = config.notesDir ?? join(app.getPath('documents'), 'Vault');
    log('notes folder', notesDir);
    try {
      await mkdir(notesDir, { recursive: true });
      // First run (no folder remembered yet): an empty folder gets the tutorial. The folder is then remembered,
      // so emptying it later does not bring the tutorial back. A failed copy must not stop the app.
      if (!config.notesDir) {
        const seeded = await seedNotes(TUTORIAL(), notesDir).catch((err) => (log('seed failed', err.stack ?? String(err)), false));
        log('tutorial copied', String(seeded));
        await saveConfig({ notesDir });
      }
    } catch (err) {
      log('notes folder error', err.stack ?? String(err));
      dialog.showErrorBox('Vault', `No se puede usar la carpeta de notas:\n${notesDir}\n\n${err.message}`);
      app.quit();
      return;
    }
    server = createApp({ root: notesDir });
    await new Promise((ok, fail) => server.once('error', fail).listen(0, '127.0.0.1', ok));
    log('server listening', `port=${server.address().port}`);
    Menu.setApplicationMenu(buildMenu());
    createWindow(`http://127.0.0.1:${server.address().port}`);
    log('window created');
  }).catch((err) => {
    log('startup failed', err?.stack ?? String(err));
    dialog.showErrorBox('Vault', `Vault no pudo arrancar. Detalles en:\n${STARTUP_LOG()}\n\n${err?.message ?? err}`);
    app.quit();
  });

  app.on('window-all-closed', () => {
    log('window-all-closed');
    server?.close();
    app.quit();
  });
}
