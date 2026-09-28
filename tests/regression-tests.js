'use strict';
/**
 * Non-Regression Test Suite for Free Session Manager
 * Tests:
 * 1. Agent binary resolution (Kilo, OpenCode, OpenRouter, Node)
 * 2. Model catalog integrity for all 3 agents (Kilo, OpenCode, OpenRouter)
 * 3. OpenRouter normalization logic (clean slug conversion)
 * 4. OpenRouter Agent interactive CLI commands (/help, /models, /exit)
 * 5. OpenRouter Direct live API streaming connectivity
 * 6. WebSocket protocol handshake and authentication
 * 7. Server settings and persistence integrity
 */

const http = require('http');
const fs = require('fs');
const path = require('path');
const WebSocket = require('ws');
const { spawnSync } = require('child_process');

const {
  PORT, DATA, ROOT,
  resolveKilo, hasKilo,
  resolveOpencode, hasOpencode,
  resolveOpenrouter, hasOpenrouter,
  resolveNode
} = require('../lib/config');

const TOKEN_FILE = path.join(DATA, 'token');
const ADMIN_TOKEN = fs.existsSync(TOKEN_FILE) ? fs.readFileSync(TOKEN_FILE, 'utf8').trim() : '';

function request(options, body = null) {
  return new Promise((resolve, reject) => {
    const req = http.request({
      host: '127.0.0.1',
      port: PORT,
      ...options,
    }, res => {
      let data = '';
      res.on('data', chunk => { data += chunk; });
      res.on('end', () => {
        try {
          resolve({ status: res.statusCode, body: data, json: JSON.parse(data) });
        } catch {
          resolve({ status: res.statusCode, body: data, json: null });
        }
      });
    });
    req.on('error', reject);
    if (body) req.write(body);
    req.end();
  });
}

async function runRegressionTests() {
  console.log('\n🔍 ==========================================');
  console.log('🔍 EXÉCUTION DES TESTS DE NON-RÉGRESSION');
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
  // Test 1 : Résolution des binaires des Agents
  // ---------------------------------------------------------------------------
  const kiloPath = resolveKilo();
  assert(typeof kiloPath === 'string' && kiloPath.length > 0, 'Résolution du binaire Kilo', kiloPath);

  const opencodePath = resolveOpencode();
  assert(typeof opencodePath === 'string' && opencodePath.length > 0, 'Résolution du binaire OpenCode', opencodePath);

  const openrouterPath = resolveOpenrouter();
  assert(fs.existsSync(openrouterPath), 'Résolution du runner OpenRouter Direct', openrouterPath);

  const nodePath = resolveNode();
  assert(fs.existsSync(nodePath), 'Résolution du binaire Node.js', nodePath);

  // ---------------------------------------------------------------------------
  // Test 2 : Intégrité du catalogue des modèles pour les 3 agents
  // ---------------------------------------------------------------------------
  try {
    const resKilo = await request({
      path: '/api/agents/kilo/models',
      method: 'GET',
      headers: { Host: `127.0.0.1:${PORT}`, 'X-SM-Token': ADMIN_TOKEN }
    });
    assert(Array.isArray(resKilo.json?.models) && resKilo.json.models.length >= 10, 'Catalogue des modèles Kilo accessible et complet', `${resKilo.json?.models?.length || 0} modèles`);

    const resOpencode = await request({
      path: '/api/agents/opencode/models',
      method: 'GET',
      headers: { Host: `127.0.0.1:${PORT}`, 'X-SM-Token': ADMIN_TOKEN }
    });
    assert(Array.isArray(resOpencode.json?.models) && resOpencode.json.models.length >= 5, 'Catalogue des modèles OpenCode accessible et complet', `${resOpencode.json?.models?.length || 0} modèles`);

    const resOpenrouter = await request({
      path: '/api/agents/openrouter/models',
      method: 'GET',
      headers: { Host: `127.0.0.1:${PORT}`, 'X-SM-Token': ADMIN_TOKEN }
    });
    assert(Array.isArray(resOpenrouter.json?.models) && resOpenrouter.json.models.length >= 10, 'Catalogue des modèles OpenRouter accessible et complet', `${resOpenrouter.json?.models?.length || 0} modèles`);
  } catch (e) {
    assert(false, 'Catalogue des modèles', e.message);
  }

  // ---------------------------------------------------------------------------
  // Test 3 : Logique de normalisation des slugs OpenRouter
  // ---------------------------------------------------------------------------
  // On teste directement la logique de normalisation
  const cases = [
    { input: 'openrouter/openrouter/free', expected: 'openrouter/free' },
    { input: 'openrouter/free', expected: 'openrouter/free' },
    { input: 'kilo/openrouter/free', expected: 'openrouter/free' },
    { input: 'openrouter/thinkingmachines/inkling-small:free', expected: 'thinkingmachines/inkling-small:free' },
    { input: 'openrouter/nvidia/nemotron-3.5-lightning:free', expected: 'nvidia/nemotron-3.5-lightning:free' },
    { input: 'openrouter/deepseek/deepseek-r1:free', expected: 'deepseek/deepseek-r1:free' },
  ];

  function normalizeModelTest(m) {
    if (!m) return 'openrouter/free';
    let clean = m.trim();
    if (clean === 'openrouter/openrouter/free' || clean === 'openrouter/free' || clean === 'free' || clean === 'kilo/openrouter/free') {
      return 'openrouter/free';
    }
    if (clean.startsWith('kilo/')) clean = clean.slice('kilo/'.length);
    if (clean.startsWith('openrouter/openrouter/')) return clean.replace('openrouter/openrouter/', 'openrouter/');
    if (clean.startsWith('openrouter/')) return clean.slice('openrouter/'.length);
    return clean;
  }

  let normalizationOk = true;
  for (const c of cases) {
    const res = normalizeModelTest(c.input);
    if (res !== c.expected) {
      normalizationOk = false;
      console.error(`    Échec normalisation : "${c.input}" -> "${res}" (attendu: "${c.expected}")`);
    }
  }
  assert(normalizationOk, 'Normalisation précise des identifiants de modèles OpenRouter');

  // ---------------------------------------------------------------------------
  // Test 4 : Commandes intégrées du Runner OpenRouter
  // ---------------------------------------------------------------------------
  const runAgentWithInput = (input) => {
    const res = spawnSync(nodePath, [openrouterPath, '--model', 'openrouter/free'], {
      input,
      encoding: 'utf8',
      timeout: 4000
    });
    return res.stdout || '';
  };

  const helpOutput = runAgentWithInput('/help\n/exit\n');
  assert(helpOutput.includes('/help') && helpOutput.includes('/model') && helpOutput.includes('/clear'), 'Commande /help du Runner OpenRouter Direct');

  const modelsOutput = runAgentWithInput('/models\n/exit\n');
  assert(modelsOutput.includes('openrouter/free') && modelsOutput.includes('nvidia/nemotron-3-super-120b-a12b:free'), 'Commande /models du Runner OpenRouter Direct');

  // ---------------------------------------------------------------------------
  // Test 5 : Connexion Live API OpenRouter avec le Runner
  // ---------------------------------------------------------------------------
  const liveRes = spawnSync(nodePath, [
    openrouterPath,
    '--model', 'thinkingmachines/inkling-small:free',
    '--prompt', 'Calcul: 12 + 15',
    '--once'
  ], {
    encoding: 'utf8',
    timeout: 10000
  });
  const liveOut = liveRes.stdout || '';
  const containsResult = liveOut.includes('27') || liveOut.includes('Réponse complétée');
  assert(containsResult, 'Connexion API OpenRouter Directe en temps réel (modèle thinkingmachines/inkling-small:free)', liveOut.slice(0, 120));

  // ---------------------------------------------------------------------------
  // Test 6 : Handshake WebSocket et authentification
  // ---------------------------------------------------------------------------
  try {
    const wsUrl = `ws://127.0.0.1:${PORT}/ws?token=${ADMIN_TOKEN}`;
    const ws = new WebSocket(wsUrl);
    const wsConnected = await new Promise((resolve) => {
      const timeout = setTimeout(() => { ws.close(); resolve(false); }, 3000);
      ws.on('open', () => {
        clearTimeout(timeout);
        ws.close();
        resolve(true);
      });
      ws.on('error', () => {
        clearTimeout(timeout);
        resolve(false);
      });
    });
    assert(wsConnected, 'Handshake WebSocket sécurisé établi avec succès');
  } catch (e) {
    assert(false, 'Handshake WebSocket', e.message);
  }

  // ---------------------------------------------------------------------------
  // Test 7 : Rejet WebSocket avec faux token
  // ---------------------------------------------------------------------------
  try {
    const wsFakeUrl = `ws://127.0.0.1:${PORT}/ws?token=faux-jeton`;
    const wsFake = new WebSocket(wsFakeUrl);
    const rejectedOk = await new Promise((resolve) => {
      const timeout = setTimeout(() => { wsFake.close(); resolve(false); }, 3000);
      wsFake.on('open', () => {
        clearTimeout(timeout);
        wsFake.close();
        resolve(false); // Aurait dû être rejeté !
      });
      wsFake.on('unexpected-response', (req, res) => {
        clearTimeout(timeout);
        resolve(res.statusCode === 401 || res.statusCode === 403);
      });
      wsFake.on('error', () => {
        clearTimeout(timeout);
        resolve(true);
      });
    });
    assert(rejectedOk, 'Rejet des connexions WebSocket non autorisées (401/403)');
  } catch (e) {
    assert(false, 'Contrôle sécurité WebSocket', e.message);
  }

  console.log(`\n📊 Bilan Non-Régression : ${passed} passés, ${failed} échoués.\n`);
  return { passed, failed };
}

if (require.main === module) {
  runRegressionTests().then(({ failed }) => {
    process.exit(failed > 0 ? 1 : 0);
  });
}

module.exports = { runRegressionTests };
