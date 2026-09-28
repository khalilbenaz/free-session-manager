'use strict';
// Free Session Manager — serveur local : héberge N sessions d'agents natifs (kilo / opencode / openrouter, PTY) et les expose à une UI web.
const http = require('http');
const fs = require('fs');
const path = require('path');
const os = require('os');
const crypto = require('crypto');
const { execFile } = require('child_process');
const pty = require('node-pty');
const { WebSocketServer } = require('ws');
const {
  ROOT, PORT, IS_WIN, IS_MAC, DATA, LEGACY_DATA,
  which, resolveNode, resolveKilo, resolveOpencode, resolveOpenrouter, resolveDirectAgent,
} = require('./lib/config');
const handoff = require('./lib/handoff');

const HOST = '127.0.0.1';
const VERSION = require('./package.json').version;
const UPLOADS = path.join(os.tmpdir(), 'sm-uploads');
const UPLOAD_MAX = 30 * 1024 * 1024;
const SCROLLBACK_MAX = 2 * 1024 * 1024;

fs.mkdirSync(DATA, { recursive: true });

// Journal fichier, avec rotation simple (5 Mo → server.log.1)
const LOG = path.join(DATA, 'server.log');
let logSize = 0;
try { logSize = fs.statSync(LOG).size; } catch { }
for (const k of ['log', 'error']) {
  const orig = console[k];
  console[k] = (...a) => {
    try {
      const line = `${new Date().toISOString()} ${a.map(x => x instanceof Error ? x.stack : String(x)).join(' ')}\n`;
      if (logSize + line.length > 5 * 1024 * 1024) { try { fs.renameSync(LOG, LOG + '.1'); } catch { } logSize = 0; }
      logSize += line.length;
      fs.appendFileSync(LOG, line);
    } catch { }
    orig.apply(console, a);
  };
}
process.on('uncaughtException', e => console.error('uncaught', e));
process.on('unhandledRejection', e => console.error('unhandled', e));

// Jeton anti-CSRF
const TOKEN_FILE = path.join(DATA, 'token');
const TOKEN = fs.existsSync(TOKEN_FILE)
  ? fs.readFileSync(TOKEN_FILE, 'utf8').trim()
  : (() => { const t = crypto.randomBytes(24).toString('hex'); fs.writeFileSync(TOKEN_FILE, t); return t; })();

// Jeton à portée réduite, injecté dans l'environnement des agents natifs : il n'ouvre
// que /api/hook (statuts). Tout processus enfant d'un agent ne peut donc pas piloter l'API.
const HOOK_TOKEN_FILE = path.join(DATA, 'hook-token');
const HOOK_TOKEN = fs.existsSync(HOOK_TOKEN_FILE)
  ? fs.readFileSync(HOOK_TOKEN_FILE, 'utf8').trim()
  : (() => { const t = crypto.randomBytes(24).toString('hex'); fs.writeFileSync(HOOK_TOKEN_FILE, t); return t; })();

const NODE_BIN = resolveNode();
const KILO = resolveKilo();
const OPENCODE = resolveOpencode();
const OPENROUTER = resolveOpenrouter();
const DIRECT_AGENT = resolveDirectAgent();
// ---------------------------------------------------------------- sessions gérées
const STORE = path.join(DATA, 'sessions.json');
const TITLES_FILE = path.join(DATA, 'titles.json');
/** @type {Map<string, any>} */
const sessions = new Map();

function loadCustomTitles() {
  try { return JSON.parse(fs.readFileSync(TITLES_FILE, 'utf8')); } catch { return {}; }
}
function writeCustomTitle(id, title) {
  let ok = false;
  try {
    const t = loadCustomTitles();
    t[id] = title;
    fs.writeFileSync(TITLES_FILE, JSON.stringify(t, null, 2));
    ok = true;
  } catch { }
  return ok;
}

const EXTRA_FIELDS = ['agent', 'group', 'pinned', 'color', 'worktree', 'queue', 'alerts', 'model', 'mode', 'effort', 'agentIds', 'agentCfg', 'switches'];
const extra = s => Object.fromEntries(EXTRA_FIELDS.filter(k => s[k] !== undefined).map(k => [k, s[k]]));

function persistNow() {
  const list = [...sessions.values()].map(s => ({
    id: s.id, agent: s.agent || 'kilo', name: s.name, cwd: s.cwd, args: s.args,
    conversationId: s.conversationId, claudeSessionId: s.claudeSessionId,
    createdAt: s.createdAt, order: s.order, wantRun: s.wantRun !== false, named: !!s.named, titleFor: s.titleFor || null,
    ...extra(s), ...(s.lock ? { lock: s.lock } : {}),
  }));
  // Écriture atomique (tmp + rename) : un crash ne doit jamais corrompre sessions.json.
  const tmp = `${STORE}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(list, null, 2));
  fs.renameSync(tmp, STORE);
}
// persist() est appelé à chaque événement (hook, statut, bascule…) : on diffère l'écriture
// pour ne pas réécrire tout le JSON en boucle sur la boucle d'événements.
let persistTimer = null;
function persist() {
  if (persistTimer) return;
  persistTimer = setTimeout(() => { persistTimer = null; try { persistNow(); } catch (e) { console.error('persistance :', e.message); } }, 300);
}

function publicView(s) {
  return {
    id: s.id, agent: s.agent || 'kilo', name: s.name, cwd: s.cwd, args: s.args, status: s.status, message: s.message,
    conversationId: s.conversationId, claudeSessionId: s.claudeSessionId,
    createdAt: s.createdAt, lastActivity: s.lastActivity,
    statusSince: s.statusSince, alive: !!s.pty, order: s.order, ...extra(s),
    ...(s.lock ? { locked: true, lockHint: s.lock.hint || '', message: '', queue: s.queue ? s.queue.map(q => ({ id: q.id, text: '' })) : undefined } : {}),
  };
}

function setStatus(s, status, message) {
  if (s.status === status && s.message === message) return;
  s.status = status;
  s.message = message || '';
  s.statusSince = Date.now();
  broadcast({ t: 'session', s: publicView(s) });
}

function splitArgs(str) {
  const out = []; const re = /"([^"]*)"|'([^']*)'|(\S+)/g; let m;
  while ((m = re.exec(str || ''))) out.push(m[1] ?? m[2] ?? m[3]);
  return out;
}

// Transcript natif commun aux trois runners (bin/direct-agent.js).
const TRANSCRIPTS = path.join(DATA, 'transcripts');
function transcriptPath(id) {
  if (!/^[\w-]+$/.test(id || '')) return null;
  const f = path.join(TRANSCRIPTS, `${id}.jsonl`);
  return fs.existsSync(f) ? f : null;
}

// Conversation portée par une session : celle reprise depuis l'historique, sinon la sienne.
const convOf = s => s.conversationId || s.claudeSessionId || s.id;

function renameSession(s, name) {
  s.name = String(name || s.name).trim().slice(0, 80) || s.name;
  s.named = true;
  const cId = s.conversationId || s.claudeSessionId;
  s.titleFor = cId && writeCustomTitle(cId, s.name) ? cId : null;
  persist();
  broadcast({ t: 'session', s: publicView(s) });
}

function handleTerminalQueries(s, p, data) {
  if (!p || typeof data !== 'string') return;
  // Device Status Report cursor query (\x1b[6n)
  if (data.includes('\x1b[6n')) {
    try { p.write('\x1b[1;1R'); } catch { }
  }
  // Primary Device Attributes (\x1b[c)
  if (data.includes('\x1b[c')) {
    try { p.write('\x1b[?62;1;2;4;6;7;8;9;15;18;21;22c'); } catch { }
  }
  // Kitty keyboard protocol query (\x1b[?u)
  if (data.includes('\x1b[?u')) {
    try { p.write('\x1b[?0u'); } catch { }
  }
  // XTVERSION query (\x1b[>0q or \x1b[>q)
  if (data.includes('\x1b[>0q') || data.includes('\x1b[>q')) {
    try { p.write('\x1bP>|xterm(388)\x1b\\'); } catch { }
  }
  // DECRQSS query (\x1bP+q...\x1b\\)
  if (data.includes('\x1bP+q')) {
    try { p.write('\x1bP0$r\x1b\\'); } catch { }
  }
  // DECRQM queries (\x1b[?...$p)
  const decrqm = data.match(/\x1b\[\?(\d+)\$p/g);
  if (decrqm) {
    try {
      for (const m of decrqm) {
        const mode = m.match(/\d+/)[0];
        p.write(`\x1b[?${mode};2$y`);
      }
    } catch { }
  }
  // Window size in pixels (\x1b[14t)
  if (data.includes('\x1b[14t')) {
    const cols = s.cols || 120;
    const rows = s.rows || 32;
    try { p.write(`\x1b[4;${rows * 16};${cols * 8}t`); } catch { }
  }
  // Foreground / Background color queries (OSC 10 / 11)
  if (data.includes('\x1b]10;?')) {
    try { p.write('\x1b]10;rgb:ffff/ffff/ffff\x1b\\'); } catch { }
  }
  if (data.includes('\x1b]11;?')) {
    try { p.write('\x1b]11;rgb:1010/1111/1414\x1b\\'); } catch { }
  }
  if (data.includes('\x1b]12;?')) {
    try { p.write('\x1b]12;rgb:ffff/ffff/ffff\x1b\\'); } catch { }
  }
  // Palette color queries (OSC 4;idx;?)
  const osc4 = data.match(/\x1b\]4;(\d+);\?/g);
  if (osc4 && osc4.length) {
    let rep = '';
    for (const m of osc4) {
      const idx = m.match(/\d+/)[0];
      rep += `\x1b]4;${idx};rgb:8080/8080/8080\x1b\\`;
    }
    try { p.write(rep); } catch { }
  }
  // Kitty Graphics probe
  if (data.includes('\x1b_Gi=31337')) {
    try { p.write('\x1b_Gi=31337;OK\x1b\\'); } catch { }
  }
}

function spawnSession(s, { resume, fork } = {}) {
  // Les trois agents (kilo/opencode/openrouter) sont tous natifs et lancés via
  // le runner générique bin/direct-agent.js --provider <agent>, exécuté par
  // notre propre Node.js (NODE_BIN). Plus aucune dépendance à un binaire CLI
  // tiers (KILO/OPENCODE ne servent plus qu'à la détection dans lib/agents.js
  // et au repli natif interne de direct-agent.js pour OpenCode).
  const VALID_AGENTS = ['kilo', 'opencode', 'openrouter'];
  const agent = VALID_AGENTS.includes(s.agent) ? s.agent : 'kilo';
  const isOpencode = agent === 'opencode';
  const isOpenrouter = agent === 'openrouter';
  const binary = NODE_BIN;

  let explicitModel = s.model || '';
  let explicitEffort = s.effort || '';
  let explicitMode = s.mode || '';
  const extraArgs = [];
  const firstPrompt = s.initialPrompt || '';

  const splitUserArgs = splitArgs(s.args || '');
  for (let i = 0; i < splitUserArgs.length; i++) {
    const a = splitUserArgs[i];
    if (a === '--model' && i + 1 < splitUserArgs.length) {
      const val = splitUserArgs[++i];
      if (!explicitModel) explicitModel = val;
    } else if (a.startsWith('--model=')) {
      if (!explicitModel) explicitModel = a.slice(8);
    } else if (a === '--effort' && i + 1 < splitUserArgs.length) explicitEffort = splitUserArgs[++i];
    else if (a.startsWith('--effort=')) explicitEffort = a.slice(9);
    else if (a === '--mode' && i + 1 < splitUserArgs.length) explicitMode = splitUserArgs[++i];
    else if (a.startsWith('--mode=')) explicitMode = a.slice(7);
    else if (a === '--dangerously-skip-permissions') explicitMode = 'dangerously-skip-permissions';
    else extraArgs.push(a);
  }

  const defaultModel = agentDefaults(agent).model;
  const effectiveModel = explicitModel || defaultModel;
  s.model = effectiveModel;

  const args = [DIRECT_AGENT, '--provider', agent];

  const rawArgsEnv = isOpencode ? 'SM_OPENCODE_ARGS' : (isOpenrouter ? 'SM_OPENROUTER_ARGS' : 'SM_KILO_ARGS');
  const rawArgs = splitArgs(process.env[rawArgsEnv] || '');
  args.push(...rawArgs);
  args.push('--session', resume || convOf(s));
  args.push('--model', effectiveModel);
  if (firstPrompt) {
    args.push('--prompt', firstPrompt);
  }

  args.push(...extraArgs);

  const openrouterKey = process.env.OPENROUTER_API_KEY || process.env.OPENROUTER_API_TOKEN || '';
  const env = {
    ...process.env,
    SM_ID: s.id,
    SM_AGENT: agent,
    SM_PORT: String(PORT),
    SM_TOKEN: HOOK_TOKEN,
    FSM_ID: s.id,
    FSM_PORT: String(PORT),
    FSM_TOKEN: HOOK_TOKEN,
    OPENROUTER_API_KEY: openrouterKey,
    OPENROUTER_API_TOKEN: openrouterKey,
    COLORTERM: 'truecolor',
  };
  if (process.env.KILO_API_KEY) env.KILO_API_KEY = process.env.KILO_API_KEY;
  if (process.env.OPENCODE_API_KEY) env.OPENCODE_API_KEY = process.env.OPENCODE_API_KEY;

  // Évite les propagations indésirables d'agents parents
  for (const k of Object.keys(env)) {
    if (/^(CLAUDECODE|CLAUDE_CODE_|CLAUDE_PID$|CLAUDE_EFFORT$|AI_AGENT$|ANTIGRAVITY_AGENT|ELECTRON_RUN_AS_NODE$)/i.test(k)) delete env[k];
  }
  if (binary === process.execPath && process.versions.electron) {
    env.ELECTRON_RUN_AS_NODE = '1';
  }

  let p;
  try {
    p = pty.spawn(binary, args, {
      name: 'xterm-256color', cols: s.cols || 120, rows: s.rows || 32,
      cwd: fs.existsSync(s.cwd) ? s.cwd : os.homedir(), env,
    });
  } catch (e) {
    s.pty = null;
    const name = isOpencode ? 'OpenCode' : (isOpenrouter ? 'OpenRouter' : 'Kilo');
    appendOut(s, `\r\n\x1b[31m[fsm] Échec du lancement de ${name} : ${e.message}\x1b[0m\r\n`);
    setStatus(s, 'exited', 'échec du lancement');
    return;
  }

  s.pty = p;
  if (firstPrompt) s.initialPrompt = '';
  if (s.wantRun !== true) { s.wantRun = true; persist(); }
  setStatus(s, 'starting');

  p.onData(d => {
    s.lastActivity = Date.now();
    handleTerminalQueries(s, p, d);
    appendOut(s, d);
    if (s.status === 'starting') setStatus(s, 'idle');
  });

  p.onExit(({ exitCode }) => {
    if (s.pty !== p || !sessions.has(s.id)) return;
    s.pty = null;
    setTimeout(() => {
      if (!shuttingDown && !s.pty && sessions.has(s.id)) { s.wantRun = false; persist(); }
    }, 8000);
    appendOut(s, `\r\n\x1b[90m[sm] session terminée (code ${exitCode})\x1b[0m\r\n`);
    setStatus(s, 'exited', `code ${exitCode}`);
  });
}

function appendOut(s, d) {
  s.buf += d;
  if (s.buf.length > SCROLLBACK_MAX) {
    let cut = s.buf.length - SCROLLBACK_MAX;
    const nl = s.buf.indexOf('\n', cut);
    s.buf = s.buf.slice(nl > 0 ? nl + 1 : cut);
  }
  const data = JSON.stringify({ t: 'out', id: s.id, d });
  for (const c of clients) if (c.readyState === 1 && (!s.lock || ctx.wsCan?.(s, c))) c.send(data);
}

function createSession({ name, cwd, args, resume, fork, model, mode, effort, agent, ...more }) {
  cwd = cwd ? path.resolve(cwd.replace(/^~(?=$|[\\/])/, os.homedir())) : os.homedir();
  const id = crypto.randomBytes(6).toString('hex');
  const order = Math.max(0, ...[...sessions.values()].map(x => x.order || 0)) + 1;
  const VALID_AGENTS = ['kilo', 'opencode', 'openrouter'];
  const chosenAgent = VALID_AGENTS.includes(agent) ? agent : (ctx.getSettings?.().defaultAgent || 'kilo');

  const s = {
    id, agent: chosenAgent, name: name || path.basename(cwd || '') || 'session', cwd: cwd || os.homedir(),
    args: args || '', model: model || '', mode: mode || '', effort: effort || '',
    conversationId: resume || null,
    claudeSessionId: resume || null,
    createdAt: Date.now(), lastActivity: Date.now(),
    status: 'starting', message: '', statusSince: Date.now(), buf: '', pty: null, order,
    ...Object.fromEntries(EXTRA_FIELDS.filter(k => more[k] !== undefined).map(k => [k, more[k]])),
  };
  if (more.initialPrompt) s.initialPrompt = String(more.initialPrompt).slice(0, 20000);
  sessions.set(id, s);
  spawnSession(s, { resume, fork });
  persist();
  broadcast({ t: 'session', s: publicView(s) });
  return s;
}

function killSession(s) {
  if (s.pty) { try { s.pty.kill(); } catch { } }
}

// ------------------------------------------------- bascule d'agent dans une même session
// Les trois agents natifs partagent le transcript de la session : la bascule relance
// simplement le runner avec un autre fournisseur sur la même conversation.
const AGENT_MODELS_MAP = {
  kilo: [
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
  ],
  opencode: [
    { value: 'opencode/nemotron-3-ultra-free', label: '💻 Nemotron 3 Ultra (Free)' },
    { value: 'opencode/nemotron-3.5-lightning-free', label: '💻 Nemotron 3.5 Lightning (Free)' },
    { value: 'opencode/ling-3.0-flash-fin-free', label: '💻 Ling 3.0 Flash Fin (Free)' },
    { value: 'opencode/longcat-2.5-preview-free', label: '💻 Longcat 2.5 Preview (Free)' },
    { value: 'opencode/mimo-v2.6-flash-free', label: '💻 Mimo v2.6 Flash (Free)' },
    { value: 'opencode/muse-spark-1.3-contributor-free', label: '💻 Muse Spark 1.3 Contributor (Free)' },
    { value: 'opencode/space-bunny-free', label: '💻 Space Bunny (Free)' },
    { value: 'opencode/big-pickle', label: '💻 Big Pickle (Free)' },
  ],
  openrouter: [
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
  ],
};

function agentDefaults(agent) {
  if (agent === 'opencode') {
    return {
      model: 'opencode/nemotron-3-ultra-free',
      effort: '',
      mode: '',
    };
  }
  if (agent === 'openrouter') {
    return {
      model: 'openrouter/openrouter/free',
      effort: '',
      mode: '',
    };
  }
  return {
    model: 'kilo/nvidia/nemotron-3-super-120b-a12b:free',
    effort: '',
    mode: '',
  };
}

function fitModel(agent, model) {
  return String(model || '').trim();
}

function switchAgent(s, to, override = {}) {
  const from = s.agent || 'kilo';

  // 1. Transmission du contexte. Les runners natifs partagent DATA/transcripts/<id>.jsonl
  // et le rechargent à la reprise : s'il existe, le contexte passe tel quel, sans
  // briefing (et le fichier n'est jamais réécrit). Sinon, on amorce la nouvelle session
  // avec un briefing construit depuis le tampon terminal, sans rien écrire sur disque.
  let brief = null;
  let stats = null;
  const file = handoff.transcriptFile(convOf(s));
  if (file) {
    const built = handoff.buildBriefing({ file, from, to, sessionName: s.name, cwd: s.cwd });
    if (built) stats = built.stats;
  } else if (s.buf && s.buf.length > 50) {
    const cleanBuf = s.buf.replace(/\x1b\[[0-9;?]*[a-zA-Z]/g, '').trim();
    if (cleanBuf.length > 20) {
      brief = `# Transfert de contexte : ${handoff.AGENT_LABEL[from] || from} → ${handoff.AGENT_LABEL[to] || to}\n\n`
        + `Voici la sortie de la session précédente (dossier \`${s.cwd || ''}\`). Poursuis le travail là où il s'est arrêté.\n\n`
        + '```\n' + cleanBuf.slice(-10000) + '\n```\n';
      stats = { chars: brief.length };
      s.initialPrompt = brief;
    }
  }

  killSession(s);
  s.pty = null;

  const cfg = s.agentCfg?.[to] || agentDefaults(to);
  if (override.model !== undefined) {
    s.agentCfg = { ...(s.agentCfg || {}), [to]: { ...cfg, model: override.model || '' } };
  }
  const useCfg = s.agentCfg?.[to] || cfg;
  s.agent = to;
  s.model = override.model || useCfg.model || agentDefaults(to).model;
  s.effort = useCfg.effort || '';
  s.mode = useCfg.mode || '';
  s.args = s.model ? `--model ${s.model}` : '';

  s.buf = '';
  broadcast({ t: 'clear', id: s.id });
  const AGENT_NAMES = { kilo: 'Kilo Free', opencode: 'OpenCode', openrouter: 'OpenRouter Free' };
  s.buf += `\x1b[90m[fsm] Bascule vers ${AGENT_NAMES[to] || to} · Modèle: ${s.model}${file ? ' · Contexte partagé' : (brief ? ' · Contexte transmis' : '')}\x1b[0m\r\n`;
  spawnSession(s);
  s.switches = [...(s.switches || []), { from, to, at: Date.now() }].slice(-20);
  persist();
  broadcast({ t: 'session', s: publicView(s) });
  return { session: s, brief, stats };
}

let shuttingDown = false;
const toRestore = [];
try {
  for (const x of JSON.parse(fs.readFileSync(STORE, 'utf8'))) {
    const s = {
      agent: x.agent || 'kilo', ...x,
      status: 'exited', message: 'arrêtée', statusSince: Date.now(), lastActivity: x.createdAt, buf: '', pty: null
    };
    sessions.set(x.id, s);
    if (x.wantRun !== false) toRestore.push(s);
    else s.buf = `\x1b[90m[sm] Session arrêtée. Cliquer « Reprendre » pour la relancer.\x1b[0m\r\n`;
  }
} catch { }

function restoreSessions() {
  toRestore.forEach((s, i) => setTimeout(() => {
    if (!sessions.has(s.id) || s.pty) return;
    s.buf = `\x1b[90m[sm] Session restaurée.\x1b[0m\r\n`;
    broadcast({ t: 'clear', id: s.id });
    spawnSession(s, { resume: s.conversationId || s.claudeSessionId || undefined });
  }, i * 1200));
}

// ---------------------------------------------------------------- historique (transcripts natifs)
const histCache = new Map();

function readSlice(fd, pos, len) {
  const b = Buffer.alloc(len); const n = fs.readSync(fd, b, 0, len, pos); return b.slice(0, n).toString('utf8');
}

function parseNativeTranscript(file, stat, id) {
  const fd = fs.openSync(file, 'r');
  try {
    const HEAD = 64 * 1024, TAIL = 64 * 1024;
    const head = readSlice(fd, 0, Math.min(HEAD, stat.size));
    const tail = stat.size > HEAD ? readSlice(fd, Math.max(0, stat.size - TAIL), Math.min(TAIL, stat.size)) : '';
    let firstPrompt = null, lastPrompt = null;
    for (const line of (head + '\n' + tail).split('\n')) {
      if (!line.startsWith('{')) continue;
      let o; try { o = JSON.parse(line); } catch { continue; }
      if (o.role === 'user' && typeof o.content === 'string' && o.content.trim()) {
        if (!firstPrompt) firstPrompt = o.content.trim();
        lastPrompt = o.content.trim();
      }
    }
    if (!firstPrompt) return null;
    return {
      id, cwd: '', branch: null, agent: 'kilo',
      title: firstPrompt.slice(0, 120),
      lastPrompt: (lastPrompt || firstPrompt).slice(0, 200),
      mtime: stat.mtimeMs, size: stat.size,
    };
  } finally { fs.closeSync(fd); }
}

function history() {
  const out = [];
  const titles = loadCustomTitles();
  const byId = new Map([...sessions.values()].map(s => [convOf(s), s]));
  let files = [];
  try { files = fs.readdirSync(TRANSCRIPTS).filter(f => f.endsWith('.jsonl')); } catch { }
  const seenFiles = new Set();
  for (const f of files) {
    const id = path.basename(f, '.jsonl');
    if (!/^[\w-]+$/.test(id)) continue;
    const file = path.join(TRANSCRIPTS, f);
    let st; try { st = fs.statSync(file); } catch { continue; }
    seenFiles.add(file);
    const c = histCache.get(file);
    let entry;
    if (c && c.mtime === st.mtimeMs) entry = c.entry;
    else {
      entry = null; try { entry = parseNativeTranscript(file, st, id); } catch { }
      histCache.set(file, { mtime: st.mtimeMs, entry });
    }
    if (!entry) continue;
    const s = byId.get(id);
    out.push({ ...entry, title: titles[id] || entry.title, cwd: s ? s.cwd : '', agent: s ? s.agent : entry.agent });
  }
  // Purge : les entrées des transcripts disparus ne doivent pas s'accumuler en mémoire.
  for (const k of [...histCache.keys()]) if (!seenFiles.has(k)) histCache.delete(k);
  return out.sort((a, b) => b.mtime - a.mtime);
}

// ---------------------------------------------------------------- sélecteur de dossier
let picking = null;
function pickFolder(initial) {
  if (picking) return picking;
  const env = { ...process.env, SM_INITIAL: initial || '', ASM_INITIAL: initial || '' };
  let cmd, args;
  if (IS_WIN) {
    cmd = which('pwsh') || 'powershell.exe';
    args = ['-NoProfile', '-STA', '-ExecutionPolicy', 'Bypass', '-File', path.join(ROOT, 'pick-folder.ps1')];
  } else if (IS_MAC) {
    cmd = 'osascript';
    const init = initial ? ` default location (POSIX file "${initial.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}")` : '';
    args = ['-e', `try\nPOSIX path of (choose folder with prompt "Choisir un dossier de travail"${init})\non error\n""\nend try`];
  } else {
    cmd = 'zenity';
    args = ['--file-selection', '--directory', '--title=Choisir un dossier de travail'];
    if (initial) args.push(`--filename=${initial}/`);
  }
  return (picking = new Promise(resolve => {
    execFile(cmd, args, { encoding: 'utf8', env }, (err, stdout) => {
      picking = null;
      resolve((stdout || '').trim().replace(/[\r\n]+$/, '') || null);
    });
  }));
}

// ---------------------------------------------------------------- HTTP
const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml', '.png': 'image/png' };
const STATIC = {
  '/xterm.js': 'node_modules/@xterm/xterm/lib/xterm.js',
  '/xterm.css': 'node_modules/@xterm/xterm/css/xterm.css',
  '/addon-fit.js': 'node_modules/@xterm/addon-fit/lib/addon-fit.js',
  '/addon-web-links.js': 'node_modules/@xterm/addon-web-links/lib/addon-web-links.js',
  '/addon-webgl.js': 'node_modules/@xterm/addon-webgl/lib/addon-webgl.js',
};

const SECURITY_HEADERS = {
  'Content-Security-Policy': [
    "default-src 'self'", "script-src 'self'", "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data: blob:", "font-src 'self' data:",
    `connect-src 'self' ws://127.0.0.1:${PORT} ws://localhost:${PORT}`,
    "object-src 'none'", "base-uri 'none'", "form-action 'none'", "frame-ancestors 'none'",
  ].join('; '),
  'X-Content-Type-Options': 'nosniff',
  'X-Frame-Options': 'DENY',
  'Referrer-Policy': 'no-referrer',
  'Cross-Origin-Opener-Policy': 'same-origin',
};

function hostOk(req) {
  const h = (req.headers.host || '').toLowerCase();
  return h === `127.0.0.1:${PORT}` || h === `localhost:${PORT}`;
}

function json(res, code, body) {
  res.writeHead(code, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
  res.end(JSON.stringify(body));
}

function saveUpload(req, rawName) {
  return new Promise((resolve, reject) => {
    const chunks = []; let size = 0;
    req.on('data', c => {
      size += c.length;
      if (size > UPLOAD_MAX) { reject(new Error('fichier trop gros (30 Mo max)')); req.destroy(); return; }
      chunks.push(c);
    });
    req.on('end', () => {
      try {
        fs.mkdirSync(UPLOADS, { recursive: true });
        let name = decodeURIComponent(rawName || '') || 'image.png';
        name = path.basename(name).replace(/[^\w.-]+/g, '_').replace(/^\.+/, '').slice(-80) || 'fichier';
        const stamp = new Date().toISOString().replace(/[-:T]/g, '').slice(0, 14);
        const file = path.join(UPLOADS, `${stamp}-${crypto.randomBytes(3).toString('hex')}-${name}`);
        fs.writeFileSync(file, Buffer.concat(chunks));
        resolve(file);
      } catch (e) { reject(e); }
    });
    req.on('error', reject);
  });
}

try {
  for (const f of fs.readdirSync(UPLOADS)) {
    const full = path.join(UPLOADS, f);
    if (Date.now() - fs.statSync(full).mtimeMs > 7 * 86400e3) fs.unlinkSync(full);
  }
} catch { }

function readBody(req) {
  return new Promise((resolve, reject) => {
    let b = '', done = false;
    const settle = (fn, v) => { if (!done) { done = true; fn(v); } };
    req.on('data', c => {
      if (done) return;
      b += c;
      // Trop gros : rejeter AVANT destroy, sinon la promesse reste pendante et le handler ne répond jamais.
      if (b.length > 1e6) { settle(reject, new Error('corps trop volumineux (1 Mo max)')); req.destroy(); }
    });
    req.on('end', () => { if (done) return; try { resolve(b ? JSON.parse(b) : {}); } catch (e) { settle(reject, e); } });
    req.on('error', e => settle(reject, e));
  });
}

const ROUTES = [];
function route(method, re, fn) { ROUTES.push({ method, re, fn }); }

const server = http.createServer(async (req, res) => {
  if (!hostOk(req)) { res.writeHead(403); return res.end('bad host'); }
  const url = new URL(req.url, `http://${req.headers.host}`);
  const p = url.pathname;

  if (req.method === 'GET' && (p === '/' || p === '/index.html')) {
    const html = fs.readFileSync(path.join(ROOT, 'public', 'index.html'), 'utf8')
      .replace(/__SM_TOKEN__|__CSM_TOKEN__|__ASM_TOKEN__/g, TOKEN)
      .replace(/__SM_VERSION__|__CSM_VERSION__|__ASM_VERSION__/g, (() => {
        try { return JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8')).version; } catch { return ''; }
      })());
    res.writeHead(200, { 'Content-Type': MIME['.html'], 'Cache-Control': 'no-store', ...SECURITY_HEADERS });
    return res.end(html);
  }
  if (req.method === 'GET' && (STATIC[p] || /^\/[\w.-]+\.(js|css|svg|png)$/.test(p))) {
    const file = STATIC[p] ? path.join(ROOT, STATIC[p]) : path.join(ROOT, 'public', p.slice(1));
    if (!fs.existsSync(file)) { res.writeHead(404); return res.end(); }
    res.writeHead(200, { 'Content-Type': MIME[path.extname(file)] || 'application/octet-stream', 'Cache-Control': 'no-cache', 'X-Content-Type-Options': 'nosniff' });
    return fs.createReadStream(file).pipe(res);
  }

  if (!p.startsWith('/api/')) { res.writeHead(404); return res.end(); }
  const authHeader = req.headers['x-sm-token'] || req.headers['x-asm-token'] || req.headers['x-csm-token'];
  // Le jeton « hook » (envoyé par bin/direct-agent.js depuis l'env des sessions) n'est accepté que sur /api/hook.
  if (authHeader !== TOKEN && !(p === '/api/hook' && authHeader === HOOK_TOKEN)) return json(res, 401, { error: 'token' });

  const lockOf = (() => {
    const sm = p.match(/^\/api\/sessions\/(\w+)(\/[\w-]+(?:\/[\w-]+)*)?$/);
    if (sm) { const ls = sessions.get(sm[1]); if (ls?.lock && !['/lock', '/unlock-remove'].includes(sm[2] || '')) return ls; }
    const hx = p.match(/^\/api\/history\/([\w-]+)\//);
    if (hx) return ctx.lockedByConversation?.(hx[1]);
    return null;
  })();
  if (lockOf && !ctx.canAccess?.(lockOf, req)) {
    await new Promise(r => { req.on('end', r); req.on('error', r); req.resume(); });
    return json(res, 423, { error: 'session verrouillée' });
  }

  try {
    if (p === '/api/version' && req.method === 'GET') {
      return json(res, 200, { version: VERSION, pid: process.pid, runtime: process.versions.electron ? 'electron' : 'node' });
    }
    if (p === '/api/upload' && req.method === 'POST') {
      const file = await saveUpload(req, String(req.headers['x-filename'] || ''));
      return json(res, 200, { path: file });
    }
    if (p === '/api/hook' && req.method === 'POST') {
      const { id, sm, asm, csm, event, agent: hookAgent, data } = await readBody(req);
      const targetId = id || sm || asm || csm;
      let s = sessions.get(targetId);
      const convId = data && data.conversationId;
      if (!s && convId) {
        s = [...sessions.values()].find(x => x.conversationId === convId || x.claudeSessionId === convId);
      }
      if (!s && sessions.size === 1) {
        s = [...sessions.values()][0];
      }
      if (!s) return json(res, 404, {});
      if (hookAgent && hookAgent !== s.agent) {
        return json(res, 200, { ignored: true });
      }
      if (event === 'start') { setStatus(s, 'idle'); emit('start', s); }
      else if (event === 'working') setStatus(s, 'working', data && data.tool_name ? data.tool_name : '');
      else if (event === 'attention') setStatus(s, 'attention', (data && data.message) || 'attend une réponse');
      else if (event === 'idle') {
        setStatus(s, 'idle', 'terminé');
        emit('idle', s);
        const cId = s.conversationId || s.claudeSessionId;
        if (s.named && cId && s.titleFor !== cId && writeCustomTitle(cId, s.name)) {
          s.titleFor = cId; persist();
        }
      }
      broadcast({ t: 'session', s: publicView(s) });
      return json(res, 200, {});
    }
    if (p === '/api/sessions' && req.method === 'GET') return json(res, 200, [...sessions.values()].map(publicView));
    if (p === '/api/sessions' && req.method === 'POST') {
      const b = await readBody(req);
      const lk = b.resume && ctx.lockedByConversation?.(b.resume);
      if (lk && !ctx.canAccess(lk, req)) return json(res, 423, { error: 'conversation d\u2019une session verrouillée' });
      return json(res, 200, publicView(createSession(b)));
    }
    const hm = p.match(/^\/api\/history\/([\w-]+)\/rename$/);
    if (hm && req.method === 'POST') {
      const title = String((await readBody(req)).name || '').trim().slice(0, 80);
      if (!title) return json(res, 400, { error: 'nom vide' });
      const managed = [...sessions.values()].find(s => s.conversationId === hm[1] || s.claudeSessionId === hm[1]);
      if (managed) renameSession(managed, title);
      else if (!writeCustomTitle(hm[1], title)) return json(res, 404, { error: 'conversation introuvable' });
      return json(res, 200, { ok: true });
    }
    if (p === '/api/history' && req.method === 'GET') {
      const managed = new Set([...sessions.values()].map(convOf));
      return json(res, 200, history().slice(0, 400).map(h => {
        const lk = ctx.lockedByConversation?.(h.id);
        return lk ? { ...h, managed: true, locked: true, title: `🔒 ${lk.name}`, lastPrompt: '' } : { ...h, managed: managed.has(h.id) };
      }));
    }
    if (p === '/api/pick-folder' && req.method === 'POST') {
      const { initial } = await readBody(req);
      const picked = await pickFolder(initial);
      return json(res, 200, { path: picked });
    }
    if (p === '/api/order' && req.method === 'POST') {
      const { ids } = await readBody(req);
      (ids || []).forEach((id, i) => { const s = sessions.get(id); if (s) s.order = i + 1; });
      persist(); broadcastAll();
      return json(res, 200, {});
    }
    const agMatch = p.match(/^\/api\/agents\/(\w+)\/models$/);
    if (agMatch && req.method === 'GET') {
      const ag = agMatch[1];
      return json(res, 200, { agent: ag, models: AGENT_MODELS_MAP[ag] || [] });
    }
    const m = p.match(/^\/api\/sessions\/(\w+)(?:\/(\w+))?$/);
    const s = m && sessions.get(m[1]);
    if (m && !s) return json(res, 404, { error: 'session inconnue' });
    if (s && req.method === 'DELETE' && !m[2]) {
      killSession(s); sessions.delete(s.id); persist();
      broadcast({ t: 'removed', id: s.id });
      return json(res, 200, {});
    }
    if (s && m[2] === 'rename' && req.method === 'POST') {
      const { name } = await readBody(req);
      renameSession(s, name);
      return json(res, 200, publicView(s));
    }
    if (s && m[2] === 'model' && req.method === 'POST') {
      const body = await readBody(req);
      const newModel = fitModel(s.agent, body && body.model);
      s.model = newModel;
      const remainingArgs = splitArgs(s.args || '').filter((a, i, arr) => {
        if (a === '--model' || (i > 0 && arr[i - 1] === '--model')) return false;
        if (a.startsWith('--model=')) return false;
        return true;
      });
      s.args = [newModel ? `--model ${newModel}` : '', ...remainingArgs].filter(Boolean).join(' ');
      s.agentCfg = { ...(s.agentCfg || {}), [s.agent]: { ...(s.agentCfg?.[s.agent] || {}), model: newModel } };
      persist();
      broadcast({ t: 'session', s: publicView(s) });
      return json(res, 200, publicView(s));
    }
    if (s && m[2] === 'kill' && req.method === 'POST') { s.wantRun = false; persist(); killSession(s); return json(res, 200, {}); }
    if (s && m[2] === 'restart' && req.method === 'POST') {
      killSession(s);
      s.buf += '\x1b[2J\x1b[H';
      broadcast({ t: 'clear', id: s.id });
      spawnSession(s, { resume: s.conversationId || s.claudeSessionId || undefined });
      return json(res, 200, publicView(s));
    }
    if (s && m[2] === 'fork' && req.method === 'POST') {
      const resumeId = s.conversationId || s.claudeSessionId;
      if (!resumeId) return json(res, 400, { error: 'session non démarrée' });
      const forked = createSession({
        cwd: s.cwd, name: `${s.name} (branche)`, resume: resumeId, fork: true,
        group: s.group, model: s.model, mode: s.mode, effort: s.effort, agent: s.agent
      });
      return json(res, 200, publicView(forked));
    }
    if (s && m[2] === 'seen' && req.method === 'POST') {
      if (s.status === 'idle' && s.message === 'terminé') setStatus(s, 'idle', '');
      return json(res, 200, {});
    }
    if (s && m[2] === 'switch' && req.method === 'POST') {
      const body = await readBody(req);
      const to = (body && body.to) || 'kilo';
      const VALID_AGENTS = ['kilo', 'opencode', 'openrouter'];
      if (!VALID_AGENTS.includes(to)) return json(res, 400, { error: 'agent cible inconnu (kilo|opencode|openrouter)' });
      if (to === s.agent && (!body.model || body.model === s.model)) return json(res, 400, { error: 'la session utilise déjà cet agent' });
      const r = switchAgent(s, to, { model: body && body.model });
      return json(res, 200, { session: publicView(s), brief: r.brief, stats: r.stats });
    }
    if (s && m[2] === 'handoff' && req.method === 'GET') {
      const file = handoff.transcriptFile(convOf(s));
      if (!file) return json(res, 404, { error: 'aucun transcript' });
      const nextAgent = s.agent === 'kilo' ? 'opencode' : (s.agent === 'opencode' ? 'openrouter' : 'kilo');
      const built = handoff.buildBriefing({
        file, from: s.agent, to: nextAgent, sessionName: s.name, cwd: s.cwd,
      });
      if (!built) return json(res, 404, { error: 'transcript vide' });
      json(res, 200, { markdown: built.markdown, stats: built.stats });
      return;
    }
    for (const r of ROUTES) {
      if (r.method !== req.method) continue;
      const mm = p.match(r.re);
      if (mm) return await r.fn({ req, res, m: mm, url });
    }
    return json(res, 404, { error: 'route' });
  } catch (e) {
    return json(res, 500, { error: e.message });
  }
});

// ---------------------------------------------------------------- WebSocket
const wss = new WebSocketServer({ noServer: true });
const clients = new Set();

function broadcast(msg) {
  const data = JSON.stringify(msg);
  for (const c of clients) if (c.readyState === 1) c.send(data);
}
function broadcastAll() { broadcast({ t: 'sessions', list: [...sessions.values()].map(publicView) }); }

server.on('upgrade', (req, sock, head) => {
  const url = new URL(req.url, `http://${req.headers.host}`);
  if (!hostOk(req) || url.pathname !== '/ws' || url.searchParams.get('token') !== TOKEN) { sock.destroy(); return; }
  wss.handleUpgrade(req, sock, head, ws => {
    clients.add(ws);
    ws.send(JSON.stringify({ t: 'sessions', list: [...sessions.values()].map(publicView) }));
    for (const s of sessions.values()) if (s.buf && !s.lock) ws.send(JSON.stringify({ t: 'replay', id: s.id, d: s.buf }));
    ws.on('message', raw => {
      let m; try { m = JSON.parse(raw); } catch { return; }
      if (ctx.onWsMessage?.(ws, m)) return;
      const s = sessions.get(m.id);
      if (!s) return;
      if (s.lock && !ctx.wsCan?.(s, ws)) return;
      if (m.t === 'input' && s.pty) {
        if (typeof m.d === 'string' && m.d) { try { s.pty.write(m.d); } catch { } }
      }
      else if (m.t === 'resize' && m.cols > 10 && m.rows > 3) {
        s.cols = m.cols; s.rows = m.rows;
        if (s.pty) try { s.pty.resize(m.cols, m.rows); } catch { }
      }
    });
    ws.on('close', () => { clients.delete(ws); ctx.onWsClose?.(ws); });
  });
});

// ---------------------------------------------------------------- modules
const listeners = {};
function on(ev, fn) { (listeners[ev] = listeners[ev] || []).push(fn); }
function emit(ev, ...a) { for (const fn of listeners[ev] || []) { try { fn(...a); } catch (e) { console.error('module', ev, e); } } }
const ctx = {
  route, on, emit, json, readBody, sessions, publicView, persist, broadcast, createSession, killSession, spawnSession,
  renameSession, history, transcriptPath, setStatus, DATA, ROOT, PORT, VERSION, IS_WIN, IS_MAC, TOKEN_FILE,
};
for (const mod of ['lock', 'git', 'settings', 'usage', 'tools', 'queue', 'agents']) {
  try { require(`./lib/${mod}`)(ctx); } catch (e) { console.error(`module ${mod} :`, e); }
}

server.on('error', e => { console.error('écoute impossible', e.message); process.exit(1); });
server.listen(PORT, HOST, () => {
  fs.writeFileSync(path.join(DATA, 'server.pid'), String(process.pid));
  console.log(`Free Session Manager -> http://${HOST}:${PORT}  (kilo: ${KILO}, opencode: ${OPENCODE})`);
  restoreSessions();
});

function shutdown() {
  shuttingDown = true;
  persistNow();
  for (const s of sessions.values()) killSession(s);
  persistNow();
  process.exit(0);
}
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
