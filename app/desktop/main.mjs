// Desktop entry point (Electron main process). Runs the Vault server inside the app on a random
// 127.0.0.1 port that only this window uses, and shows the UI in a native window.
import { app, BrowserWindow, dialog, Menu, shell } from 'electron';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { appendFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import http from 'node:http';
import { createClient } from '@supabase/supabase-js';
import { createApp, createHandler } from '../server.mjs';
import { createCloud } from '../lib/cloud.mjs';
import { seedNotes } from './seed.mjs';
import { syncOnce } from './sync.mjs';

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
log('start', `version=${app.getVersion()} packaged=${app.isPackaged} argv=${process.argv.join(' ')}`);
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

// ---------- cloud sync (Supabase) ----------
// The project address and public key are in app/cloud.json (see README); empty means the cloud menu is off.
const CLOUD = JSON.parse(await readFile(join(HERE, '..', 'cloud.json'), 'utf8').catch(() => '{}'));
const cloudOn = Boolean(CLOUD.url && CLOUD.key);
// The sign-in page's address: Supabase sends Google sign-ins back here, so it is fixed (supabase/config.toml).
const LOGIN_PORT = 47321;
const SYNC_EVERY = 30_000;
let db = null;
let syncing = null;
let lastSync = 'nunca';
let cloudUser = null; // e-mail of the signed-in account, for the menu

// Supabase keeps (and refreshes) the session in a file of the data folder.
function cloudClient() {
  const file = join(app.getPath('userData'), 'cloud-session.json');
  const read = () => readFile(file, 'utf8').then(JSON.parse).catch(() => ({}));
  const storage = {
    getItem: async (k) => (await read())[k] ?? null,
    setItem: async (k, v) => writeFile(file, JSON.stringify({ ...(await read()), [k]: v })),
    removeItem: async (k) => {
      const all = await read();
      delete all[k];
      await writeFile(file, JSON.stringify(all));
    },
  };
  return createClient(CLOUD.url, CLOUD.key, { auth: { storage, persistSession: true, autoRefreshToken: true, detectSessionInUrl: false } });
}

async function sync(manual = false) {
  const { data } = await db.auth.getSession();
  cloudUser = data.session?.user.email ?? null;
  if (!data.session) {
    if (manual) dialog.showMessageBox(win, { message: 'Inicia sesión en la nube primero (Archivo → Iniciar sesión en la nube…).' });
    return;
  }
  // One run at a time; a manual sync during a run waits for it.
  syncing ??= syncOnce({ root: notesDir, db, userId: data.session.user.id, statePath: join(app.getPath('userData'), 'sync.json'), log })
    .then((counts) => {
      lastSync = new Date().toLocaleTimeString();
      log('sync', JSON.stringify(counts));
      Menu.setApplicationMenu(buildMenu());
      // No reload here: it would drop what is being typed. The editor notices a page changed on disk when it saves.
      if (manual) dialog.showMessageBox(win, { message: 'Sincronizado.' });
    })
    .catch((err) => {
      log('sync failed', err.stack ?? String(err));
      if (manual) dialog.showErrorBox('Vault', `No se pudo sincronizar:\n${err.message}`);
    })
    .finally(() => (syncing = null));
  return syncing;
}

// Signs in through the same page as the web version, opened in the system browser (Google refuses app windows).
function cloudSignIn() {
  let server;
  const cloud = createCloud({
    url: CLOUD.url,
    key: CLOUD.key,
    onSignIn: async (s) => {
      const { data } = await db.auth.setSession({ access_token: s.access_token, refresh_token: s.refresh_token });
      cloudUser = data.session?.user.email ?? null;
      setTimeout(() => server.close(), 5000); // after the browser got its "done" page
      Menu.setApplicationMenu(buildMenu());
      sync(true);
    },
  });
  server = http.createServer(createHandler({ cloud }));
  server.once('error', (err) => dialog.showErrorBox('Vault', `No se pudo abrir el inicio de sesión (puerto ${LOGIN_PORT}):\n${err.message}`));
  server.listen(LOGIN_PORT, '127.0.0.1', () => shell.openExternal(`http://127.0.0.1:${LOGIN_PORT}/login.html?next=${encodeURIComponent('/login.html?done=1')}`));
  setTimeout(() => server.close(), 10 * 60_000); // nobody signed in: stop listening
}

async function cloudSignOut() {
  await db.auth.signOut().catch(() => {});
  cloudUser = null;
  Menu.setApplicationMenu(buildMenu());
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
        ...(!cloudOn
          ? []
          : cloudUser
            ? [
                { label: `Nube: ${cloudUser} · última sincronización ${lastSync}`, enabled: false },
                { label: 'Sincronizar ahora', click: () => sync(true) },
                { label: 'Cerrar sesión de la nube', click: () => cloudSignOut() },
                { type: 'separator' },
              ]
            : [{ label: 'Iniciar sesión en la nube…', click: () => cloudSignIn() }, { type: 'separator' }]),
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
    autoHideMenuBar: true, // no Archivo/Editar/Ver bar; Alt still shows it and its shortcuts keep working
    // Windows 11: the desktop behind the window is blurred into the sidebar (the page background is transparent, see style.css).
    // An opaque window colour would paint over the acrylic, so it is fully transparent there.
    ...(process.platform === 'win32' ? { backgroundMaterial: 'acrylic', backgroundColor: '#00000000' } : { backgroundColor: '#0b0b0f' }),
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
    if (cloudOn) {
      db = cloudClient();
      sync();
      setInterval(sync, SYNC_EVERY);
    }
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
