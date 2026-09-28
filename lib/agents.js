'use strict';
// Gestion de la détection, version et installation des fournisseurs natifs : Kilo, OpenCode et OpenRouter.
const fs = require('fs');
const { execFile } = require('child_process');
const { resolveKilo, resolveOpencode, hasOpencode, } = require('./config');

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

// Catalogue des modèles gratuits lu en direct (OpenRouter et Kilo Gateway exposent
// /models publiquement) : un modèle qui cesse d'être gratuit disparaît du sélecteur
// au lieu de renvoyer « This model is unavailable for free ». Repli statique hors ligne.
const ROUTER_IDS = ['kilo-auto/free', 'openrouter/free'];
const modelsCache = new Map();
async function liveFreeModels(url, prefix, icon, fallback) {
  const hit = modelsCache.get(url);
  if (hit && Date.now() - hit.at < 30 * 60 * 1000) return hit.models;
  try {
    const r = await fetch(url, { signal: AbortSignal.timeout(8000) });
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    const data = (await r.json()).data || [];
    const free = data.filter(m => {
      const out = m.architecture?.output_modalities;
      if (out && !out.includes('text')) return false; // audio/image seuls (Lyria…)
      if (/content-safety|guard/i.test(m.id)) return false; // classifieurs, pas des assistants
      const zero = m.pricing && Number(m.pricing.prompt) === 0 && Number(m.pricing.completion) === 0;
      return m.id.endsWith(':free') || ROUTER_IDS.includes(m.id) || (zero && m.id.startsWith('stealth/'));
    });
    if (!free.length) throw new Error('liste vide');
    const label = m => {
      if (m.id === 'openrouter/free') return prefix === 'kilo' ? 'OpenRouter Free via Gateway (Auto)' : 'OpenRouter Free (Auto)';
      if (m.id === 'kilo-auto/free') return 'Kilo Auto (Free)';
      const name = String(m.name || m.id).replace(/\s*\(free\)\s*$/i, '').replace(/\s+/g, ' ').trim();
      return `${name} (Free)`;
    };
    const models = free
      .map(m => ({ value: `${prefix}/${m.id}`, label: `${icon} ${label(m)}`, router: ROUTER_IDS.includes(m.id) }))
      .sort((a, b) => (b.router - a.router) || a.label.localeCompare(b.label))
      .map(({ value, label }) => ({ value, label }));
    modelsCache.set(url, { at: Date.now(), models });
    return models;
  } catch {
    return hit ? hit.models : fallback;
  }
}

// Module serveur : enregistre les routes API pour les fournisseurs natifs
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

  const KILO_STATIC = [
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
  ];
  const kiloModelsHandler = async ({ res }) => {
    json(res, 200, { ok: true, models: await liveFreeModels('https://api.kilo.ai/api/gateway/models', 'kilo', '⚡', KILO_STATIC) });
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

  const OPENROUTER_STATIC = [
      { value: 'openrouter/openrouter/free', label: '🌐 OpenRouter Free (Auto)' },
      { value: 'openrouter/nvidia/nemotron-3-super-120b-a12b:free', label: '🌐 Nemotron 3 Super 120B (Free)' },
      { value: 'openrouter/nvidia/nemotron-3-ultra-550b-a55b:free', label: '🌐 Nemotron 3 Ultra 550B (Free)' },
      { value: 'openrouter/nvidia/nemotron-3.5-lightning:free', label: '🌐 Nemotron 3.5 Lightning (Free)' },
      { value: 'openrouter/nvidia/nemotron-3-nano-omni-30b-a3b-reasoning:free', label: '🌐 Nemotron 3 Nano Omni (Free)' },
      { value: 'openrouter/liquid/lfm-2.5-2.6b:free', label: '🌐 Liquid LFM 2.5 2.6B (Free)' },
      { value: 'openrouter/qwen/qwen3.8-27b:free', label: '🌐 Qwen 3.8 27B (Free)' },
      { value: 'openrouter/google/gemma-4-31b-it:free', label: '🌐 Google Gemma 4 31B (Free)' },
      { value: 'openrouter/google/gemma-4-26b-a4b-it:free', label: '🌐 Google Gemma 4 26B (Free)' },
      { value: 'openrouter/cohere/north-mini-code:free', label: '🌐 Cohere North Mini Code (Free)' },
      { value: 'openrouter/dots-studio/dots-3-note-preview:free', label: '🌐 Dots 3 Note Preview (Free)' },
      { value: 'openrouter/poolside/laguna-s-2.1:free', label: '🌐 Poolside Laguna S 2.1 (Free)' },
      { value: 'openrouter/poolside/laguna-xs-2.1:free', label: '🌐 Poolside Laguna XS 2.1 (Free)' },
      { value: 'openrouter/inclusionai/ling-3.0-flash-fin:free', label: '🌐 InclusionAI Ling 3.0 Flash Fin (Free)' },
      { value: 'openrouter/inclusionai/ling-3.0-flash-sante:free', label: '🌐 InclusionAI Ling 3.0 Flash Santé (Free)' },
      { value: 'openrouter/thinkingmachines/inkling-small:free', label: '🌐 Thinking Machines Inkling Small (Free)' },
  ];
  const openrouterModelsHandler = async ({ res }) => {
    json(res, 200, { ok: true, models: await liveFreeModels('https://openrouter.ai/api/v1/models', 'openrouter', '🌐', OPENROUTER_STATIC) });
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
        limitName: 'Exécution native (Kilo Gateway)',
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
        limitName: 'Exécution native',
        remainingPercent: 100,
        usedPercent: 0,
        resetText: 'Prêt',
        resetIso: 'Actif'
      }
    ]
  };
}

module.exports.getOpenrouterQuota = getOpenrouterQuota;
module.exports.getKiloQuota = getKiloQuota;
module.exports.getOpencodeQuota = getOpencodeQuota;
