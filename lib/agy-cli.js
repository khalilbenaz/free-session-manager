'use strict';
// Gestion de l'installation et des mises à jour automatiques d'Antigravity CLI (agy).
const fs = require('fs');
const os = require('os');
const path = require('path');
const { exec, execFile, spawn } = require('child_process');
const { resolveAgy, IS_WIN } = require('./config');

function getAgyPath() {
  const p = resolveAgy();
  try {
    if (fs.existsSync(p) && fs.statSync(p).isFile()) return p;
  } catch { }
  return p === 'agy' ? null : p;
}

function getAgyVersion() {
  const agy = getAgyPath() || 'agy';
  return new Promise(resolve => {
    execFile(agy, ['--version'], { timeout: 10000, encoding: 'utf8' }, (err, stdout) => {
      if (err) return resolve(null);
      const m = (stdout || '').trim().match(/\b\d+\.\d+\.\d+\b/);
      resolve(m ? m[0] : (stdout || '').trim() || null);
    });
  });
}

function installAgy(logger = console.log) {
  return new Promise((resolve, reject) => {
    logger('[agy-cli] Démarrage de l\'installation d\'Antigravity CLI...');
    const cmd = IS_WIN
      ? 'powershell -NoProfile -ExecutionPolicy Bypass -Command "iwr -useb https://antigravity.google/cli/install.ps1 | iex"'
      : 'curl -fsSL https://antigravity.google/cli/install.sh | bash';

    const child = exec(cmd, {
      env: {
        ...process.env,
        PATH: `${path.join(os.homedir(), '.local', 'bin')}:${process.env.PATH || '/usr/local/bin:/usr/bin:/bin'}`
      },
      timeout: 300000 // 5 minutes
    });

    let output = '';
    child.stdout?.on('data', d => { output += d; logger(`[agy-install] ${d.toString().trim()}`); });
    child.stderr?.on('data', d => { output += d; logger(`[agy-install:err] ${d.toString().trim()}`); });

    child.on('close', code => {
      if (code === 0) {
        logger('[agy-cli] ✓ Antigravity CLI installé avec succès.');
        resolve({ ok: true, output });
      } else {
        logger(`[agy-cli] ✕ Échec de l'installation (code ${code})`);
        reject(new Error(`Installation de agy échouée avec le code ${code} : ${output.slice(-300)}`));
      }
    });

    child.on('error', err => reject(err));
  });
}

function updateAgy(logger = console.log) {
  return new Promise(async (resolve, reject) => {
    const agy = getAgyPath();
    if (!agy) {
      logger('[agy-cli] Antigravity CLI non détecté. Lancement de l\'installation initiale...');
      try {
        const res = await installAgy(logger);
        return resolve(res);
      } catch (e) {
        return reject(e);
      }
    }

    logger(`[agy-cli] Recherche de mise à jour d'Antigravity CLI (${agy} update)...`);
    execFile(agy, ['update'], {
      timeout: 180000,
      env: {
        ...process.env,
        PATH: `${path.join(os.homedir(), '.local', 'bin')}:${process.env.PATH || '/usr/local/bin:/usr/bin:/bin'}`
      }
    }, (err, stdout, stderr) => {
      const out = (stdout || '') + (stderr || '');
      if (err) {
        logger(`[agy-cli] Note lors de agy update : ${err.message}`);
        // Si agy update échoue (ex: version spécifique), on tente de relancer le bootstrapper officiel
        installAgy(logger).then(resolve).catch(reject);
        return;
      }
      logger(`[agy-cli] Résultat mise à jour agy : ${out.trim()}`);
      resolve({ ok: true, output: out.trim() });
    });
  });
}

// Module serveur : enregistre les routes API et lance la tâche d'auto-update
module.exports = function registerAgyCli(ctx) {
  const { route, json, on } = ctx;
  const log = ctx.log || (m => console.log(m));

  route('GET', '/api/agy/status', async ({ res }) => {
    const path_ = getAgyPath();
    const version = await getAgyVersion();
    json(res, 200, {
      installed: !!version,
      path: path_ || 'introuvable',
      version: version || 'non installé'
    });
  });

  route('POST', '/api/agy/install', async ({ res }) => {
    try {
      const result = await installAgy(log);
      const version = await getAgyVersion();
      json(res, 200, { ok: true, version, output: result.output });
    } catch (e) {
      json(res, 500, { error: e.message });
    }
  });

  route('POST', '/api/agy/update', async ({ res }) => {
    try {
      const result = await updateAgy(log);
      const version = await getAgyVersion();
      json(res, 200, { ok: true, version, output: result.output });
    } catch (e) {
      json(res, 500, { error: e.message });
    }
  });

  // Tâche de fond automatique :
  // 1. Au démarrage, vérifie et met à jour agy
  // 2. Toutes les 6 heures, relance la mise à jour automatique en arrière-plan
  setTimeout(async () => {
    try {
      const version = await getAgyVersion();
      if (!version) {
        log('[agy-auto-update] Antigravity CLI absent au démarrage, installation automatique...');
        await installAgy(log);
      } else {
        log(`[agy-auto-update] Antigravity CLI détecté (v${version}). Vérification des mises à jour...`);
        await updateAgy(log);
      }
    } catch (e) {
      log(`[agy-auto-update] Erreur vérification agy : ${e.message}`);
    }
  }, 3000);

  const EVERY_6_HOURS = 6 * 3600 * 1000;
  setInterval(async () => {
    try {
      log('[agy-auto-update] Cycle périodique de mise à jour agy...');
      await updateAgy(log);
    } catch (e) {
      log(`[agy-auto-update] Échec cycle périodique agy : ${e.message}`);
    }
  }, EVERY_6_HOURS);
};

module.exports.getAgyPath = getAgyPath;
module.exports.getAgyVersion = getAgyVersion;
module.exports.installAgy = installAgy;
module.exports.updateAgy = updateAgy;
