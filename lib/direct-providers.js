'use strict';
/**
 * Table des fournisseurs "direct" (sans CLI tierce) et logique de résolution associée.
 *
 * Ce module est pur : aucun appel réseau ni accès au système de fichiers ici.
 * bin/direct-agent.js est responsable de la détection du binaire OpenCode
 * (via lib/config.js#resolveOpencode) et lui transmet le résultat sous forme
 * d'un booléen `hasOpencodeBinary` injecté dans resolveProvider().
 *
 * Faits vérifiés (2026-09-28) :
 * - Kilo Gateway (https://api.kilo.ai/api/gateway) : les modèles gratuits sont
 *   appelables ANONYMEMENT (sans Authorization). KILO_API_KEY est optionnelle.
 * - OpenCode Zen (https://opencode.ai/zen/v1) : le free tier refuse les clients
 *   tiers (FreeTierError). Il faut soit OPENCODE_API_KEY (accès Zen direct),
 *   soit passer par le moteur OpenCode local (`opencode serve --port 0 --pure`,
 *   binaire natif OpenCode qui expose une API HTTP OpenAI-like locale et sert
 *   les modèles gratuits à coût 0 sans clé tierce), soit, en dernier recours,
 *   se replier sur Kilo Gateway avec un modèle équivalent.
 * - OpenRouter : nécessite OPENROUTER_API_KEY ou OPENROUTER_API_TOKEN.
 */

const PROVIDERS = {
  openrouter: {
    baseURL: 'https://openrouter.ai/api/v1',
    chatPath: '/chat/completions',
    modelsPath: '/models',
    keyEnv: ['OPENROUTER_API_KEY', 'OPENROUTER_API_TOKEN'],
    requiresKey: true,
    defaultModel: 'openrouter/free',
  },
  kilo: {
    baseURL: 'https://api.kilo.ai/api/gateway',
    chatPath: '/chat/completions',
    modelsPath: '/models',
    keyEnv: ['KILO_API_KEY'],
    requiresKey: false,
    defaultModel: 'kilo-auto/free',
  },
  opencode: {
    baseURL: 'https://opencode.ai/zen/v1',
    chatPath: '/chat/completions',
    modelsPath: '/models',
    keyEnv: ['OPENCODE_API_KEY'],
    requiresKey: true,
    defaultModel: 'big-pickle',
    // Mode moteur local : `opencode serve --port 0 --pure`, piloté en HTTP par
    // bin/direct-agent.js (POST /session, POST /session/:id/message, GET /event).
    engine: {
      cliFlag: ['serve', '--port', '0', '--pure'],
      readyLineRe: /listening on\s+https?:\/\/[^\s]*?:(\d+)/i,
    },
  },
};

/**
 * Retire, au plus, un unique préfixe `${provider}/` en tête de l'identifiant
 * de modèle, tel qu'utilisé dans les catalogues (ex: 'kilo/kilo-auto/free',
 * 'kilo/openrouter/free', 'opencode/big-pickle', 'openrouter/openrouter/free').
 * Ne strippe jamais plus d'un niveau, et ne casse pas les identifiants de
 * modèles "nus" qui coïncident déjà avec le modèle par défaut du fournisseur
 * (ex: 'openrouter/free' passé tel quel doit rester 'openrouter/free').
 */
function normalizeModel(provider, model) {
  const p = PROVIDERS[provider];
  if (!p) throw new Error(`Fournisseur inconnu : ${provider}`);
  const def = p.defaultModel;

  if (!model) return def;
  let m = String(model).trim();
  if (!m) return def;
  if (m === def) return m;

  const prefix = `${provider}/`;
  if (m.startsWith(prefix)) {
    const stripped = m.slice(prefix.length);
    return stripped || def;
  }
  return m;
}

/**
 * Mappe un identifiant de modèle OpenCode (déjà normalisé, sans préfixe
 * 'opencode/') vers son équivalent disponible sur Kilo Gateway, utilisé
 * lors du repli OpenCode -> Kilo.
 */
function mapOpencodeModelToKilo(model) {
  const MAP = {
    'nemotron-3.5-lightning-free': 'nvidia/nemotron-3.5-lightning:free',
    'nemotron-3-ultra-free': 'nvidia/nemotron-3-ultra-550b-a55b:free',
    'ling-3.0-flash-fin-free': 'inclusionai/ling-3.0-flash-fin:free',
  };
  return MAP[model] || 'kilo-auto/free';
}

/**
 * Résout la configuration effective à utiliser pour un fournisseur donné.
 *
 * @param {string} provider - 'openrouter' | 'kilo' | 'opencode'
 * @param {object} env - variables d'environnement (process.env ou un objet de test)
 * @param {boolean} hasOpencodeBinary - vrai si le binaire OpenCode natif est disponible
 *   localement (calculé par l'appelant via lib/config.js#resolveOpencode ; ce module
 *   ne touche jamais au système de fichiers lui-même).
 *
 * @returns {{
 *   provider: string,        // fournisseur EFFECTIF (peut différer de l'argument en cas de repli)
 *   mode: 'api'|'zen'|'engine',
 *   baseURL: string|null,    // null en mode 'engine' (déterminé dynamiquement au démarrage du serveur local)
 *   headers: object,
 *   normalizeModel: (model: string) => string,
 *   fallback: boolean,       // true uniquement pour le repli OpenCode -> Kilo
 *   notice: string|null,     // message (français) à afficher à l'utilisateur, ou null
 * }}
 */
function resolveProvider(provider, env = {}, hasOpencodeBinary = false) {
  env = env || {};
  const p = PROVIDERS[provider];
  if (!p) throw new Error(`Fournisseur inconnu : ${provider}`);

  if (provider === 'openrouter') {
    const key = env.OPENROUTER_API_KEY || env.OPENROUTER_API_TOKEN || '';
    if (!key) {
      throw new Error(
        'OPENROUTER_API_KEY (ou OPENROUTER_API_TOKEN) est requis pour utiliser OpenRouter. ' +
        'Définissez la variable d\'environnement puis relancez la session.'
      );
    }
    return {
      provider: 'openrouter',
      mode: 'api',
      baseURL: p.baseURL,
      headers: { Authorization: `Bearer ${key}` },
      normalizeModel: (m) => normalizeModel('openrouter', m),
      fallback: false,
      notice: null,
    };
  }

  if (provider === 'kilo') {
    const key = env.KILO_API_KEY || '';
    return {
      provider: 'kilo',
      mode: 'api',
      baseURL: p.baseURL,
      headers: key ? { Authorization: `Bearer ${key}` } : {},
      normalizeModel: (m) => normalizeModel('kilo', m),
      fallback: false,
      notice: null,
    };
  }

  if (provider === 'opencode') {
    const zenKey = env.OPENCODE_API_KEY || '';

    // 1) Clé Zen présente : accès direct à l'API OpenCode Zen.
    if (zenKey) {
      return {
        provider: 'opencode',
        mode: 'zen',
        baseURL: p.baseURL,
        headers: { Authorization: `Bearer ${zenKey}` },
        normalizeModel: (m) => normalizeModel('opencode', m),
        fallback: false,
        notice: null,
      };
    }

    // 2) Pas de clé, mais le binaire OpenCode natif est disponible localement :
    //    on pilote un moteur `opencode serve --port 0 --pure` en HTTP.
    if (hasOpencodeBinary) {
      return {
        provider: 'opencode',
        mode: 'engine',
        baseURL: null,
        headers: {},
        normalizeModel: (m) => normalizeModel('opencode', m),
        fallback: false,
        notice: 'ℹ️  OPENCODE_API_KEY absente : utilisation du moteur OpenCode local (opencode serve) au lieu de l\'API Zen distante.',
      };
    }

    // 3) Ni clé, ni binaire : repli anonyme sur Kilo Gateway avec modèle équivalent.
    const kiloKey = env.KILO_API_KEY || '';
    return {
      provider: 'kilo',
      mode: 'api',
      baseURL: PROVIDERS.kilo.baseURL,
      headers: kiloKey ? { Authorization: `Bearer ${kiloKey}` } : {},
      normalizeModel: (m) => mapOpencodeModelToKilo(normalizeModel('opencode', m)),
      fallback: true,
      notice: '⚠️  OpenCode Zen nécessite une clé API (OPENCODE_API_KEY) et le binaire OpenCode natif est introuvable : ' +
        'repli automatique sur Kilo Gateway (mode anonyme, modèle équivalent).',
    };
  }

  throw new Error(`Fournisseur inconnu : ${provider}`);
}

module.exports = {
  PROVIDERS,
  normalizeModel,
  resolveProvider,
  mapOpencodeModelToKilo,
};
