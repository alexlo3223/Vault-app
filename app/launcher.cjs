// Entry point of Vault.exe (Node single executable, built as a GUI app so no console window appears).
// Starts the server from the app/ folder next to the exe and opens it in an app window.
// The server stops by itself once the window is closed (bye beacon) or stops sending pings.
const { createRequire } = require('node:module');
const { spawn } = require('node:child_process');
const { dirname, join } = require('node:path');

const base = dirname(process.execPath);
const { createApp } = createRequire(join(base, 'app', 'launcher.cjs'))('./server.mjs');
const port = Number(process.env.PORT ?? 4321);
const url = `http://localhost:${port}`;
// shortcut: Edge's --app window is Windows-only; on other systems open the URL with xdg-open / open.
const open = () => spawn('cmd', ['/c', 'start', '', 'msedge', `--app=${url}`], { stdio: 'ignore', detached: true, windowsHide: true }).unref();

const BYE_GRACE = 5000; // a reload sends bye and ping within this window, so it does not stop the server
const IDLE_MAX = 120000; // minimized windows throttle timers, so pings are allowed to be slow
const FIRST_PING_MAX = 30000; // time allowed for the page to load before the first ping

const app = createApp({ root: join(base, 'notes') });
let lastPing = Date.now();
let byeAt = null;
let seen = false;
app.on('ping', () => {
  seen = true;
  lastPing = Date.now();
  byeAt = null;
});
app.on('bye', () => {
  byeAt = Date.now();
});

setInterval(() => {
  const now = Date.now();
  if ((byeAt && now - byeAt > BYE_GRACE) || (seen ? now - lastPing > IDLE_MAX : now - lastPing > FIRST_PING_MAX)) process.exit(0);
}, 1000);

app
  .on('error', (e) => {
    if (e.code !== 'EADDRINUSE') throw e;
    open(); // already running
    setTimeout(() => process.exit(0), 500);
  })
  .listen(port, '127.0.0.1', () => open());
