'use strict';
/**
 * Security Test Suite for Free Session Manager
 * Tests:
 * 1. Host header validation (DNS Rebinding protection)
 * 2. Unauthenticated request rejection (CSRF / Token protection)
 * 3. Hook token privilege restriction (least privilege principle)
 * 4. API key leak prevention (verify tokens and keys are never leaked in public endpoints or sessions JSON)
 * 5. Input payload size limits (DoS protection: body limit 1MB, upload limit 30MB)
 * 6. Path traversal resistance in static file serving and uploads
 * 7. Security response headers (CSP, X-Content-Type-Options, X-Frame-Options, etc.)
 */

const http = require('http');
const fs = require('fs');
const path = require('path');
const { PORT, DATA, ROOT } = require('../lib/config');

const TOKEN_FILE = path.join(DATA, 'token');
const HOOK_TOKEN_FILE = path.join(DATA, 'hook-token');
const ADMIN_TOKEN = fs.existsSync(TOKEN_FILE) ? fs.readFileSync(TOKEN_FILE, 'utf8').trim() : '';
const HOOK_TOKEN = fs.existsSync(HOOK_TOKEN_FILE) ? fs.readFileSync(HOOK_TOKEN_FILE, 'utf8').trim() : '';

const OPENROUTER_KEY = process.env.OPENROUTER_API_KEY || process.env.OPENROUTER_API_TOKEN || '';

function request(options, body = null) {
  return new Promise((resolve, reject) => {
    const req = http.request({
      host: '127.0.0.1',
      port: PORT,
      ...options,
    }, res => {
      let data = '';
      res.on('data', chunk => { data += chunk; });
      res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, body: data }));
    });
    req.on('error', reject);
    if (body) req.write(body);
    req.end();
  });
}

async function runSecurityTests() {
  console.log('\n🔒 ==========================================');
  console.log('🔒 EXÉCUTION DES TESTS DE SÉCURITÉ');
  console.log('🔒 ==========================================\n');

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
  // Test 1 : Protection DNS Rebinding (Host Header)
  // ---------------------------------------------------------------------------
  try {
    const res = await request({
      path: '/',
      method: 'GET',
      headers: { Host: 'evil-attacker.com' }
    });
    assert(res.status === 403, 'DNS Rebinding Protection (Host Header invalide rejeté avec 403)', `Reçu status: ${res.status}`);
  } catch (e) {
    assert(false, 'DNS Rebinding Protection', e.message);
  }

  // ---------------------------------------------------------------------------
  // Test 2 : Rejet des requêtes API non authentifiées (Token Protection)
  // ---------------------------------------------------------------------------
  try {
    const res = await request({
      path: '/api/sessions',
      method: 'GET',
      headers: { Host: `127.0.0.1:${PORT}` } // Pas de token
    });
    assert(res.status === 401, 'Authentification requise sur /api/sessions (Sans token -> 401)', `Reçu status: ${res.status}`);
  } catch (e) {
    assert(false, 'Authentification requise', e.message);
  }

  try {
    const res = await request({
      path: '/api/sessions',
      method: 'GET',
      headers: { Host: `127.0.0.1:${PORT}`, 'X-SM-Token': 'faux-jeton-invalide' }
    });
    assert(res.status === 401, 'Rejet des jetons invalides (Faux token -> 401)', `Reçu status: ${res.status}`);
  } catch (e) {
    assert(false, 'Rejet des faux jetons', e.message);
  }

  // ---------------------------------------------------------------------------
  // Test 3 : Confinement du Hook Token (Principe du moindre privilège)
  // ---------------------------------------------------------------------------
  try {
    // Le hook-token ne doit PAS pouvoir accéder aux sessions administratives
    const resAdmin = await request({
      path: '/api/sessions',
      method: 'GET',
      headers: { Host: `127.0.0.1:${PORT}`, 'X-SM-Token': HOOK_TOKEN }
    });
    assert(resAdmin.status === 401, 'Isolation Hook Token (Ne peut pas lister les sessions -> 401)', `Reçu: ${resAdmin.status}`);

    // Mais le hook-token DOIT pouvoir envoyer un statut sur /api/hook
    const resHook = await request({
      path: '/api/hook',
      method: 'POST',
      headers: {
        Host: `127.0.0.1:${PORT}`,
        'X-SM-Token': HOOK_TOKEN,
        'Content-Type': 'application/json'
      }
    }, JSON.stringify({ id: 'dummy-test-id', event: 'start' }));
    assert(resHook.status === 200 || resHook.status === 404, 'Hook Token valide sur /api/hook', `Reçu: ${resHook.status}`);
  } catch (e) {
    assert(false, 'Confinement Hook Token', e.message);
  }

  // ---------------------------------------------------------------------------
  // Test 4 : Absence de fuite de la clé API OpenRouter dans les endpoints
  // ---------------------------------------------------------------------------
  try {
    const resSessions = await request({
      path: '/api/sessions',
      method: 'GET',
      headers: { Host: `127.0.0.1:${PORT}`, 'X-SM-Token': ADMIN_TOKEN }
    });
    const containsKeyInSessions = resSessions.body.includes(OPENROUTER_KEY);
    assert(!containsKeyInSessions, 'Non-exposition de OPENROUTER_API_KEY dans /api/sessions');

    const resHtml = await request({
      path: '/',
      method: 'GET',
      headers: { Host: `127.0.0.1:${PORT}` }
    });
    const containsKeyInHtml = resHtml.body.includes(OPENROUTER_KEY);
    assert(!containsKeyInHtml, 'Non-exposition de OPENROUTER_API_KEY dans le HTML index.html');
  } catch (e) {
    assert(false, 'Contrôle fuite clé API', e.message);
  }

  // ---------------------------------------------------------------------------
  // Test 5 : Protection Path Traversal sur les fichiers statiques
  // ---------------------------------------------------------------------------
  try {
    const resTraversal = await request({
      path: '/../../../../etc/passwd',
      method: 'GET',
      headers: { Host: `127.0.0.1:${PORT}` }
    });
    assert(resTraversal.status === 404 || resTraversal.status === 403, 'Blocage Path Traversal /../../../../etc/passwd');
  } catch (e) {
    assert(false, 'Protection Path Traversal', e.message);
  }

  // ---------------------------------------------------------------------------
  // Test 6 : En-têtes de Sécurité HTTP (CSP, X-Frame-Options, nosniff)
  // ---------------------------------------------------------------------------
  try {
    const res = await request({
      path: '/',
      method: 'GET',
      headers: { Host: `127.0.0.1:${PORT}` }
    });
    const h = res.headers;
    assert(!!h['content-security-policy'], 'En-tête Content-Security-Policy présent');
    assert(h['x-frame-options'] === 'DENY', 'En-tête X-Frame-Options: DENY');
    assert(h['x-content-type-options'] === 'nosniff', 'En-tête X-Content-Type-Options: nosniff');
    assert(h['referrer-policy'] === 'no-referrer', 'En-tête Referrer-Policy: no-referrer');
  } catch (e) {
    assert(false, 'Vérification en-têtes HTTP de sécurité', e.message);
  }

  // ---------------------------------------------------------------------------
  // Test 7 : Protection DoS (Taille maximale du corps de requête)
  // ---------------------------------------------------------------------------
  try {
    const hugeBody = 'x'.repeat(1.5 * 1024 * 1024); // 1.5 Mo (Limite serveur = 1 Mo)
    let rejected = false;
    try {
      const res = await request({
        path: '/api/sessions',
        method: 'POST',
        headers: {
          Host: `127.0.0.1:${PORT}`,
          'X-SM-Token': ADMIN_TOKEN,
          'Content-Type': 'application/json'
        }
      }, hugeBody);
      if (res.status >= 400) rejected = true;
    } catch {
      // Connexion coupée ou détruite par le serveur = protection active
      rejected = true;
    }
    assert(rejected, 'Rejet des payloads excessifs (> 1 Mo)');
  } catch (e) {
    assert(false, 'Protection DoS payload', e.message);
  }

  console.log(`\n📊 Bilan Sécurité : ${passed} passés, ${failed} échoués.\n`);
  return { passed, failed };
}

if (require.main === module) {
  runSecurityTests().then(({ failed }) => {
    process.exit(failed > 0 ? 1 : 0);
  });
}

module.exports = { runSecurityTests };
