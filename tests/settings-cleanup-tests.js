'use strict';
/**
 * Nettoyage v1.1.0 : réglages hérités (claude/agy), modèles, transcripts natifs, usage.
 * S'exécute dans un processus enfant pour isoler DATA (lib/config lit FSM_DATA au chargement).
 */
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');

const ROOT = path.join(__dirname, '..');

// ---------------------------------------------------------------- partie enfant
async function child() {
  const DATA = process.env.FSM_DATA;
  const results = [];
  const assert = (cond, name, detail) => results.push({ ok: !!cond, name, detail: cond ? '' : String(detail ?? '') });

  const routes = [];
  const out = {};
  const ctx = {
    DATA, sessions: new Map(), broadcast() { }, persist() { }, publicView: s => s, history: () => [],
    route: (method, re, fn) => routes.push({ method, re, fn }),
    json: (res, code, body) => { res.code = code; res.body = body; },
    readBody: async req => req.body,
  };
  const call = async (method, url, body) => {
    const r = routes.find(x => x.method === method && x.re.test(url));
    if (!r) return { code: 404 };
    const res = {};
    await r.fn({ req: { body }, res, m: url.match(r.re) });
    return res;
  };

  // Réglages hérités persistés
  fs.writeFileSync(path.join(DATA, 'settings.json'), JSON.stringify({ defaultAgent: 'claude', theme: 'dark' }));
  require(path.join(ROOT, 'lib/settings.js'))(ctx);
  let r = await call('GET', '/api/settings');
  assert(r.body.defaultAgent === 'kilo', "defaultAgent hérité 'claude' → 'kilo'", r.body.defaultAgent);
  assert(r.body.theme === 'dark', 'réglage valide conservé', r.body.theme);
  r = await call('PUT', '/api/settings', { defaultAgent: 'agy' });
  assert(r.body.defaultAgent === 'kilo', "PUT defaultAgent 'agy' refusé", r.body.defaultAgent);
  r = await call('PUT', '/api/settings', { defaultAgent: 'opencode' });
  assert(r.body.defaultAgent === 'opencode', "PUT defaultAgent 'opencode' accepté", r.body.defaultAgent);
  r = await call('PUT', '/api/templates', [{ name: 'a', agent: 'claude' }, { name: 'b', agent: 'openrouter' }]);
  assert(r.body[0].agent === 'kilo', "modèle agent 'claude' → 'kilo'", r.body[0].agent);
  assert(r.body[1].agent === 'openrouter', "modèle agent 'openrouter' conservé", r.body[1].agent);

  // Transcript natif partagé
  const handoff = require(path.join(ROOT, 'lib/handoff.js'));
  const tdir = path.join(DATA, 'transcripts');
  fs.mkdirSync(tdir, { recursive: true });
  const now = new Date().toISOString();
  fs.writeFileSync(path.join(tdir, 'conv1.jsonl'),
    JSON.stringify({ role: 'user', content: 'Bonjour', timestamp: now }) + '\n' +
    JSON.stringify({ role: 'assistant', content: 'Salut !', timestamp: now }) + '\n');
  const f = handoff.transcriptFile('conv1');
  assert(f && f.startsWith(tdir), 'transcriptFile trouve DATA/transcripts', f);
  assert(handoff.transcriptFile('../x') === null, 'transcriptFile rejette un id invalide');
  assert(handoff.transcriptFile('absent') === null, 'transcriptFile : null si absent');
  const turns = handoff.parseConversation(f);
  assert(turns.length === 2 && turns[0].role === 'user' && turns[1].role === 'agent', 'parseConversation : 2 tours user/agent', JSON.stringify(turns));
  const brief = handoff.buildBriefing({ file: f, from: 'kilo', to: 'opencode', sessionName: 's', cwd: '/tmp' });
  assert(brief && brief.markdown.includes('Bonjour') && brief.stats.turns === 2, 'buildBriefing inclut le contexte');
  assert(!Object.values(handoff.AGENT_LABEL).some(l => /claude|antigravity/i.test(l)), 'AGENT_LABEL sans agents hérités');

  // Usage : chargement + session native
  routes.length = 0;
  ctx.sessions.set('s1', { id: 's1', conversationId: 'conv1', agent: 'opencode', name: 'Test' });
  require(path.join(ROOT, 'lib/usage.js'))(ctx);
  r = await call('GET', '/api/sessions/s1/usage');
  assert(r.code === 200, 'usage session native : 200', r.code);
  r = await call('GET', '/api/sessions/s1/export');
  if (r.code !== 404) assert(String(r.body || '').includes('## 🧑 Vous') || r.code === 200, 'export Markdown natif');

  // Plus de modules hérités
  for (const gone of ['lib/agy-cli.js', 'bin/asm.js', 'hook.js'])
    assert(!fs.existsSync(path.join(ROOT, gone)), `${gone} supprimé`);
  const agents = require(path.join(ROOT, 'lib/agents.js'));
  assert(!Object.keys(agents).some(k => /claude|agy/i.test(k)), 'lib/agents.js sans exports hérités', Object.keys(agents));

  process.stdout.write(JSON.stringify(results));
}

// ---------------------------------------------------------------- partie parent
async function runSettingsCleanupTests() {
  console.log('\n🧹 TESTS DE NETTOYAGE (réglages hérités, transcripts natifs, usage)');
  let passed = 0, failed = 0;
  const DATA = fs.mkdtempSync(path.join(os.tmpdir(), 'fsm-cleanup-'));
  try {
    const raw = execFileSync(process.execPath, [__filename, '--child'], {
      env: { ...process.env, FSM_DATA: DATA, SM_PORT: '7899' }, encoding: 'utf8', timeout: 30000,
    });
    for (const t of JSON.parse(raw.slice(raw.indexOf('[')))) {
      if (t.ok) { passed++; console.log(`  ✅ ${t.name}`); }
      else { failed++; console.log(`  ❌ ${t.name}${t.detail ? ` — ${t.detail}` : ''}`); }
    }
  } catch (e) {
    failed++; console.log(`  ❌ exécution du sous-processus — ${e.message}`);
  } finally {
    fs.rmSync(DATA, { recursive: true, force: true });
  }
  return { passed, failed };
}

if (process.argv.includes('--child')) child().catch(e => { console.error(e); process.exit(1); });
module.exports = { runSettingsCleanupTests };
