'use strict';
/**
 * Direct Providers Test Suite for Free Session Manager
 * Tests lib/direct-providers.js (pure, no network calls):
 * 1. normalizeModel per provider (prefix stripping, catalog edge cases, passthrough)
 * 2. resolveProvider('kilo', ...) with and without KILO_API_KEY (anonymous gateway access)
 * 3. resolveProvider('opencode', ...) : Zen direct (key present), local engine (binary present,
 *    no key), and fallback to Kilo Gateway (no key, no binary) with model mapping
 * 4. resolveProvider('openrouter', ...) with and without a key (must error clearly when absent)
 */

const {
  PROVIDERS,
  normalizeModel,
  resolveProvider,
  mapOpencodeModelToKilo,
} = require('../lib/direct-providers');

async function runDirectProviderTests() {
  console.log('\n🔍 ==========================================');
  console.log('🔍 EXÉCUTION DES TESTS DIRECT-PROVIDERS');
  console.log('🔍 ==========================================\n');

  let passed = 0;
  let failed = 0;

  function assert(condition, testName, detail = '') {
    if (condition) {
      console.log(`  ✅ [PASS] ${testName}`);
      passed++;
    } else {
      console.error(`  ❌ [FAIL] ${testName} ${detail ? '(' + detail + ')' : ''}`);
      failed++;
    }
  }

  // ---------------------------------------------------------------------------
  // Test 1 : PROVIDERS table
  // ---------------------------------------------------------------------------
  assert(
    PROVIDERS && PROVIDERS.openrouter && PROVIDERS.kilo && PROVIDERS.opencode,
    'PROVIDERS expose openrouter, kilo et opencode'
  );

  // ---------------------------------------------------------------------------
  // Test 2 : normalizeModel — cas du catalogue + passthrough
  // ---------------------------------------------------------------------------
  const normCases = [
    { provider: 'kilo', input: 'kilo/kilo-auto/free', expected: 'kilo-auto/free' },
    { provider: 'kilo', input: 'kilo/openrouter/free', expected: 'openrouter/free' },
    { provider: 'opencode', input: 'opencode/big-pickle', expected: 'big-pickle' },
    { provider: 'openrouter', input: 'openrouter/openrouter/free', expected: 'openrouter/free' },
    { provider: 'openrouter', input: 'openrouter/free', expected: 'openrouter/free' },
    { provider: 'kilo', input: '', expected: 'kilo-auto/free' },
    { provider: 'kilo', input: null, expected: 'kilo-auto/free' },
    { provider: 'opencode', input: '', expected: 'big-pickle' },
    { provider: 'openrouter', input: '', expected: 'openrouter/free' },
    { provider: 'openrouter', input: 'thinkingmachines/inkling-small:free', expected: 'thinkingmachines/inkling-small:free' },
    { provider: 'kilo', input: 'nvidia/nemotron-3.5-lightning:free', expected: 'nvidia/nemotron-3.5-lightning:free' },
    { provider: 'opencode', input: 'opencode/nemotron-3.5-lightning-free', expected: 'nemotron-3.5-lightning-free' },
  ];
  let normOk = true;
  for (const c of normCases) {
    const res = normalizeModel(c.provider, c.input);
    if (res !== c.expected) {
      normOk = false;
      console.error(`    Échec normalisation [${c.provider}] : "${c.input}" -> "${res}" (attendu: "${c.expected}")`);
    }
  }
  assert(normOk, 'normalizeModel() gère les préfixes de catalogue et le passthrough pour les 3 fournisseurs');

  // ---------------------------------------------------------------------------
  // Test 3 : resolveProvider('kilo', ...) — accès anonyme
  // ---------------------------------------------------------------------------
  const kiloAnon = resolveProvider('kilo', {}, false);
  assert(kiloAnon.provider === 'kilo', 'resolveProvider(kilo) sans clé : provider = kilo');
  assert(kiloAnon.baseURL === 'https://api.kilo.ai/api/gateway', 'resolveProvider(kilo) sans clé : baseURL Gateway', kiloAnon.baseURL);
  assert(!kiloAnon.headers || !kiloAnon.headers.Authorization, 'resolveProvider(kilo) sans clé : aucun header Authorization (accès anonyme)');
  assert(kiloAnon.fallback === false, 'resolveProvider(kilo) sans clé : fallback=false');

  const kiloKeyed = resolveProvider('kilo', { KILO_API_KEY: 'test-kilo-key' }, false);
  assert(kiloKeyed.headers && kiloKeyed.headers.Authorization === 'Bearer test-kilo-key', 'resolveProvider(kilo) avec clé : header Authorization Bearer présent');

  // ---------------------------------------------------------------------------
  // Test 4 : resolveProvider('opencode', ...) — Zen direct (clé présente)
  // ---------------------------------------------------------------------------
  const opencodeZen = resolveProvider('opencode', { OPENCODE_API_KEY: 'zen-key' }, true);
  assert(opencodeZen.provider === 'opencode' && opencodeZen.mode === 'zen', 'resolveProvider(opencode) avec clé : mode Zen direct');
  assert(opencodeZen.baseURL === 'https://opencode.ai/zen/v1', 'resolveProvider(opencode) avec clé : baseURL Zen', opencodeZen.baseURL);
  assert(opencodeZen.headers && opencodeZen.headers.Authorization === 'Bearer zen-key', 'resolveProvider(opencode) avec clé : header Authorization Bearer présent');
  assert(opencodeZen.fallback === false, 'resolveProvider(opencode) avec clé : fallback=false');

  // ---------------------------------------------------------------------------
  // Test 5 : resolveProvider('opencode', ...) — moteur local (pas de clé, binaire présent)
  // ---------------------------------------------------------------------------
  const opencodeEngine = resolveProvider('opencode', {}, true);
  assert(opencodeEngine.provider === 'opencode' && opencodeEngine.mode === 'engine', 'resolveProvider(opencode) sans clé + binaire présent : mode moteur local');
  assert(opencodeEngine.fallback === false, 'resolveProvider(opencode) mode moteur : ce n\'est pas un repli Kilo (fallback=false)');
  assert(typeof opencodeEngine.notice === 'string' && opencodeEngine.notice.length > 0, 'resolveProvider(opencode) mode moteur : notice informative présente');

  // ---------------------------------------------------------------------------
  // Test 6 : resolveProvider('opencode', ...) — repli Kilo (pas de clé, pas de binaire)
  // ---------------------------------------------------------------------------
  const opencodeFallback = resolveProvider('opencode', {}, false);
  assert(opencodeFallback.provider === 'kilo', 'resolveProvider(opencode) sans clé ni binaire : cible effective = kilo');
  assert(opencodeFallback.fallback === true, 'resolveProvider(opencode) sans clé ni binaire : fallback=true');
  assert(typeof opencodeFallback.notice === 'string' && opencodeFallback.notice.length > 0, 'resolveProvider(opencode) sans clé ni binaire : notice de repli présente');
  assert(opencodeFallback.baseURL === 'https://api.kilo.ai/api/gateway', 'resolveProvider(opencode) sans clé ni binaire : baseURL = Kilo Gateway');

  // Mapping de modèle équivalent lors du repli
  const mapCases = [
    { input: 'nemotron-3.5-lightning-free', expected: 'nvidia/nemotron-3.5-lightning:free' },
    { input: 'nemotron-3-ultra-free', expected: 'nvidia/nemotron-3-ultra-550b-a55b:free' },
    { input: 'ling-3.0-flash-fin-free', expected: 'inclusionai/ling-3.0-flash-fin:free' },
    { input: 'space-bunny-free', expected: 'kilo-auto/free' },
  ];
  let mapOk = true;
  for (const c of mapCases) {
    const res = mapOpencodeModelToKilo(c.input);
    if (res !== c.expected) {
      mapOk = false;
      console.error(`    Échec mapping repli : "${c.input}" -> "${res}" (attendu: "${c.expected}")`);
    }
  }
  assert(mapOk, 'mapOpencodeModelToKilo() mappe les modèles OpenCode vers leurs équivalents Kilo Gateway');

  // Le normalizer renvoyé par resolveProvider() applique aussi ce mapping de bout en bout
  assert(
    typeof opencodeFallback.normalizeModel === 'function' &&
    opencodeFallback.normalizeModel('opencode/nemotron-3.5-lightning-free') === 'nvidia/nemotron-3.5-lightning:free',
    'resolveProvider(opencode) repli : normalizeModel() de bout en bout (préfixe + mapping Kilo)'
  );

  // ---------------------------------------------------------------------------
  // Test 7 : resolveProvider('openrouter', ...) — clé requise
  // ---------------------------------------------------------------------------
  const openrouterKeyed = resolveProvider('openrouter', { OPENROUTER_API_KEY: 'or-key' }, false);
  assert(openrouterKeyed.provider === 'openrouter', 'resolveProvider(openrouter) avec clé : provider = openrouter');
  assert(openrouterKeyed.headers && openrouterKeyed.headers.Authorization === 'Bearer or-key', 'resolveProvider(openrouter) avec clé : header Authorization Bearer présent');
  assert(openrouterKeyed.fallback === false, 'resolveProvider(openrouter) avec clé : fallback=false');

  const openrouterTokenOnly = resolveProvider('openrouter', { OPENROUTER_API_TOKEN: 'or-token' }, false);
  assert(openrouterTokenOnly.headers && openrouterTokenOnly.headers.Authorization === 'Bearer or-token', 'resolveProvider(openrouter) avec OPENROUTER_API_TOKEN : header Authorization Bearer présent');

  let openrouterThrew = false;
  let openrouterErrMsg = '';
  try {
    resolveProvider('openrouter', {}, false);
  } catch (e) {
    openrouterThrew = true;
    openrouterErrMsg = e.message || '';
  }
  assert(openrouterThrew && openrouterErrMsg.length > 0, 'resolveProvider(openrouter) sans clé : erreur claire levée', openrouterErrMsg);

  console.log(`\n📊 Bilan Direct-Providers : ${passed} passés, ${failed} échoués.\n`);
  return { passed, failed };
}

if (require.main === module) {
  runDirectProviderTests().then(({ failed }) => {
    process.exit(failed > 0 ? 1 : 0);
  });
}

module.exports = { runDirectProviderTests };
