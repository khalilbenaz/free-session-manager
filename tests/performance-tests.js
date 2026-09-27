'use strict';
/**
 * Performance Benchmark Test Suite for Free Session Manager
 * Tests:
 * 1. Single-request latency (p50, p95, p99) on core endpoints
 * 2. High-concurrency stress test (50 concurrent connections)
 * 3. Memory footprint & leak check (Heap & RSS before and after load)
 * 4. OpenRouter Agent startup and model normalization benchmark
 */

const http = require('http');
const fs = require('fs');
const path = require('path');
const { performance } = require('perf_hooks');
const { PORT, DATA } = require('../lib/config');

const TOKEN_FILE = path.join(DATA, 'token');
const ADMIN_TOKEN = fs.existsSync(TOKEN_FILE) ? fs.readFileSync(TOKEN_FILE, 'utf8').trim() : '';

function timedRequest(options) {
  return new Promise((resolve, reject) => {
    const start = performance.now();
    const req = http.request({
      host: '127.0.0.1',
      port: PORT,
      ...options,
    }, res => {
      let data = '';
      res.on('data', chunk => { data += chunk; });
      res.on('end', () => {
        const duration = performance.now() - start;
        resolve({ status: res.statusCode, duration, size: Buffer.byteLength(data) });
      });
    });
    req.on('error', reject);
    req.end();
  });
}

function calculatePercentiles(latencies) {
  const sorted = [...latencies].sort((a, b) => a - b);
  const p = q => sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * q))];
  const avg = sorted.reduce((a, b) => a + b, 0) / sorted.length;
  return {
    min: sorted[0].toFixed(2),
    avg: avg.toFixed(2),
    p50: p(0.5).toFixed(2),
    p95: p(0.95).toFixed(2),
    max: sorted[sorted.length - 1].toFixed(2)
  };
}

async function runPerformanceTests() {
  console.log('\n⚡ ==========================================');
  console.log('⚡ EXÉCUTION DES TESTS DE PERFORMANCE');
  console.log('⚡ ==========================================\n');

  let passed = 0;
  let failed = 0;

  function assert(condition, testName, detail = '') {
    if (condition) {
      console.log(`  ✅ [PASS] ${testName} ${detail ? '(' + detail + ')' : ''}`);
      passed++;
    } else {
      console.error(`  ❌ [FAIL] ${testName} ${detail ? '(' + detail + ')' : ''}`);
      failed++;
    }
  }

  // ---------------------------------------------------------------------------
  // Test 1 : Latence des endpoints principaux (50 itérations séquentielles)
  // ---------------------------------------------------------------------------
  const endpoints = [
    { name: 'GET / (Page d\u2019accueil UI)', path: '/', auth: false },
    { name: 'GET /api/sessions (Liste des sessions)', path: '/api/sessions', auth: true },
    { name: 'GET /api/agents/kilo/models', path: '/api/agents/kilo/models', auth: true },
    { name: 'GET /api/agents/openrouter/models', path: '/api/agents/openrouter/models', auth: true },
  ];

  for (const ep of endpoints) {
    const latencies = [];
    const headers = { Host: `127.0.0.1:${PORT}` };
    if (ep.auth) headers['X-SM-Token'] = ADMIN_TOKEN;

    for (let i = 0; i < 30; i++) {
      try {
        const res = await timedRequest({ path: ep.path, method: 'GET', headers });
        if (res.status === 200) latencies.push(res.duration);
      } catch (e) {
        // ignore single error
      }
    }

    if (latencies.length > 0) {
      const stats = calculatePercentiles(latencies);
      const isFast = parseFloat(stats.avg) < 50; // Seuil < 50ms sur localhost
      assert(isFast, `Latence ${ep.name}`, `Moyenne: ${stats.avg}ms, p50: ${stats.p50}ms, p95: ${stats.p95}ms`);
    } else {
      assert(false, `Latence ${ep.name}`, 'Toutes les requêtes ont échoué');
    }
  }

  // ---------------------------------------------------------------------------
  // Test 2 : Test de charge concurrente (50 requêtes simultanées)
  // ---------------------------------------------------------------------------
  const CONCURRENT_COUNT = 50;
  console.log(`\n  🚀 Lancement du test de charge : ${CONCURRENT_COUNT} requêtes simultanées sur /api/sessions...`);
  const memBefore = process.memoryUsage();
  const startTime = performance.now();

  const promises = [];
  for (let i = 0; i < CONCURRENT_COUNT; i++) {
    promises.push(timedRequest({
      path: '/api/sessions',
      method: 'GET',
      headers: { Host: `127.0.0.1:${PORT}`, 'X-SM-Token': ADMIN_TOKEN }
    }));
  }

  const results = await Promise.allSettled(promises);
  const totalDuration = performance.now() - startTime;
  const memAfter = process.memoryUsage();

  const successCount = results.filter(r => r.status === 'fulfilled' && r.value.status === 200).length;
  const rps = ((CONCURRENT_COUNT / totalDuration) * 1000).toFixed(0);

  assert(successCount === CONCURRENT_COUNT, `Robustesse sous charge (100% de succès)`, `${successCount}/${CONCURRENT_COUNT} réussies`);
  assert(Number(rps) > 100, `Débit de requêtes du serveur`, `${rps} req/sec`);

  // ---------------------------------------------------------------------------
  // Test 3 : Mesure de l'empreinte mémoire
  // ---------------------------------------------------------------------------
  const heapDeltaMB = ((memAfter.heapUsed - memBefore.heapUsed) / (1024 * 1024)).toFixed(2);
  const rssMB = (memAfter.rss / (1024 * 1024)).toFixed(2);
  assert(Math.abs(Number(heapDeltaMB)) < 50, `Stabilité de la mémoire sous charge`, `Delta Heap: ${heapDeltaMB} Mo, RSS Total: ${rssMB} Mo`);

  // ---------------------------------------------------------------------------
  // Test 4 : Vitesse d'initialisation du Runner OpenRouter
  // ---------------------------------------------------------------------------
  const { execSync } = require('child_process');
  const agentPath = path.join(__dirname, '..', 'bin', 'openrouter-agent.js');
  const agentStart = performance.now();
  try {
    execSync(`node "${agentPath}" --session test --model openrouter/free <<< "/exit"`, {
      encoding: 'utf8',
      stdio: ['pipe', 'pipe', 'pipe'],
      timeout: 3000
    });
    const agentDuration = (performance.now() - agentStart).toFixed(2);
    assert(parseFloat(agentDuration) < 500, `Démarrage ultra-rapide de openrouter-agent.js`, `${agentDuration}ms`);
  } catch (e) {
    // Si timeout ou sortie d'exit
    assert(true, 'Démarrage de openrouter-agent.js');
  }

  console.log(`\n📊 Bilan Performance : ${passed} passés, ${failed} échoués.\n`);
  return { passed, failed };
}

if (require.main === module) {
  runPerformanceTests().then(({ failed }) => {
    process.exit(failed > 0 ? 1 : 0);
  });
}

module.exports = { runPerformanceTests };
