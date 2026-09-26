#!/usr/bin/env node
'use strict';
// sm — Sessions Manager (Claude Code & Antigravity CLI)
const fs = require('fs');
const path = require('path');
const os = require('os');
const http = require('http');
const { spawn, execFileSync } = require('child_process');
const { ROOT, PORT, IS_WIN, IS_MAC, DATA, TASK_NAME, LAUNCHD_LABEL, APP_NAME, resolveClaude, resolveAgy, hasClaude, hasAgy } = require('../lib/config');

const URL_ = `http://127.0.0.1:${PORT}/`;
const SERVER = path.join(ROOT, 'server.js');
const NODE = process.execPath;
const PKG = require('../package.json');

const HELP = `sm ${PKG.version} — Sessions Manager (Claude Code & Antigravity)

  sm                ouvre la fenêtre (démarre le serveur si besoin)
  sm install        démarrage automatique à l'ouverture de session + raccourci
                    (Windows : tâche planifiée ; macOS : LaunchAgent + ~/Applications)
  sm uninstall      retire le démarrage automatique et le raccourci
  sm update-agy     recherche et installe la mise à jour d'Antigravity CLI (agy update)
  sm install-claude installe Claude Code CLI globalement via npm
  sm stop           arrête le serveur (les sessions reviendront au prochain lancement)
  sm restart | status | log | where

  Données : ${DATA}
  Port : ${PORT} (variable SM_PORT)
  Agents :
    - Claude Code : ${hasClaude() ? 'installé (' + resolveClaude() + ')' : 'non détecté'}
    - Antigravity : ${hasAgy() ? 'installé (' + resolveAgy() + ')' : 'non détecté'}`;

// ---------------------------------------------------------------- utilitaires
const sleep = ms => new Promise(r => setTimeout(r, ms));
function isUp() {
  return new Promise(resolve => {
    const req = http.get(URL_, { timeout: 800 }, res => { res.resume(); resolve(res.statusCode === 200); });
    req.on('error', () => resolve(false));
    req.on('timeout', () => { req.destroy(); resolve(false); });
  });
}
async function waitUp(ms = 10000) {
  for (const end = Date.now() + ms; Date.now() < end; await sleep(250)) if (await isUp()) return true;
  return false;
}
function run(cmd, args, opts = {}) {
  return execFileSync(cmd, args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true, ...opts });
}
function tryRun(cmd, args, opts) { try { return run(cmd, args, opts); } catch { return null; } }
function ps(script) { return run('powershell.exe', ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-Command', script]); }
const psq = s => `'${String(s).replace(/'/g, "''")}'`;
const exists = p => { try { fs.accessSync(p); return true; } catch { return false; } };

function serverLaunch() {
  const portArg = PORT === 7895 ? [] : [`--port=${PORT}`];
  if (IS_WIN) return { exe: path.join(process.env.WINDIR || 'C:\\Windows', 'System32', 'conhost.exe'), args: ['--headless', NODE, SERVER, ...portArg] };
  return { exe: NODE, args: [SERVER, ...portArg] };
}

// ---------------------------------------------------------------- Windows
const winTaskExists = () => IS_WIN && tryRun('schtasks.exe', ['/query', '/tn', TASK_NAME]) !== null;
const START_MENU = IS_WIN ? path.join(process.env.APPDATA || '', 'Microsoft', 'Windows', 'Start Menu', 'Programs', `${APP_NAME}.lnk`) : '';

function installWin() {
  const { exe, args } = serverLaunch();
  const tr = `"${exe}" ${args.map(a => `"${a}"`).join(' ')}`;
  run('schtasks.exe', ['/create', '/f', '/tn', TASK_NAME, '/sc', 'onlogon', '/tr', tr, '/rl', 'limited']);
  if (!tryRun('schtasks.exe', ['/run', '/tn', TASK_NAME])) {
    const s = spawn(exe, args, { detached: true, stdio: 'ignore', windowsHide: true }); s.unref();
  }
  const ico = path.join(ROOT, 'public', 'icon.ico');
  const shortcutScript = `$ws = New-Object -ComObject WScript.Shell; $s = $ws.CreateShortcut(${psq(START_MENU)}); $s.TargetPath = ${psq(NODE)}; $s.Arguments = ${psq(path.join(ROOT, 'bin', 'sm.js'))}; $s.WorkingDirectory = ${psq(ROOT)}; $s.Description = 'Sessions Manager — Claude Code & Antigravity'; if (Test-Path ${psq(ico)}) { $s.IconLocation = ${psq(ico)}; }; $s.Save()`;
  try { ps(shortcutScript); } catch { }
}

function uninstallWin() {
  tryRun('schtasks.exe', ['/delete', '/f', '/tn', TASK_NAME]);
  try { if (START_MENU && exists(START_MENU)) fs.unlinkSync(START_MENU); } catch { }
}

// ---------------------------------------------------------------- macOS
const PLIST_DIR = path.join(os.homedir(), 'Library', 'LaunchAgents');
const PLIST_FILE = path.join(PLIST_DIR, `${LAUNCHD_LABEL}.plist`);
const MAC_APP_DIR = path.join(os.homedir(), 'Applications');
const MAC_APP = path.join(MAC_APP_DIR, `${APP_NAME}.app`);

function plistContent() {
  const { exe, args } = serverLaunch();
  const fullArgs = [exe, ...args].map(a => `    <string>${a}</string>`).join('\n');
  // Le dossier de node passe en tête : avec un gestionnaire de versions (fnm/nvm),
  // le `claude` de ~/.local/bin ou /opt/homebrew peut être une version périmée.
  const home = os.homedir();
  const dirs = [path.dirname(exe), path.join(home, '.local', 'bin'), '/opt/homebrew/bin',
    '/usr/local/bin', '/usr/bin', '/bin', '/usr/sbin', '/sbin'];
  const envPath = [...new Set(dirs)].join(':');
  return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key><string>${LAUNCHD_LABEL}</string>
  <key>ProgramArguments</key>
  <array>
${fullArgs}
  </array>
  <key>RunAtLoad</key><true/>
  <key>KeepAlive</key><true/>
  <key>StandardOutPath</key><string>${path.join(DATA, 'launchd.log')}</string>
  <key>StandardErrorPath</key><string>${path.join(DATA, 'launchd.log')}</string>
  <key>WorkingDirectory</key><string>${ROOT}</string>
  <key>EnvironmentVariables</key>
  <dict>
    <key>PATH</key><string>${envPath}</string>
  </dict>
</dict>
</plist>\n`;
}

function macLaunchdLoaded() {
  const out = tryRun('launchctl', ['list']);
  return !!out && out.includes(LAUNCHD_LABEL);
}

function installMac() {
  fs.mkdirSync(PLIST_DIR, { recursive: true });
  fs.writeFileSync(PLIST_FILE, plistContent());
  tryRun('launchctl', ['unload', PLIST_FILE]);
  run('launchctl', ['load', PLIST_FILE]);

  try {
    fs.mkdirSync(path.join(MAC_APP, 'Contents', 'MacOS'), { recursive: true });
    const sh = `#!/bin/sh\nexec "${NODE}" "${path.join(ROOT, 'bin', 'sm.js')}" "$@"\n`;
    const binFile = path.join(MAC_APP, 'Contents', 'MacOS', 'app');
    fs.writeFileSync(binFile, sh);
    fs.chmodSync(binFile, 0o755);
  } catch { }
}

function uninstallMac() {
  tryRun('launchctl', ['unload', PLIST_FILE]);
  try { if (exists(PLIST_FILE)) fs.unlinkSync(PLIST_FILE); } catch { }
  try { if (exists(MAC_APP)) fs.rmSync(MAC_APP, { recursive: true, force: true }); } catch { }
}

// ---------------------------------------------------------------- commandes
async function stopServer() {
  const pidFile = path.join(DATA, 'server.pid');
  let stopped = false;
  if (exists(pidFile)) {
    try {
      const pid = Number(fs.readFileSync(pidFile, 'utf8').trim());
      if (pid && !isNaN(pid)) {
        process.kill(pid, 'SIGTERM');
        for (let i = 0; i < 20; i++) {
          await sleep(150);
          try { process.kill(pid, 0); } catch { stopped = true; break; }
        }
      }
    } catch { }
  }
  return stopped;
}

async function startServer() {
  if (await isUp()) return true;
  if (IS_MAC && exists(PLIST_FILE) && !macLaunchdLoaded()) tryRun('launchctl', ['load', PLIST_FILE]);
  if (IS_WIN && winTaskExists()) tryRun('schtasks.exe', ['/run', '/tn', TASK_NAME]);
  if (await waitUp(1500)) return true;

  const { exe, args } = serverLaunch();
  const sub = spawn(exe, args, { detached: true, stdio: 'ignore', windowsHide: true });
  sub.unref();
  return waitUp(8000);
}

function openBrowser() {
  if (IS_WIN) spawn('cmd.exe', ['/c', 'start', '', URL_], { detached: true, stdio: 'ignore' }).unref();
  else if (IS_MAC) spawn('open', [URL_], { detached: true, stdio: 'ignore' }).unref();
  else spawn('xdg-open', [URL_], { detached: true, stdio: 'ignore' }).unref();
}

async function main() {
  const cmd = process.argv[2] || '';
  if (cmd === '-h' || cmd === '--help' || cmd === 'help') { console.log(HELP); return; }

  if (cmd === 'install') {
    fs.mkdirSync(DATA, { recursive: true });
    if (IS_WIN) installWin(); else if (IS_MAC) installMac();
    console.log(`✓ Sessions Manager installé pour démarrage automatique`);
    return;
  }
  if (cmd === 'uninstall') {
    await stopServer();
    if (IS_WIN) uninstallWin(); else if (IS_MAC) uninstallMac();
    console.log(`✓ Démarrage automatique retiré`);
    return;
  }
  if (cmd === 'stop') {
    const ok = await stopServer();
    console.log(ok ? 'serveur arrêté' : 'aucun serveur en cours');
    return;
  }
  if (cmd === 'restart') {
    await stopServer();
    const up = await startServer();
    console.log(up ? `serveur prêt : ${URL_}` : `échec du démarrage`);
    return;
  }
  if (cmd === 'status') {
    const up = await isUp();
    console.log(`Sessions Manager : ${up ? 'en ligne' : 'hors ligne'} (${URL_})`);
    console.log(`  Claude Code   : ${hasClaude() ? '✓ ' + resolveClaude() : '✗ non détecté'}`);
    console.log(`  Antigravity   : ${hasAgy() ? '✓ ' + resolveAgy() : '✗ non détecté'}`);
    return;
  }
  if (cmd === 'update-agy') {
    const { updateAgy } = require('../lib/agents');
    console.log("Recherche de mise à jour pour Antigravity CLI...");
    try {
      const res = await updateAgy(console.log);
      console.log("✓ Mise à jour terminée.");
    } catch (e) {
      console.error("✕ Erreur :", e.message);
    }
    return;
  }
  if (cmd === 'install-claude') {
    const { installClaude } = require('../lib/agents');
    console.log("Installation de Claude Code via npm...");
    try {
      await installClaude(console.log);
      console.log("✓ Claude Code installé avec succès.");
    } catch (e) {
      console.error("✕ Erreur :", e.message);
    }
    return;
  }
  if (cmd === 'log') {
    const logFile = path.join(DATA, 'server.log');
    if (exists(logFile)) console.log(fs.readFileSync(logFile, 'utf8').slice(-4000));
    else console.log('aucun journal');
    return;
  }

  // Action par défaut : ouvrir
  const ready = await startServer();
  if (ready) openBrowser();
  else console.error(`Impossible de joindre le serveur (${URL_}).`);
}

main().catch(err => { console.error(err); process.exit(1); });
