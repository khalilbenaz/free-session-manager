#!/usr/bin/env node
'use strict';
// asm — AGY Sessions Manager (Windows & macOS)
const fs = require('fs');
const path = require('path');
const os = require('os');
const http = require('http');
const { spawn, execFileSync } = require('child_process');
const { ROOT, PORT, IS_WIN, IS_MAC, DATA, LEGACY_DATA, TASK_NAME, LAUNCHD_LABEL, APP_NAME } = require('../lib/config');

const URL_ = `http://127.0.0.1:${PORT}/`;
const SERVER = path.join(ROOT, 'server.js');
const NODE = process.execPath;
const PKG = require('../package.json');

const HELP = `asm ${PKG.version} — AGY Sessions Manager

  asm              ouvre la fenêtre (démarre le serveur si besoin)
  asm install      démarrage automatique à l'ouverture de session + raccourci
                   (Windows : tâche planifiée + menu Démarrer ; macOS : LaunchAgent + ~/Applications)
  asm uninstall    retire le démarrage automatique et le raccourci (les données sont gardées)
  asm update-agy   recherche et installe la mise à jour d'Antigravity CLI (agy update)
  asm stop         arrête le serveur (les sessions ouvertes reviendront au prochain démarrage)
  asm restart | status | log | where

  Données : ${DATA}
  Variables : ASM_PORT (défaut 7892), ASM_DATA, ASM_AGY (chemin du binaire agy)`;

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

// Commande qui lance le serveur sans fenêtre et hors de l'arbre de processus du terminal.
function serverLaunch() {
  const portArg = PORT === 7892 ? [] : [`--port=${PORT}`];
  if (IS_WIN) return { exe: path.join(process.env.WINDIR || 'C:\\Windows', 'System32', 'conhost.exe'), args: ['--headless', NODE, SERVER, ...portArg] };
  return { exe: NODE, args: [SERVER, ...portArg] };
}

// ---------------------------------------------------------------- démarrage auto : Windows
const winTaskExists = () => IS_WIN && tryRun('schtasks.exe', ['/query', '/tn', TASK_NAME]) !== null;
const START_MENU = IS_WIN ? path.join(process.env.APPDATA || '', 'Microsoft', 'Windows', 'Start Menu', 'Programs', `${APP_NAME}.lnk`) : '';

function winInstall() {
  const l = serverLaunch();
  const argStr = l.args.map(a => (/\s/.test(a) ? `"${a}"` : a)).join(' ');
  const user = `${process.env.USERDOMAIN}\\${process.env.USERNAME}`;
  ps(`$ErrorActionPreference='Stop'
$a = New-ScheduledTaskAction -Execute ${psq(l.exe)} -Argument ${psq(argStr)} -WorkingDirectory ${psq(ROOT)}
$t = New-ScheduledTaskTrigger -AtLogOn -User ${psq(user)}
$s = New-ScheduledTaskSettingsSet -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries -StartWhenAvailable -ExecutionTimeLimit (New-TimeSpan -Days 3650) -RestartCount 5 -RestartInterval (New-TimeSpan -Minutes 1) -MultipleInstances IgnoreNew
$p = New-ScheduledTaskPrincipal -UserId ${psq(user)} -LogonType Interactive -RunLevel Limited
Register-ScheduledTask -TaskName ${psq(TASK_NAME)} -Action $a -Trigger $t -Settings $s -Principal $p -Force | Out-Null`);
  console.log(`✓ tâche planifiée « ${TASK_NAME} » (démarrage à l'ouverture de session)`);

  const conhost = serverLaunch().exe;
  ps(`$sh = (New-Object -ComObject WScript.Shell).CreateShortcut(${psq(START_MENU)})
$sh.TargetPath = ${psq(conhost)}
$sh.Arguments = ${psq(`--headless "${NODE}" "${__filename}" open${PORT === 7892 ? '' : ` --port=${PORT}`}`)}
$sh.WorkingDirectory = ${psq(ROOT)}
$sh.IconLocation = ${psq(path.join(ROOT, 'public', 'icon.ico'))}
$sh.Description = 'AGY Sessions Manager'
$sh.Save()`);
  console.log(`✓ raccourci menu Démarrer « ${APP_NAME} » (épinglable à la barre des tâches)`);
}

function winUninstall() {
  if (winTaskExists()) { run('schtasks.exe', ['/delete', '/tn', TASK_NAME, '/f']); console.log(`✓ tâche planifiée « ${TASK_NAME} » retirée`); }
  try { fs.unlinkSync(START_MENU); console.log('✓ raccourci menu Démarrer retiré'); } catch { }
}

// ---------------------------------------------------------------- démarrage auto : macOS
const GUI = `gui/${process.getuid?.() || 501}`;
const PLIST = path.join(os.homedir(), 'Library', 'LaunchAgents', `${LAUNCHD_LABEL}.plist`);
const APP_DIR = path.join(os.homedir(), 'Applications', `${APP_NAME}.app`);

function macInstall() {
  const xml = s => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  const l = serverLaunch();
  fs.mkdirSync(path.dirname(PLIST), { recursive: true });
  fs.writeFileSync(PLIST, `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
  <key>Label</key><string>${xml(LAUNCHD_LABEL)}</string>
  <key>ProgramArguments</key><array>
    <string>${xml(l.exe)}</string>
    ${l.args.map(a => `<string>${xml(a)}</string>`).join('\n    ')}
  </array>
  <key>WorkingDirectory</key><string>${xml(ROOT)}</string>
  <key>EnvironmentVariables</key><dict>
    <key>PATH</key><string>${xml(process.env.PATH || '/usr/bin:/bin')}</string>
    <key>LANG</key><string>${xml(process.env.LANG || 'fr_FR.UTF-8')}</string>
  </dict>
  <key>RunAtLoad</key><true/>
  <key>KeepAlive</key><dict><key>SuccessfulExit</key><false/></dict>
  <key>ProcessType</key><string>Interactive</string>
  <key>StandardOutPath</key><string>${xml(path.join(DATA, 'launchd.log'))}</string>
  <key>StandardErrorPath</key><string>${xml(path.join(DATA, 'launchd.log'))}</string>
</dict></plist>
`);
  tryRun('launchctl', ['bootout', `${GUI}/${LAUNCHD_LABEL}`]);
  run('launchctl', ['bootstrap', GUI, PLIST]);
  console.log(`✓ LaunchAgent ${LAUNCHD_LABEL} (démarrage à l'ouverture de session)`);

  // Petite application lanceur dans ~/Applications (Spotlight, Launchpad, Dock).
  const contents = path.join(APP_DIR, 'Contents');
  fs.rmSync(APP_DIR, { recursive: true, force: true });
  fs.mkdirSync(path.join(contents, 'MacOS'), { recursive: true });
  fs.mkdirSync(path.join(contents, 'Resources'), { recursive: true });
  const exe = path.join(contents, 'MacOS', 'asm');
  fs.writeFileSync(exe, `#!/bin/sh\nexport PATH=${JSON.stringify(process.env.PATH || '/usr/bin:/bin')}\nexec ${JSON.stringify(NODE)} ${JSON.stringify(__filename)} open${PORT === 7892 ? '' : ` --port=${PORT}`}\n`);
  fs.chmodSync(exe, 0o755);
  const hasIcon = macIcon(path.join(contents, 'Resources', 'icon.icns'));
  fs.writeFileSync(path.join(contents, 'Info.plist'), `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
  <key>CFBundleName</key><string>${xml(APP_NAME)}</string>
  <key>CFBundleDisplayName</key><string>${xml(APP_NAME)}</string>
  <key>CFBundleIdentifier</key><string>${LAUNCHD_LABEL}.launcher</string>
  <key>CFBundleExecutable</key><string>asm</string>
  <key>CFBundlePackageType</key><string>APPL</string>
  <key>CFBundleShortVersionString</key><string>${PKG.version}</string>
  ${hasIcon ? '<key>CFBundleIconFile</key><string>icon</string>' : ''}
  <key>LSUIElement</key><true/>
</dict></plist>
`);
  console.log(`✓ application « ${APP_NAME} » dans ~/Applications (Spotlight / Dock)`);
}

// .icns depuis public/icon.png via sips + iconutil (outils macOS standards). Facultatif.
function macIcon(dest) {
  const src = path.join(ROOT, 'public', 'icon.png');
  const set = path.join(os.tmpdir(), `asm-${process.pid}.iconset`);
  try {
    fs.mkdirSync(set, { recursive: true });
    for (const s of [16, 32, 128, 256]) {
      run('sips', ['-z', String(s), String(s), src, '--out', path.join(set, `icon_${s}x${s}.png`)]);
      run('sips', ['-z', String(s * 2), String(s * 2), src, '--out', path.join(set, `icon_${s}x${s}@2x.png`)]);
    }
    run('iconutil', ['-c', 'icns', set, '-o', dest]);
    return true;
  } catch { return false; } finally { fs.rmSync(set, { recursive: true, force: true }); }
}

function macUninstall() {
  tryRun('launchctl', ['bootout', `${GUI}/${LAUNCHD_LABEL}`]);
  try { fs.unlinkSync(PLIST); } catch { }
  fs.rmSync(APP_DIR, { recursive: true, force: true });
  console.log('✓ LaunchAgent et application retirés');
}
const macAgentLoaded = () => IS_MAC && tryRun('launchctl', ['print', `${GUI}/${LAUNCHD_LABEL}`]) !== null;

// ---------------------------------------------------------------- serveur
async function start() {
  if (await isUp()) return;
  fs.mkdirSync(DATA, { recursive: true });
  if (winTaskExists()) run('schtasks.exe', ['/run', '/tn', TASK_NAME]);
  else if (macAgentLoaded()) run('launchctl', ['kickstart', `${GUI}/${LAUNCHD_LABEL}`]);
  else {
    const portArg = PORT === 7892 ? [] : [`--port=${PORT}`];
    spawn(NODE, [SERVER, ...portArg], { cwd: ROOT, detached: true, stdio: 'ignore', windowsHide: true }).unref();
  }
  if (!(await waitUp())) throw new Error(`le serveur n'a pas démarré — voir : asm log`);
}

const PID_FILES = [path.join(DATA, 'server.pid'), ...(PORT === 7892 ? [path.join(LEGACY_DATA, 'server.pid')] : [])];

async function stop() {
  const pids = PID_FILES
    .map(f => { try { return Number(fs.readFileSync(f, 'utf8')); } catch { return 0; } }).filter(Boolean);
  let stopped = false;
  for (const pid of new Set(pids)) {
    try { process.kill(pid, IS_WIN ? undefined : 'SIGTERM'); stopped = true; } catch { }
  }
  for (let i = 0; i < 40 && (await isUp()); i++) await sleep(150);
  for (const f of PID_FILES) try { fs.unlinkSync(f); } catch { }
  console.log(stopped ? 'serveur arrêté' : 'serveur non démarré');
}

function openWindow() {
  const appArgs = [`--app=${URL_}`, '--window-size=1400,900'];
  if (IS_WIN) {
    const pf = [process.env['ProgramFiles(x86)'], process.env.ProgramFiles, process.env.LOCALAPPDATA].filter(Boolean);
    const browsers = [['Microsoft', 'Edge', 'Application', 'msedge.exe'], ['Google', 'Chrome', 'Application', 'chrome.exe'], ['BraveSoftware', 'Brave-Browser', 'Application', 'brave.exe']];
    for (const b of browsers) for (const base of pf) {
      const exe = path.join(base, ...b);
      if (exists(exe)) { spawn(exe, appArgs, { detached: true, stdio: 'ignore' }).unref(); return; }
    }
    spawn('cmd.exe', ['/c', 'start', '', URL_], { detached: true, stdio: 'ignore', windowsHide: true }).unref();
  } else if (IS_MAC) {
    if (exists('/Applications/AGY Sessions.app')) {
      spawn('open', ['-a', '/Applications/AGY Sessions.app'], { detached: true, stdio: 'ignore' }).unref(); return;
    }
    for (const app of ['Google Chrome', 'Microsoft Edge', 'Brave Browser', 'Chromium', 'Vivaldi']) {
      if (exists(`/Applications/${app}.app`) || exists(path.join(os.homedir(), 'Applications', `${app}.app`))) {
        spawn('open', ['-na', app, '--args', ...appArgs], { detached: true, stdio: 'ignore' }).unref(); return;
      }
    }
    spawn('open', [URL_], { detached: true, stdio: 'ignore' }).unref();
  } else {
    spawn('xdg-open', [URL_], { detached: true, stdio: 'ignore' }).unref();
  }
}

// ---------------------------------------------------------------- commandes
const COMMANDS = {
  async open() { await start(); openWindow(); },
  async start() { await start(); console.log(`serveur prêt : ${URL_}`); },
  stop,
  async restart() { await stop(); await sleep(400); await start(); console.log(`serveur prêt : ${URL_}`); },
  async status() { console.log((await isUp()) ? `en ligne : ${URL_}` : 'arrêté'); },
  log() {
    try { console.log(fs.readFileSync(path.join(DATA, 'server.log'), 'utf8').split('\n').slice(-60).join('\n')); }
    catch { console.log('(aucun journal)'); }
  },
  where() { console.log(`code    : ${ROOT}\ndonnées : ${DATA}\nnode    : ${NODE}`); },
  async install() {
    try {
      const { getAgyVersion, installAgy } = require('../lib/agy-cli');
      const curAgy = await getAgyVersion();
      if (!curAgy) {
        console.log('Antigravity CLI (agy) non détecté : installation automatique en cours...');
        try { await installAgy(console.log); }
        catch (e) { console.warn(`Avertissement agy : ${e.message}`); }
      } else {
        console.log(`✓ Antigravity CLI détecté (v${curAgy})`);
      }
    } catch { }
    if (IS_WIN) winInstall(); else if (IS_MAC) macInstall();
    else throw new Error('démarrage automatique : Windows et macOS seulement (utiliser « asm start »)');
    await start();
    console.log(`\nserveur prêt : ${URL_}\nOuvrir : « ${APP_NAME} » ${IS_WIN ? 'dans le menu Démarrer' : 'dans Spotlight / Applications'}, ou « asm ».`);
  },
  async 'update-agy'() {
    const { updateAgy } = require('../lib/agy-cli');
    await updateAgy(console.log);
  },
  uninstall() { if (IS_WIN) winUninstall(); else if (IS_MAC) macUninstall(); },
  help() { console.log(HELP); },
  version() { console.log(PKG.version); },
};
COMMANDS['--help'] = COMMANDS['-h'] = COMMANDS.help;
COMMANDS['--version'] = COMMANDS['-v'] = COMMANDS.version;

const cmd = process.argv.slice(2).find(a => !a.startsWith('--port=')) || 'open';
const fn = COMMANDS[cmd];
if (!fn) { console.error(`commande inconnue : ${cmd}\n\n${HELP}`); process.exit(2); }
Promise.resolve(fn()).catch(e => { console.error(`asm : ${e.message}`); process.exit(1); });
