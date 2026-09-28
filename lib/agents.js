'use strict';
// Gestion de la détection, version et installation des deux agents : Claude Code et Antigravity CLI.
const fs = require('fs');
const os = require('os');
const path = require('path');
const { exec, execFile } = require('child_process');
const { resolveKilo, resolveOpencode, hasOpencode, resolveClaude, resolveAgy, IS_WIN } = require('./config');

function getKiloPath() {
  const p = resolveKilo();
  try { if (fs.existsSync(p) && fs.statSync(p).isFile()) return p; } catch { }
  return p === 'kilo' ? null : p;
}

function getKiloVersion() {
  const kilo = getKiloPath() || 'kilo';
  return new Promise(resolve => {
    execFile(kilo, ['--version'], { timeout: 10000, encoding: 'utf8' }, (err, stdout) => {
      if (err) return resolve(null);
      const m = (stdout || '').trim().match(/\b\d+\.\d+\.\d+\b/);
      resolve(m ? m[0] : (stdout || '').trim() || null);
    });
  });
}

function getOpencodePath() {
  const p = resolveOpencode();
  try { if (fs.existsSync(p) && fs.statSync(p).isFile()) return p; } catch { }
  return p === 'opencode' ? null : p;
}

function getOpencodeVersion() {
  const opencode = getOpencodePath() || 'opencode';
  return new Promise(resolve => {
    execFile(opencode, ['--version'], { timeout: 10000, encoding: 'utf8' }, (err, stdout) => {
      if (err) return resolve(null);
      const m = (stdout || '').trim().match(/\b\d+\.\d+\.\d+\b/);
      resolve(m ? m[0] : (stdout || '').trim() || null);
    });
  });
}

function getClaudePath() {
  const p = resolveClaude();
  try { if (fs.existsSync(p) && fs.statSync(p).isFile()) return p; } catch { }
  return p === 'claude' ? null : p;
}

function getClaudeVersion() {
  const claude = getClaudePath() || 'claude';
  return new Promise(resolve => {
    execFile(claude, ['--version'], { timeout: 10000, encoding: 'utf8' }, (err, stdout) => {
      if (err) return resolve(null);
      const m = (stdout || '').trim().match(/\b\d+\.\d+\.\d+\b/);
      resolve(m ? m[0] : (stdout || '').trim() || null);
    });
  });
}

function installClaude(logger = console.log) {
  return new Promise((resolve, reject) => {
    logger('[claude-cli] Installation de Claude Code via npm...');
    const cmd = 'npm install -g @anthropic-ai/claude-code';
    exec(cmd, { timeout: 180000 }, (err, stdout, stderr) => {
      const out = (stdout || '') + (stderr || '');
      if (err) {
        logger(`[claude-cli] ✕ Échec : ${err.message}`);
        return reject(new Error(`Échec de l'installation de claude : ${out}`));
      }
      logger('[claude-cli] ✓ Claude Code installé avec succès.');
      resolve({ ok: true, output: out });
    });
  });
}

function getAgyPath() {
  const p = resolveAgy();
  try { if (fs.existsSync(p) && fs.statSync(p).isFile()) return p; } catch { }
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
      timeout: 300000
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

/** Lance seulement `agy update` : aucune installation de secours (réservée à la demande explicite). */
function updateAgyOnly(logger = console.log) {
  return new Promise((resolve, reject) => {
    const agy = getAgyPath();
    if (!agy) return reject(new Error('agy non détecté'));
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
        return reject(err);
      }
      logger(`[agy-cli] Résultat mise à jour agy : ${out.trim()}`);
      resolve({ ok: true, output: out.trim() });
    });
  });
}

function updateAgy(logger = console.log) {
  const agy = getAgyPath();
  if (!agy) {
    logger('[agy-cli] Antigravity CLI non détecté. Lancement de l\'installation...');
    return installAgy(logger);
  }
  return updateAgyOnly(logger).catch(err => installAgy(logger).catch(() => { throw err; }));
}

let agyQuotaCache = { data: null, timestamp: 0 };

function getAgyQuota(force = false) {
  const now = Date.now();
  if (!force && agyQuotaCache.data && (now - agyQuotaCache.timestamp < 60000)) {
    return Promise.resolve(agyQuotaCache.data);
  }

  const agy = getAgyPath() || 'agy';
  return new Promise(resolve => {
    execFile(agy, ['-p', '/usage'], {
      timeout: 15000,
      encoding: 'utf8',
      env: {
        ...process.env,
        PATH: `${path.join(os.homedir(), '.local', 'bin')}:${process.env.PATH || '/usr/local/bin:/usr/bin:/bin'}`
      }
    }, (err, stdout) => {
      if (err) {
        return resolve(agyQuotaCache.data || { ok: false, error: err.message, quotas: [] });
      }

      const lines = (stdout || '').split('\n').map(l => l.trim()).filter(Boolean);
      const quotas = [];
      for (const line of lines) {
        const parts = line.split(/\t+/);
        if (parts.length >= 4) {
          const category = parts[0].trim();
          const limitName = parts[1].trim();
          const pctMatch = parts[2].match(/(\d+)%/);
          const remainingPercent = pctMatch ? parseInt(pctMatch[1], 10) : null;
          const resetIso = parts[3].trim();
          const resetTime = Date.parse(resetIso);
          quotas.push({
            category,
            limitName,
            remainingPercent,
            usedPercent: remainingPercent != null ? 100 - remainingPercent : null,
            resetIso,
            resetTime: isNaN(resetTime) ? null : resetTime
          });
        }
      }

      const result = {
        ok: true,
        updatedAt: now,
        raw: stdout.trim(),
        quotas
      };
      agyQuotaCache = { data: result, timestamp: now };
      resolve(result);
    });
  });
}

// Quota Claude Code : `claude -p /usage` renvoie un rapport texte.
// Exemple : « Current session: 1% used · resets Sep 26 at 4:29am (Africa/Casablanca) »
let claudeQuotaCache = { data: null, timestamp: 0 };

const MONTHS = { jan: 0, feb: 1, mar: 2, apr: 3, may: 4, jun: 5, jul: 6, aug: 7, sep: 8, oct: 9, nov: 10, dec: 11 };

/** « Sep 26 at 4:29am » → epoch, en déduisant l'année la plus proche. */
function parseReset(str) {
  if (!str) return null;
  const m = String(str).match(/([A-Za-z]{3,})\w*\s+(\d{1,2})\s+at\s+(\d{1,2})(?::(\d{2}))?\s*(am|pm)?/i);
  if (!m || MONTHS[m[1].slice(0, 3).toLowerCase()] === undefined) return null;
  let h = +m[3];
  const min = +(m[4] || 0);
  if (m[5] && /pm/i.test(m[5]) && h < 12) h += 12;
  if (m[5] && /am/i.test(m[5]) && h === 12) h = 0;
  const now = new Date();
  const d = new Date(now.getFullYear(), MONTHS[m[1].slice(0, 3).toLowerCase()], +m[2], h, min, 0, 0);
  if (d.getTime() < now.getTime() - 86400e3) d.setFullYear(d.getFullYear() + 1);
  return d.getTime();
}

function getClaudeQuota(force = false) {
  const now = Date.now();
  if (!force && claudeQuotaCache.data && (now - claudeQuotaCache.timestamp < 60000)) {
    return Promise.resolve(claudeQuotaCache.data);
  }
  const claude = getClaudePath() || 'claude';
  return new Promise(resolve => {
    execFile(claude, ['-p', '/usage'], {
      timeout: 60000,
      encoding: 'utf8',
      maxBuffer: 4 * 1024 * 1024,
      cwd: os.homedir()
    }, (err, stdout, stderr) => {
      const out = String(stdout || '');
      if (err && !out) {
        // Un CLI trop ancien ne connaît pas /usage : message clair plutôt qu'une erreur brute.
        const msg = /Unknown skill|Unknown command|not a|no such/i.test(String(stderr || ''))
          ? `installed CLI does not support /usage`
          : err.message;
        return resolve(claudeQuotaCache.data || { ok: false, error: msg, quotas: [] });
      }
      const quotas = [];
      for (const raw of out.split('\n')) {
        const line = raw.trim();
        const m = line.match(/^(.+?):\s*(\d+(?:[.,]\d+)?)%\s*used(?:\s*[·•]\s*resets\s+(.+?))?$/i);
        if (!m) continue;
        const usedPercent = parseFloat(m[2].replace(',', '.'));
        if (!isFinite(usedPercent)) continue;
        const resetTime = parseReset(m[3]);
        quotas.push({
          category: 'Claude Code',
          limitName: m[1].trim(),
          usedPercent,
          remainingPercent: Math.max(0, Math.round((100 - usedPercent) * 10) / 10),
          resetIso: resetTime ? new Date(resetTime).toISOString() : null,
          resetTime
        });
      }
      const result = { ok: quotas.length > 0, updatedAt: now, raw: out.trim(), quotas };
      claudeQuotaCache = { data: result, timestamp: now };
      resolve(result);
    });
  });
}

// Liste réelle des modèles Antigravity : `agy models` (aucun quota consommé).
// Sans cela l'interface afficherait une liste figée, vite périmée.
let agyModelsCache = { data: null, timestamp: 0 };

function getAgyModels(force = false) {
  const now = Date.now();
  if (!force && agyModelsCache.data && (now - agyModelsCache.timestamp < 6 * 3600e3)) {
    return Promise.resolve(agyModelsCache.data);
  }
  const agy = getAgyPath() || 'agy';
  return new Promise(resolve => {
    execFile(agy, ['models'], {
      timeout: 20000,
      encoding: 'utf8',
      env: {
        ...process.env,
        PATH: `${path.join(os.homedir(), '.local', 'bin')}:${process.env.PATH || '/usr/local/bin:/usr/bin:/bin'}`
      }
    }, (err, stdout) => {
      if (err) return resolve(agyModelsCache.data || { ok: false, error: err.message, models: [] });
      const models = [];
      for (const line of String(stdout || '').split('\n')) {
        const t = line.trim();
        if (!t || /^Fetching/i.test(t)) continue;
        const m = t.match(/^([\w.-]+)\s*(.*)$/);
        if (m && /^(gemini|claude|gpt|o[0-9]|qwen|deepseek)/i.test(m[1])) {
          models.push({ value: m[1], label: m[2].trim() || m[1] });
        }
      }
      const result = { ok: true, updatedAt: now, models };
      agyModelsCache = { data: result, timestamp: now };
      resolve(result);
    });
  });
}

// Module serveur : enregistre les routes API pour les 2 agents
module.exports = function registerAgents(ctx) {
  const { route, json } = ctx;
  const log = ctx.log || (m => console.log(m));

  route('GET', '/api/agents/status', async ({ res }) => {
    const [kiloVersion, opencodeVersion] = await Promise.all([
      getKiloVersion(),
      getOpencodeVersion()
    ]);
    // Kilo et OpenCode sont désormais des fournisseurs natifs (bin/direct-agent.js) :
    // aucun binaire CLI tiers n'est requis pour fonctionner, donc `installed` reste
    // vrai même si le binaire local (utilisé seulement pour --version ci-dessus, ou
    // pour le moteur OpenCode local en repli) est introuvable.
    const opencodeStatus = process.env.OPENCODE_API_KEY
      ? 'Natif (Zen)'
      : (hasOpencode() ? 'Natif (moteur OpenCode local)' : 'Natif (repli Kilo Gateway)');
    json(res, 200, {
      kilo: {
        installed: true,
        path: getKiloPath() || 'Kilo Gateway (natif)',
        version: kiloVersion,
        status: 'Natif (Kilo Gateway)',
      },
      opencode: {
        installed: true,
        path: getOpencodePath() || 'opencode (moteur local optionnel)',
        version: opencodeVersion,
        status: opencodeStatus,
      },
      openrouter: {
        installed: true,
        status: 'Actif (clé OpenRouter)',
      }
    });
  });

  const kiloModelsHandler = async ({ res }) => {
    json(res, 200, { ok: true, models: [
      { value: 'kilo/nvidia/nemotron-3-super-120b-a12b:free', label: '⚡ Nemotron 3 Super 120B (Free)' },
      { value: 'kilo/nvidia/nemotron-3-ultra-550b-a55b:free', label: '⚡ Nemotron 3 Ultra 550B (Free)' },
      { value: 'kilo/nvidia/nemotron-3.5-lightning:free', label: '⚡ Nemotron 3.5 Lightning (Free)' },
      { value: 'kilo/nvidia/nemotron-3-nano-omni-30b-a3b-reasoning:free', label: '⚡ Nemotron 3 Nano Omni (Free)' },
      { value: 'kilo/kilo-auto/free', label: '⚡ Kilo Auto (Free)' },
      { value: 'kilo/openrouter/free', label: '⚡ OpenRouter Free via Gateway (Auto)' },
      { value: 'kilo/liquid/lfm-2.5-2.6b:free', label: '⚡ Liquid LFM 2.5 2.6B (Free)' },
      { value: 'kilo/qwen/qwen3.8-27b:free', label: '⚡ Qwen 3.8 27B (Free)' },
      { value: 'kilo/google/gemma-4-31b-it:free', label: '⚡ Google Gemma 4 31B (Free)' },
      { value: 'kilo/google/gemma-4-26b-a4b-it:free', label: '⚡ Google Gemma 4 26B (Free)' },
      { value: 'kilo/cohere/north-mini-code:free', label: '⚡ Cohere North Mini Code (Free)' },
      { value: 'kilo/stepfun/step-3.7-flash:free', label: '⚡ StepFun 3.7 Flash (Free)' },
      { value: 'kilo/dots-studio/dots-3-note-preview:free', label: '⚡ Dots 3 Note Preview (Free)' },
      { value: 'kilo/poolside/laguna-s-2.1:free', label: '⚡ Poolside Laguna S 2.1 (Free)' },
      { value: 'kilo/poolside/laguna-xs-2.1:free', label: '⚡ Poolside Laguna XS 2.1 (Free)' },
      { value: 'kilo/inclusionai/ling-3.0-flash-fin:free', label: '⚡ InclusionAI Ling 3.0 Flash Fin (Free)' },
      { value: 'kilo/inclusionai/ling-3.0-flash-sante:free', label: '⚡ InclusionAI Ling 3.0 Flash Santé (Free)' },
      { value: 'kilo/thinkingmachines/inkling-small:free', label: '⚡ Thinking Machines Inkling Small (Free)' },
    ]});
  };
  route('GET', '/api/agents/kilo/models', kiloModelsHandler);
  route('GET', '/api/kilo/models', kiloModelsHandler);

  const opencodeModelsHandler = async ({ res }) => {
    json(res, 200, { ok: true, models: [
      { value: 'opencode/nemotron-3-ultra-free', label: '💻 Nemotron 3 Ultra (Free)' },
      { value: 'opencode/nemotron-3.5-lightning-free', label: '💻 Nemotron 3.5 Lightning (Free)' },
      { value: 'opencode/ling-3.0-flash-fin-free', label: '💻 Ling 3.0 Flash Fin (Free)' },
      { value: 'opencode/longcat-2.5-preview-free', label: '💻 Longcat 2.5 Preview (Free)' },
      { value: 'opencode/mimo-v2.6-flash-free', label: '💻 Mimo v2.6 Flash (Free)' },
      { value: 'opencode/muse-spark-1.3-contributor-free', label: '💻 Muse Spark 1.3 Contributor (Free)' },
      { value: 'opencode/space-bunny-free', label: '💻 Space Bunny (Free)' },
      { value: 'opencode/big-pickle', label: '💻 Big Pickle (Free)' },
    ]});
  };
  route('GET', '/api/agents/opencode/models', opencodeModelsHandler);
  route('GET', '/api/opencode/models', opencodeModelsHandler);

  const openrouterModelsHandler = async ({ res }) => {
    json(res, 200, { ok: true, models: [
      { value: 'openrouter/openrouter/free', label: '🌐 OpenRouter Free (Auto)' },
      { value: 'openrouter/meta-llama/llama-3.3-70b-instruct:free', label: '🌐 Llama 3.3 70B Instruct (Free)' },
      { value: 'openrouter/google/gemini-2.0-flash-exp:free', label: '🌐 Gemini 2.0 Flash Exp (Free)' },
      { value: 'openrouter/deepseek/deepseek-r1:free', label: '🌐 DeepSeek R1 (Free)' },
      { value: 'openrouter/qwen/qwen-2.5-coder-32b-instruct:free', label: '🌐 Qwen 2.5 Coder 32B (Free)' },
      { value: 'openrouter/mistralai/mistral-small-24b-instruct-2501:free', label: '🌐 Mistral Small 24B (Free)' },
      { value: 'openrouter/nvidia/nemotron-3-super-120b-a12b:free', label: '🌐 Nemotron 3 Super 120B (Free)' },
      { value: 'openrouter/nvidia/nemotron-3-ultra-550b-a55b:free', label: '🌐 Nemotron 3 Ultra 550B (Free)' },
      { value: 'openrouter/nvidia/nemotron-3.5-lightning:free', label: '🌐 Nemotron 3.5 Lightning (Free)' },
      { value: 'openrouter/nvidia/nemotron-3-nano-omni-30b-a3b-reasoning:free', label: '🌐 Nemotron 3 Nano Omni (Free)' },
      { value: 'openrouter/liquid/lfm-2.5-2.6b:free', label: '🌐 Liquid LFM 2.5 2.6B (Free)' },
      { value: 'openrouter/qwen/qwen3.8-27b:free', label: '🌐 Qwen 3.8 27B (Free)' },
      { value: 'openrouter/google/gemma-4-31b-it:free', label: '🌐 Google Gemma 4 31B (Free)' },
      { value: 'openrouter/google/gemma-4-26b-a4b-it:free', label: '🌐 Google Gemma 4 26B (Free)' },
      { value: 'openrouter/cohere/north-mini-code:free', label: '🌐 Cohere North Mini Code (Free)' },
      { value: 'openrouter/stepfun/step-3.7-flash:free', label: '🌐 StepFun 3.7 Flash (Free)' },
      { value: 'openrouter/dots-studio/dots-3-note-preview:free', label: '🌐 Dots 3 Note Preview (Free)' },
      { value: 'openrouter/poolside/laguna-s-2.1:free', label: '🌐 Poolside Laguna S 2.1 (Free)' },
      { value: 'openrouter/poolside/laguna-xs-2.1:free', label: '🌐 Poolside Laguna XS 2.1 (Free)' },
      { value: 'openrouter/inclusionai/ling-3.0-flash-fin:free', label: '🌐 InclusionAI Ling 3.0 Flash Fin (Free)' },
      { value: 'openrouter/inclusionai/ling-3.0-flash-sante:free', label: '🌐 InclusionAI Ling 3.0 Flash Santé (Free)' },
      { value: 'openrouter/thinkingmachines/inkling-small:free', label: '🌐 Thinking Machines Inkling Small (Free)' },
    ]});
  };
  route('GET', '/api/agents/openrouter/models', openrouterModelsHandler);
  route('GET', '/api/openrouter/models', openrouterModelsHandler);

  const kiloQuotaHandler = async ({ res }) => {
    json(res, 200, getKiloQuota());
  };
  route('GET', '/api/agents/kilo/quota', kiloQuotaHandler);
  route('GET', '/api/kilo/quota', kiloQuotaHandler);

  const opencodeQuotaHandler = async ({ res }) => {
    json(res, 200, getOpencodeQuota());
  };
  route('GET', '/api/agents/opencode/quota', opencodeQuotaHandler);
  route('GET', '/api/opencode/quota', opencodeQuotaHandler);

  const openrouterQuotaHandler = async ({ res }) => {
    const data = await getOpenrouterQuota();
    json(res, 200, data);
  };
  route('GET', '/api/agents/openrouter/quota', openrouterQuotaHandler);
  route('GET', '/api/openrouter/quota', openrouterQuotaHandler);

  const quotaHandler = async ({ res, req }) => {
    const force = req.url.includes('force=true') || req.url.includes('refresh=1');
    const data = await getAgyQuota(force);
    json(res, 200, data);
  };
  route('GET', '/api/agents/agy/quota', quotaHandler);
  route('GET', '/api/agy/quota', quotaHandler);

  const modelsHandler = async ({ res, req }) => {
    const force = req.url.includes('force=true') || req.url.includes('refresh=1');
    json(res, 200, await getAgyModels(force));
  };
  route('GET', '/api/agents/agy/models', modelsHandler);
  route('GET', '/api/agy/models', modelsHandler);

  const claudeQuotaHandler = async ({ res, req }) => {
    const force = req.url.includes('force=true') || req.url.includes('refresh=1');
    json(res, 200, await getClaudeQuota(force));
  };
  route('GET', '/api/agents/claude/quota', claudeQuotaHandler);
  route('GET', '/api/claude/quota', claudeQuotaHandler);

  route('POST', '/api/agents/install-claude', async ({ res }) => {
    try {
      const result = await installClaude(log);
      const version = await getClaudeVersion();
      json(res, 200, { ok: true, version, output: result.output });
    } catch (e) {
      json(res, 500, { ok: false, error: e.message });
    }
  });

  route('POST', '/api/agents/update-agy', async ({ res }) => {
    try {
      const result = await updateAgy(log);
      const version = await getAgyVersion();
      json(res, 200, { ok: true, version, output: result.output });
    } catch (e) {
      json(res, 500, { ok: false, error: e.message });
    }
  });
};

async function getOpenrouterQuota() {
  const key = process.env.OPENROUTER_API_KEY || process.env.OPENROUTER_API_TOKEN;
  if (!key) {
    return {
      agent: 'openrouter',
      updatedAt: Date.now(),
      quotas: [{
        category: 'Modèles OpenRouter Free',
        limitName: 'Clé API requise (définir OPENROUTER_API_KEY)',
        remainingPercent: 0,
        usedPercent: 0,
        resetText: 'Non configuré',
        resetIso: 'Inactif'
      }]
    };
  }
  try {
    const res = await fetch('https://openrouter.ai/api/v1/auth/key', {
      headers: { 'Authorization': `Bearer ${key}` },
      signal: AbortSignal.timeout(4000)
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const { data } = await res.json();
    const freeReqs = data.free_model_daily_requests || { used: 0, limit: 50, remaining: 50 };
    const used = freeReqs.used || 0;
    const limit = freeReqs.limit || 50;
    const remaining = freeReqs.remaining != null ? freeReqs.remaining : Math.max(0, limit - used);
    const remPct = Math.round((remaining / limit) * 100);
    const usedPct = 100 - remPct;

    return {
      agent: 'openrouter',
      updatedAt: Date.now(),
      quotas: [
        {
          category: 'Requêtes Journalières Gratuites',
          limitName: `${remaining} / ${limit} restantes (${remPct}%)`,
          remainingPercent: remPct,
          usedPercent: usedPct,
          resetText: 'Réinitialisation à 00:00 UTC',
          resetIso: 'Minuit UTC'
        },
        {
          category: 'Crédits API & Statut',
          limitName: data.is_free_tier ? 'Compte Gratuit (Free Tier)' : `Consommation: $${data.usage || 0}`,
          remainingPercent: 100,
          usedPercent: 0,
          resetText: 'Illimité sur modèles :free',
          resetIso: 'Actif'
        }
      ]
    };
  } catch (e) {
    return {
      agent: 'openrouter',
      updatedAt: Date.now(),
      quotas: [
        {
          category: 'Modèles OpenRouter Free',
          limitName: 'Accès API Direct Actif',
          remainingPercent: 100,
          usedPercent: 0,
          resetText: 'Illimité sur modèles :free',
          resetIso: 'Actif'
        }
      ]
    };
  }
}

function getKiloQuota() {
  return {
    agent: 'kilo',
    updatedAt: Date.now(),
    quotas: [
      {
        category: 'Modèles Kilo Free',
        limitName: 'Partenaires Nemotron, Qwen & LFM',
        remainingPercent: 100,
        usedPercent: 0,
        resetText: 'Illimité (Zéro Coût)',
        resetIso: 'Actif'
      },
      {
        category: 'Moteur Terminal',
        limitName: 'Kilo CLI Interactif',
        remainingPercent: 100,
        usedPercent: 0,
        resetText: 'Prêt',
        resetIso: 'Actif'
      }
    ]
  };
}

function getOpencodeQuota() {
  return {
    agent: 'opencode',
    updatedAt: Date.now(),
    quotas: [
      {
        category: 'Modèles OpenCode Free',
        limitName: 'Modèles Communautaires Gratuits',
        remainingPercent: 100,
        usedPercent: 0,
        resetText: 'Illimité',
        resetIso: 'Actif'
      },
      {
        category: 'Mode Local',
        limitName: 'OpenCode CLI Interactif',
        remainingPercent: 100,
        usedPercent: 0,
        resetText: 'Prêt',
        resetIso: 'Actif'
      }
    ]
  };
}

module.exports.getClaudePath = getClaudePath;
module.exports.getClaudeVersion = getClaudeVersion;
module.exports.installClaude = installClaude;
module.exports.getAgyPath = getAgyPath;
module.exports.getAgyVersion = getAgyVersion;
module.exports.installAgy = installAgy;
module.exports.updateAgy = updateAgy;
module.exports.getAgyQuota = getAgyQuota;
module.exports.getClaudeQuota = getClaudeQuota;
module.exports.getOpenrouterQuota = getOpenrouterQuota;
module.exports.getKiloQuota = getKiloQuota;
module.exports.getOpencodeQuota = getOpencodeQuota;
module.exports.getAgyModels = getAgyModels;
module.exports.updateAgyOnly = updateAgyOnly;
