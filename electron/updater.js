'use strict';
// Mises à jour automatiques (#3).
// Windows : electron-updater (GitHub Releases) — téléchargement en arrière-plan, installation au redémarrage.
// macOS : Squirrel.Mac exige une app signée par Apple → simple vérification + lien vers la release.
const { app, net, shell, Notification } = require('electron');
const pkg = require('../package.json');

// Le dépôt vient de package.json. Il était codé en dur et pointait encore vers
// l'ancien dépôt : l'app annonçait donc la version de l'ancienne application.
const REPO = (() => {
  const pub = pkg.build && pkg.build.publish && pkg.build.publish[0];
  if (pub && pub.owner && pub.repo) return `${pub.owner}/${pub.repo}`;
  const m = String((pkg.repository && (pkg.repository.url || pkg.repository)) || '').match(/github\.com[:/]+([^/]+)\/([^/.]+)/);
  return m ? `${m[1]}/${m[2]}` : '';
})();
const EVERY = 6 * 3600e3;

function newer(a, b) { // a > b ?
  const pa = String(a).replace(/^v/, '').split('.').map(Number), pb = String(b).replace(/^v/, '').split('.').map(Number);
  for (let i = 0; i < 3; i++) if ((pa[i] || 0) !== (pb[i] || 0)) return (pa[i] || 0) > (pb[i] || 0);
  return false;
}

module.exports = function setupUpdater({ enabled, beforeInstall, onState, log }) {
  const state = { status: 'idle', version: null, url: `https://github.com/${REPO}/releases/latest`, error: null };
  const set = patch => { Object.assign(state, patch); onState({ ...state }); };
  if (!app.isPackaged) { set({ status: 'dev' }); return { state, check: async () => { }, install: () => { } }; }
  // Version Microsoft Store : c'est le Store qui installe les mises à jour.
  if (process.windowsStore) { set({ status: 'store' }); return { state, check: async () => { }, install: () => shell.openExternal('ms-windows-store://downloadsandupdates'), onFocus: () => { } }; }

  let updater = null;
  if (process.platform === 'win32') {
    try {
      ({ autoUpdater: updater } = require('electron-updater'));
      updater.autoDownload = true;
      updater.autoInstallOnAppQuit = false; // on installe seulement sur demande (sessions redémarrées proprement)
      updater.logger = { info: m => log(`[maj] ${m}`), warn: m => log(`[maj] ${m}`), error: m => log(`[maj] ${m}`), debug: () => { } };
      updater.on('checking-for-update', () => set({ status: 'checking', error: null }));
      updater.on('update-not-available', () => set({ status: 'uptodate' }));
      updater.on('update-available', i => set({ status: 'downloading', version: i.version }));
      updater.on('download-progress', p => set({ status: 'downloading', progress: Math.round(p.percent) }));
      updater.on('update-downloaded', i => {
        set({ status: 'ready', version: i.version });
        if (Notification.isSupported()) new Notification({ title: 'Sessions Manager', body: `Version ${i.version} prête : redémarre l'application pour l'installer (les sessions reviennent).` }).show();
      });
      updater.on('error', e => set({ status: 'error', error: String(e && e.message || e).slice(0, 300) }));
    } catch (e) { log(`[maj] electron-updater indisponible : ${e.message}`); updater = null; }
  }

  async function checkMac() {
    if (!REPO) { set({ status: 'error', error: 'dépôt introuvable dans package.json' }); return; }
    set({ status: 'checking', error: null });
    try {
      const r = await net.fetch(`https://api.github.com/repos/${REPO}/releases/latest`, { headers: { Accept: 'application/vnd.github+json' } });
      const rel = await r.json();
      if (rel.tag_name && newer(rel.tag_name, app.getVersion())) {
        set({ status: 'available', version: rel.tag_name.replace(/^v/, ''), url: rel.html_url });
        if (Notification.isSupported()) {
          const n = new Notification({ title: 'Sessions Manager', body: `Nouvelle version ${rel.tag_name} disponible — cliquer pour la télécharger.` });
          n.on('click', () => shell.openExternal(rel.html_url)); n.show();
        }
      } else set({ status: 'uptodate' });
    } catch (e) { set({ status: 'error', error: e.message }); }
  }

  async function check() {
    if (!(await enabled())) { set({ status: 'disabled' }); return; }
    if (updater) { try { await updater.checkForUpdates(); } catch (e) { set({ status: 'error', error: e.message }); } }
    else await checkMac();
  }

  async function install() {
    if (updater && state.status === 'ready') {
      await beforeInstall(); // arrêt propre du serveur : il redémarre avec le nouveau code, sessions restaurées
      updater.quitAndInstall(true, true);
    } else shell.openExternal(state.url);
  }

  // au lancement, toutes les 6 h, et au retour sur la fenêtre si la dernière vérification date de plus d'une heure
  let last = 0;
  const run = () => { last = Date.now(); return check(); };
  setTimeout(run, 20e3);
  setInterval(run, EVERY);
  const onFocus = () => { if (Date.now() - last > 3600e3 && state.status !== 'ready' && state.status !== 'downloading') run(); };
  return { state, check: run, install, onFocus };
};
