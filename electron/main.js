'use strict';
// AGY Sessions — application de bureau (Windows / macOS).
const { app, BrowserWindow, Tray, Menu, nativeImage, shell, dialog, ipcMain, session, screen, Notification, nativeTheme } = require('electron');
const fs = require('fs');
const path = require('path');
const http = require('http');
const { spawn, execFile, execFileSync, spawnSync } = require('child_process');
const { ROOT, PORT, IS_WIN, IS_MAC, DATA } = require('../lib/config');

const ORIGIN = `http://127.0.0.1:${PORT}`;
const URL_ = `${ORIGIN}/`;
const SERVER = path.join(ROOT, 'server.js');
const ICON = path.join(ROOT, 'public', IS_WIN ? 'icon.ico' : 'icon.png');
const STATE = path.join(DATA, 'app-window.json');
const START_HIDDEN = process.argv.includes('--hidden');

const DEFAULT_PORT = 7898; // synchronisé avec lib/config.js
app.setName('Free Session Manager');
if (PORT !== DEFAULT_PORT) app.setPath('userData', path.join(DATA, 'electron'));
if (IS_WIN) app.setAppUserModelId('com.free-session-manager.app');
if (!app.requestSingleInstanceLock()) { app.quit(); return; }

let win = null;
let tray = null;
let quitting = false;
const prefs = { minimizeToTray: true, closeToTray: true };
let attention = 0;
let updates = null;

let macNative = null;
function macNotificationsAllowed() {
  if (macNative !== null) return macNative;
  if (!IS_MAC) return (macNative = true);
  try {
    const bundle = path.resolve(process.execPath, '..', '..', '..');
    const r = spawnSync('codesign', ['-dv', bundle], { encoding: 'utf8', timeout: 3000 });
    const team = (/TeamIdentifier=(.+)/.exec(r.stderr || '') || [])[1];
    macNative = !!team && team.trim() !== 'not set';
  } catch { macNative = false; }
  return macNative;
}

const liveNotes = new Set();
function notify(title, body, sessionId) {
  const clean = v => String(v || '').replace(/[\u0000-\u001f]+/g, ' ').slice(0, 300);
  title = clean(title) || 'Free Session Manager'; body = clean(body);
  if (IS_MAC && !macNotificationsAllowed()) {
    execFile('osascript', ['-e', 'on run argv', '-e', 'display notification (item 2 of argv) with title (item 1 of argv)', '-e', 'end run', title, body], () => { });
    return;
  }
  if (!Notification.isSupported()) return;
  const n = new Notification({ title, body, silent: true });
  liveNotes.add(n);
  n.on('click', () => { liveNotes.delete(n); showWindow(); if (sessionId) send(`select:${sessionId}`); });
  n.on('close', () => liveNotes.delete(n));
  n.show();
}

function sameOrigin(u) {
  try { return new URL(u).origin === ORIGIN; } catch { return false; }
}

function isUp() {
  return new Promise(resolve => {
    const req = http.get(URL_, { timeout: 800 }, res => { res.resume(); resolve(res.statusCode === 200); });
    req.on('error', () => resolve(false));
    req.on('timeout', () => { req.destroy(); resolve(false); });
  });
}

function serverGet(path_) {
  return new Promise(resolve => {
    const token = (() => { try { return fs.readFileSync(path.join(DATA, 'token'), 'utf8').trim(); } catch { return ''; } })();
    const req = http.get(`${ORIGIN}${path_}`, { timeout: 800, headers: { 'X-ASM-Token': token } }, res => {
      let b = ''; res.on('data', c => { b += c; }); res.on('end', () => { try { resolve(JSON.parse(b)); } catch { resolve(null); } });
    });
    req.on('error', () => resolve(null));
    req.on('timeout', () => { req.destroy(); resolve(null); });
  });
}

let serverProc = null;
function startServer() {
  const env = { ...process.env, ASM_PORT: String(PORT), ASM_DATA: DATA, ELECTRON_RUN_AS_NODE: '1' };
  serverProc = spawn(process.execPath, [SERVER, `--port=${PORT}`], { cwd: ROOT, env, stdio: 'ignore', windowsHide: true });
  serverProc.on('exit', () => { serverProc = null; });
}

function stopServer() {
  if (serverProc) {
    try { serverProc.kill('SIGTERM'); } catch { }
    serverProc = null;
  }
  const pidFile = path.join(DATA, 'server.pid');
  try {
    const pid = Number(fs.readFileSync(pidFile, 'utf8'));
    if (pid) process.kill(pid, IS_WIN ? undefined : 'SIGTERM');
  } catch { }
}

async function ensureServer() {
  if (await isUp()) return true;
  startServer();
  for (let i = 0; i < 40; i++) {
    await new Promise(r => setTimeout(r, 200));
    if (await isUp()) return true;
  }
  return false;
}

function loadState() {
  try { return JSON.parse(fs.readFileSync(STATE, 'utf8')); } catch { return {}; }
}
function saveState() {
  if (!win || win.isDestroyed()) return;
  const b = win.getBounds();
  try { fs.writeFileSync(STATE, JSON.stringify({ x: b.x, y: b.y, width: b.width, height: b.height, isMaximized: win.isMaximized() })); } catch { }
}

function createWindow() {
  const st = loadState();
  const opts = {
    width: Math.min(2400, Math.max(900, st.width || 1400)),
    height: Math.min(1800, Math.max(600, st.height || 900)),
    minWidth: 800, minHeight: 500,
    show: false,
    backgroundColor: nativeTheme.shouldUseDarkColors ? '#16181c' : '#f5f4ef',
    icon: ICON,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true, sandbox: true,
      nodeIntegration: false, webSecurity: true, allowRunningInsecureContent: false,
      devTools: !app.isPackaged,
    },
  };
  if (st.x !== undefined && st.y !== undefined) {
    const inside = screen.getAllDisplays().some(d => {
      const b = d.bounds; return st.x >= b.x && st.y >= b.y && st.x < b.x + b.width && st.y < b.y + b.height;
    });
    if (inside) { opts.x = st.x; opts.y = st.y; }
  }

  win = new BrowserWindow(opts);
  if (st.isMaximized) win.maximize();

  win.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:\/\//i.test(url)) shell.openExternal(url);
    return { action: 'deny' };
  });
  win.webContents.on('will-navigate', (e, target) => { if (!sameOrigin(target)) { e.preventDefault(); shell.openExternal(target); } });

  win.on('close', e => {
    if (quitting) return;
    saveState();
    if (prefs.closeToTray) { e.preventDefault(); toTray(false); }
  });
  win.on('minimize', e => {
    if (prefs.minimizeToTray) { e.preventDefault(); toTray(true); }
  });
  win.on('resize', debounce(saveState, 500));
  win.on('move', debounce(saveState, 500));

  win.once('ready-to-show', () => {
    if (START_HIDDEN && !win.__forceShow) toTray(true);
    else showWindow();
  });

  win.loadURL(URL_);
}

function toTray(minimized = false) {
  if (!win || win.isDestroyed()) return;
  win.hide();
  if (IS_MAC && minimized && prefs.minimizeToTray) app.dock?.hide?.();
  const flag = path.join(DATA, 'app-tray-hint');
  if (tray && !fs.existsSync(flag)) {
    try { fs.writeFileSync(flag, new Date().toISOString()); } catch { }
    const msg = IS_WIN
      ? 'Free Session Manager continue en arrière-plan avec vos sessions. Cliquez sur son icône près de l’horloge pour la rouvrir.'
      : 'Free Session Manager continue en arrière-plan avec vos sessions. Rouvrez-la depuis le Dock ou la barre des menus.';
    if (IS_WIN && tray.displayBalloon) tray.displayBalloon({ title: 'Free Session Manager', content: msg, iconType: 'info' });
    else notify('Free Session Manager', msg);
  }
}

function showWindow() {
  if (IS_MAC) app.dock?.show?.();
  if (!win || win.isDestroyed()) createWindow();
  win.__forceShow = true;
  if (win.isMinimized()) win.restore();
  if (process.env.ASM_HIDE_WINDOW || process.env.CSM_HIDE_WINDOW) return;
  win.show(); win.focus();
}
const send = (action) => {
  showWindow();
  win.webContents.send('asm:action', action);
  win.webContents.send('csm:action', action);
};

function hardenSession() {
  const ses = session.defaultSession;
  const allowed = new Set(['notifications', 'clipboard-read', 'clipboard-sanitized-write', 'fullscreen']);
  ses.setPermissionRequestHandler((wc, perm, cb, details) => cb(allowed.has(perm) && sameOrigin(details.requestingUrl || wc.getURL())));
  ses.setPermissionCheckHandler((wc, perm, origin) => allowed.has(perm) && sameOrigin(origin + '/'));
  // Les téléchargements (ex. export Markdown de la conversation) doivent fonctionner dans l'app.
}

function trusted(e) { return sameOrigin(e.senderFrame?.url || ''); }

function registerIpc() {
  const handlePick = async (e, initial) => {
    if (!trusted(e)) return null;
    const r = await dialog.showOpenDialog(win, {
      title: 'Dossier de travail de la session AGY',
      defaultPath: typeof initial === 'string' && initial && fs.existsSync(initial) ? initial : undefined,
      properties: ['openDirectory', 'createDirectory', 'promptToCreate'],
    });
    return r.canceled ? null : r.filePaths[0] || null;
  };
  ipcMain.handle('asm:pick-folder', handlePick);
  ipcMain.handle('csm:pick-folder', handlePick);

  const handleAttention = (e, n) => {
    if (!trusted(e)) return;
    n = Math.max(0, Math.min(99, Number(n) || 0));
    if (IS_MAC) { app.setBadgeCount(n); if (!macNotificationsAllowed()) setDockDot(n > 0); }
    if (IS_WIN && win) win.setOverlayIcon(n ? badgeIcon() : null, n ? `${n} en attente` : '');
    if (IS_MAC) { if (n > attention && win && !win.isFocused()) app.dock?.bounce?.('informational'); }
    else if (n && win && !win.isFocused()) win.flashFrame(true);
    attention = n;
    refreshTrayIcon();
  };
  ipcMain.on('asm:attention', handleAttention);
  ipcMain.on('csm:attention', handleAttention);

  const handlePrefs = (e, p) => {
    if (!trusted(e) || !p || typeof p !== 'object') return;
    for (const k of Object.keys(prefs)) if (typeof p[k] === 'boolean') prefs[k] = p[k];
  };
  ipcMain.on('asm:prefs', handlePrefs);
  ipcMain.on('csm:prefs', handlePrefs);

  ipcMain.on('asm:focus', e => { if (trusted(e)) showWindow(); });
  ipcMain.on('csm:focus', e => { if (trusted(e)) showWindow(); });

  const handleNotify = (e, o) => { if (trusted(e) && o && typeof o === 'object') notify(o.title, o.body, typeof o.id === 'string' ? o.id : ''); };
  ipcMain.on('asm:notify', handleNotify);
  ipcMain.on('csm:notify', handleNotify);

  const handleUpdate = async (e, action) => {
    if (!trusted(e) || !updates) return updates?.state || null;
    if (action === 'check') await updates.check();
    else if (action === 'install') await updates.install();
    return updates.state;
  };
  ipcMain.handle('asm:update', handleUpdate);
  ipcMain.handle('csm:update', handleUpdate);

  ipcMain.on('asm:app-version', e => { e.returnValue = trusted(e) ? app.getVersion() : ''; });
  ipcMain.on('csm:app-version', e => { e.returnValue = trusted(e) ? app.getVersion() : ''; });

  const handleRestart = async e => {
    if (!trusted(e)) return false;
    stopServer();
    for (let i = 0; i < 75 && (await isUp()); i++) await new Promise(r => setTimeout(r, 200));
    const ok = await ensureServer();
    if (ok && win && !win.isDestroyed()) win.loadURL(URL_);
    return ok;
  };
  ipcMain.handle('asm:restart-server', handleRestart);
  ipcMain.handle('csm:restart-server', handleRestart);

  const handleRelaunch = e => {
    if (!trusted(e)) return false;
    app.relaunch();
    app.exit(0);
    return true;
  };
  ipcMain.handle('asm:relaunch-app', handleRelaunch);
  ipcMain.handle('csm:relaunch-app', handleRelaunch);
}

let trayImg = null, trayImgAlert = null;
function trayImages() {
  if (trayImg) return;
  const size = IS_MAC ? 18 : 16;
  trayImg = nativeImage.createFromPath(path.join(ROOT, 'public', 'icon.png')).resize({ width: size, height: size, quality: 'best' });
  const s = trayImg.getSize(), bmp = Buffer.from(trayImg.toBitmap());
  const r = Math.round(s.width * 0.28), cx = s.width - r - 0.5, cy = s.height - r - 0.5;
  for (let y = 0; y < s.height; y++) for (let x = 0; x < s.width; x++) {
    const d = Math.hypot(x - cx, y - cy), i = (y * s.width + x) * 4;
    if (d <= r + 1) {
      const edge = d > r;
      const [R_, G, B] = edge ? [20, 24, 34] : [240, 86, 74];
      bmp[i] = B; bmp[i + 1] = G; bmp[i + 2] = R_;
      bmp[i + 3] = 255;
    }
  }
  trayImgAlert = nativeImage.createFromBitmap(bmp, { width: s.width, height: s.height });
}

async function refreshTrayIcon() {
  if (!tray) return;
  trayImages();
  tray.setImage(attention ? trayImgAlert : trayImg);
  const list = (await serverGet('/api/sessions')) || [];
  const alive = list.filter(s => s.alive).length;
  tray.setToolTip(`Free Session Manager — ${alive} session${alive > 1 ? 's' : ''} active${alive > 1 ? 's' : ''}${attention ? ` · ${attention} en attente de réponse` : ''}`);
}

let dockImg = null, dockImgAlert = null, dockDot = false;
function setDockDot(on) {
  if (on === dockDot || !app.dock) return;
  dockDot = on;
  if (!dockImg) {
    dockImg = nativeImage.createFromPath(path.join(ROOT, 'public', 'icon.png'));
    const s = dockImg.getSize(), bmp = Buffer.from(dockImg.toBitmap());
    const r = s.width * 0.14, cx = s.width - r - s.width * 0.06, cy = r + s.height * 0.06;
    for (let y = 0; y < s.height; y++) for (let x = 0; x < s.width; x++) {
      const d = Math.hypot(x - cx, y - cy), i = (y * s.width + x) * 4;
      if (d > r + 1) continue;
      const a = Math.min(1, r + 1 - d);
      [48, 59, 240].forEach((c, k) => { bmp[i + k] = Math.round(bmp[i + k] * (1 - a) + c * a); });
      bmp[i + 3] = Math.max(bmp[i + 3], Math.round(255 * a));
    }
    dockImgAlert = nativeImage.createFromBitmap(bmp, { width: s.width, height: s.height });
  }
  app.dock.setIcon(on ? dockImgAlert : dockImg);
}

let badge = null;
function badgeIcon() {
  if (badge) return badge;
  const size = 16, buf = Buffer.alloc(size * size * 4);
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
    const d = Math.hypot(x - 7.5, y - 7.5), i = (y * size + x) * 4;
    if (d <= 7.5) { buf[i] = 0x4a; buf[i + 1] = 0x56; buf[i + 2] = 0xf0; buf[i + 3] = d > 6.5 ? 160 : 255; }
  }
  return (badge = nativeImage.createFromBitmap(buf, { width: size, height: size }));
}

function loginItem() { return app.getLoginItemSettings({ args: ['--hidden'] }).openAtLogin; }
function setLoginItem(on) { app.setLoginItemSettings({ openAtLogin: on, openAsHidden: true, args: ['--hidden'] }); }

let refreshTray = () => { };
function updateMenuItems() {
  const st = updates?.state; if (!st) return [];
  if (st.status === 'ready') return [{ label: `Redémarrer pour installer la version ${st.version}`, click: () => updates.install() }, { type: 'separator' }];
  if (st.status === 'available') return [{ label: `Télécharger la version ${st.version}…`, click: () => updates.install() }, { type: 'separator' }];
  if (st.status === 'downloading') return [{ label: `Téléchargement de la version ${st.version || ''}… ${st.progress ? st.progress + ' %' : ''}`, enabled: false }, { type: 'separator' }];
  return [];
}
function buildTray() {
  const img = nativeImage.createFromPath(path.join(ROOT, 'public', 'icon.png')).resize({ width: IS_MAC ? 18 : 16, height: IS_MAC ? 18 : 16 });
  tray = new Tray(img);
  tray.setToolTip('Free Session Manager');
  const STATE = { working: '🟠', attention: '🔴', idle: '🟢', starting: '⚪', exited: '⚫' };
  const LABEL = { working: 'travaille', attention: 'attend votre réponse', idle: 'prête', starting: 'démarre', exited: 'arrêtée' };
  let lastSessions = [];
  const sessionItems = () => {
    const list = lastSessions.slice().sort((a, b) => (a.order || 0) - (b.order || 0));
    if (!list.length) return [];
    const items = list.slice(0, 12).map(s => ({
      label: `${STATE[s.status] || '•'}  ${s.name.length > 40 ? s.name.slice(0, 39) + '…' : s.name}   —  ${LABEL[s.status] || s.status}`,
      click: () => send(`select:${s.id}`),
    }));
    if (list.length > 12) items.push({ label: `… et ${list.length - 12} autre(s)`, click: showWindow });
    return [{ label: 'Sessions', enabled: false }, ...items, { type: 'separator' }];
  };
  const menu = () => Menu.buildFromTemplate([
    ...sessionItems(),
    { label: 'Ouvrir Free Session Manager', click: showWindow },
    ...updateMenuItems(),
    { label: 'Nouvelle session…', click: () => send('new') },
    { label: 'Historique…', click: () => send('history') },
    { label: 'Réglages…', click: () => send('settings') },
    { type: 'separator' },
    { label: 'Rechercher des mises à jour', click: () => updates?.check(), visible: !!updates && app.isPackaged },
    { label: 'Lancer au démarrage de l’ordinateur', type: 'checkbox', checked: loginItem(), click: i => setLoginItem(i.checked), visible: !process.windowsStore },
    { label: 'Redémarrer le serveur (les sessions reviennent)', click: async () => { stopServer(); await new Promise(r => setTimeout(r, 800)); await ensureServer(); win?.loadURL(URL_); } },
    { type: 'separator' },
    { label: 'Quitter (les sessions continuent)', click: () => { quitting = true; app.quit(); } },
    { label: 'Quitter et arrêter toutes les sessions', click: () => { quitting = true; stopServer(); app.quit(); } },
  ]);
  const popup = async () => { lastSessions = (await serverGet('/api/sessions')) || []; tray.popUpContextMenu(menu()); };
  refreshTray = () => { if (IS_MAC) tray.setContextMenu(menu()); };
  if (IS_MAC) { tray.setContextMenu(menu()); tray.on('mouse-enter', async () => { lastSessions = (await serverGet('/api/sessions')) || []; tray.setContextMenu(menu()); }); }
  else {
    tray.on('click', () => (win && win.isVisible() && win.isFocused() ? toTray() : showWindow()));
    tray.on('right-click', popup);
  }
  tray.on('double-click', showWindow);
  refreshTrayIcon();
  setInterval(refreshTrayIcon, 15000);
}

const L = (fr, en) => (/^fr/i.test(app.getLocale() || '') ? fr : en);
function buildAppMenu() {
  if (!IS_MAC) { Menu.setApplicationMenu(null); return; }
  Menu.setApplicationMenu(Menu.buildFromTemplate([
    { role: 'appMenu', submenu: [{ role: 'about', label: L('À propos de Free Session Manager', 'About Free Session Manager') }, { type: 'separator' }, { role: 'hide', label: L('Masquer Free Session Manager', 'Hide Free Session Manager') }, { role: 'hideOthers', label: L('Masquer les autres', 'Hide Others') }, { role: 'unhide', label: L('Tout afficher', 'Show All') }, { type: 'separator' },
      { label: L('Quitter (les sessions continuent)', 'Quit (sessions keep running)'), accelerator: 'Cmd+Q', click: () => { quitting = true; app.quit(); } }] },
    { label: L('Fichier', 'File'), submenu: [{ label: L('Nouvelle session…', 'New session…'), accelerator: 'Cmd+N', click: () => send('new') }, { label: L('Historique…', 'History…'), accelerator: 'Cmd+Shift+H', click: () => send('history') }, { label: L('Réglages…', 'Settings…'), accelerator: 'Cmd+,', click: () => send('settings') }, { type: 'separator' }, { role: 'close', label: L('Fermer la fenêtre', 'Close Window') }] },
    { label: L('Édition', 'Edit'), submenu: [
      { role: 'undo', label: L('Annuler', 'Undo') }, { role: 'redo', label: L('Rétablir', 'Redo') }, { type: 'separator' },
      { role: 'cut', label: L('Couper', 'Cut') }, { role: 'copy', label: L('Copier', 'Copy') }, { role: 'paste', label: L('Coller', 'Paste') },
      { role: 'pasteAndMatchStyle', label: L('Coller et adapter le style', 'Paste and Match Style') }, { role: 'delete', label: L('Supprimer', 'Delete') },
      { role: 'selectAll', label: L('Tout sélectionner', 'Select All') }] },
    { label: L('Présentation', 'View'), submenu: [{ role: 'reload', label: L('Recharger', 'Reload') }, { role: 'togglefullscreen', label: L('Plein écran', 'Toggle Full Screen') }] },
    { label: L('Fenêtre', 'Window'), role: 'window', submenu: [
      { role: 'minimize', label: L('Réduire', 'Minimize') }, { role: 'zoom', label: L('Zoom', 'Zoom') }, { type: 'separator' },
      { role: 'front', label: L('Tout ramener au premier plan', 'Bring All to Front') }] },
  ]));
}

function debounce(fn, ms) { let t; return (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms); }; }

app.on('second-instance', showWindow);
app.on('activate', showWindow);
app.on('before-quit', () => { quitting = true; saveState(); });
app.on('window-all-closed', e => e.preventDefault());
app.on('web-contents-created', (e, wc) => { wc.on('will-attach-webview', ev => ev.preventDefault()); });

app.whenReady().then(async () => {
  hardenSession();
  registerIpc();
  buildAppMenu();
  if (!process.env.ASM_HIDE_WINDOW && !process.env.CSM_HIDE_WINDOW) buildTray();
  const firstRun = path.join(DATA, 'app-first-run');
  if (app.isPackaged && !process.windowsStore && PORT === DEFAULT_PORT && !fs.existsSync(firstRun)) { fs.mkdirSync(DATA, { recursive: true }); fs.writeFileSync(firstRun, new Date().toISOString()); setLoginItem(true); }
  if (!(await ensureServer())) {
    (process.env.ASM_HIDE_WINDOW ? (t, m) => console.error(m) : dialog.showErrorBox)('Free Session Manager', `Le serveur local ne démarre pas.\n\nJournal : ${path.join(DATA, 'server.log')}`);
  }
  createWindow();
  updates = require('./updater')({
    enabled: async () => ((await serverGet('/api/settings')) || {}).autoUpdate !== false,
    beforeInstall: async () => { stopServer(); for (let i = 0; i < 75 && (await isUp()); i++) await new Promise(r => setTimeout(r, 200)); },
    onState: st => {
      refreshTray();
      if (win && !win.isDestroyed()) {
        win.webContents.send('asm:update-state', st);
        win.webContents.send('csm:update-state', st);
      }
    },
    log: m => console.log(m),
  });
  // Retour sur la fenêtre : revérifier les mises à jour si la dernière vérification date de plus d'une heure.
  app.on('browser-window-focus', (e, w) => { if (w === win) updates?.onFocus?.(); });
});
