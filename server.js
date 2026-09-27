'use strict';
// Sessions Manager — serveur local : héberge N sessions Claude Code & Antigravity CLI (PTY) et les expose à une UI web.
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
  which, resolveNode, resolveKilo, hasKilo, resolveOpencode, hasOpencode, resolveOpenrouter, hasOpenrouter, resolveClaude, resolveAgy, hasClaude, hasAgy, stablePath,
  CLAUDE_DIR, CLAUDE_HISTORY_FILE, CLAUDE_PROJECTS_DIR,
  BRAIN_DIR, AGY_HISTORY_FILE, GEMINI_CONFIG_DIR
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

// Jeton à portée réduite, injecté dans l'environnement des agents pour hook.js : il n'ouvre
// que /api/hook (statuts). Tout processus enfant d'un agent ne peut donc pas piloter l'API.
const HOOK_TOKEN_FILE = path.join(DATA, 'hook-token');
const HOOK_TOKEN = fs.existsSync(HOOK_TOKEN_FILE)
  ? fs.readFileSync(HOOK_TOKEN_FILE, 'utf8').trim()
  : (() => { const t = crypto.randomBytes(24).toString('hex'); fs.writeFileSync(HOOK_TOKEN_FILE, t); return t; })();

const NODE_BIN = resolveNode();
const KILO = resolveKilo();
const OPENCODE = resolveOpencode();
const OPENROUTER = resolveOpenrouter();
const CLAUDE = resolveClaude();
const AGY = resolveAgy();

// Hooks Claude Code injectés via --settings
const fwd = p => p.replace(/\\/g, '/');
const HOOK_SCRIPT = fwd(path.join(ROOT, 'hook.js'));
function hookRunner() {
  if (!process.versions.electron) return `"${fwd(process.execPath)}" "${HOOK_SCRIPT}"`;
  const sysNode = stablePath(which(IS_WIN ? 'node.exe' : 'node'));
  if (sysNode) return `"${fwd(sysNode)}" "${HOOK_SCRIPT}"`;
  const file = path.join(DATA, IS_WIN ? 'hook.cmd' : 'hook.sh');
  const body = IS_WIN
    ? `@echo off\r\nset ELECTRON_RUN_AS_NODE=1\r\n"${process.execPath}" "${path.join(ROOT, 'hook.js')}" %*\r\n`
    : `#!/bin/sh\nELECTRON_RUN_AS_NODE=1 exec "${process.execPath}" "${path.join(ROOT, 'hook.js')}" "$@"\n`;
  fs.writeFileSync(file, body);
  if (!IS_WIN) fs.chmodSync(file, 0o755);
  return `"${fwd(file)}"`;
}
const HOOK_RUNNER = hookRunner();
const hookCmd = (ev) => [{ hooks: [{ type: 'command', command: `${HOOK_RUNNER} ${ev}`, timeout: 15 }] }];
const HOOK_SETTINGS = path.join(DATA, 'hooks-settings.json');
fs.writeFileSync(HOOK_SETTINGS, JSON.stringify({
  hooks: {
    SessionStart: hookCmd('start'),
    UserPromptSubmit: hookCmd('working'),
    PreToolUse: hookCmd('working'),
    Notification: hookCmd('attention'),
    Stop: hookCmd('idle'),
    SessionEnd: hookCmd('end'),
  },
}, null, 2));

// Hooks Antigravity CLI enregistrés dans ~/.gemini/config/hooks.json
function registerAgyHooks() {
  try {
    fs.mkdirSync(GEMINI_CONFIG_DIR, { recursive: true });
    const hookConfigPath = path.join(GEMINI_CONFIG_DIR, 'hooks.json');
    let current = {};
    try { current = JSON.parse(fs.readFileSync(hookConfigPath, 'utf8')); } catch { }
    const hookScript = path.join(ROOT, 'hook.js');
    current['sessions-manager'] = {
      enabled: true,
      PreInvocation: [
        { type: 'command', command: `node "${hookScript}" PreInvocation`, timeout: 5 }
      ],
      PreToolUse: [
        {
          matcher: '.*',
          hooks: [
            { type: 'command', command: `node "${hookScript}" PreToolUse`, timeout: 5 }
          ]
        }
      ],
      Stop: [
        { type: 'command', command: `node "${hookScript}" Stop`, timeout: 5 }
      ]
    };
    fs.writeFileSync(hookConfigPath, JSON.stringify(current, null, 2));
  } catch (e) {
    console.error('Erreur enregistrement hooks agy :', e.message);
  }
}
registerAgyHooks();

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
  // Format Claude
  const f = transcriptPath(id);
  if (f && title) {
    try {
      fs.appendFileSync(f, JSON.stringify({ type: 'custom-title', customTitle: title, sessionId: id }) + '\n');
      ok = true;
    } catch { }
  }
  // Format AGY
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
    id: s.id, agent: s.agent || 'claude', name: s.name, cwd: s.cwd, args: s.args,
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
    id: s.id, agent: s.agent || 'claude', name: s.name, cwd: s.cwd, args: s.args, status: s.status, message: s.message,
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

function transcriptPath(id) {
  if (!/^[\w-]+$/.test(id || '')) return null;
  // Antigravity brain
  const brainFile = path.join(BRAIN_DIR, id, '.system_generated', 'logs', 'transcript.jsonl');
  if (fs.existsSync(brainFile)) return brainFile;
  // Claude Code projects
  try {
    if (fs.existsSync(CLAUDE_PROJECTS_DIR)) {
      for (const d of fs.readdirSync(CLAUDE_PROJECTS_DIR)) {
        const f = path.join(CLAUDE_PROJECTS_DIR, d, `${id}.jsonl`);
        if (fs.existsSync(f)) return f;
      }
    }
  } catch { }
  return null;
}
const transcriptExists = id => !!transcriptPath(id);

function lastTurnInterrupted(id) {
  const f = transcriptPath(id);
  if (!f) return false;
  try {
    const size = fs.statSync(f).size, len = Math.min(size, 64 * 1024), buf = Buffer.alloc(len);
    const fd = fs.openSync(f, 'r');
    try { fs.readSync(fd, buf, 0, len, Math.max(0, size - len)); } finally { fs.closeSync(fd); }
    return buf.toString('utf8').includes('Request interrupted by user');
  } catch { return false; }
}

function checkInterruptedSoon(s, ms = 250) {
  setTimeout(() => {
    const id = s.claudeSessionId || s.conversationId || s.id;
    if ((s.status === 'working' || s.status === 'attention') && lastTurnInterrupted(id)) setStatus(s, 'idle', 'interrompu');
  }, ms);
}

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
  const isOpencode = s.agent === 'opencode';
  const isOpenrouter = s.agent === 'openrouter';
  const isKilo = !isOpencode && !isOpenrouter;
  const binary = isOpencode ? OPENCODE : (isOpenrouter ? NODE_BIN : KILO);

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

  const defaultModel = agentDefaults(s.agent).model;
  const effectiveModel = explicitModel || defaultModel;
  s.model = effectiveModel;

  const args = [];

  if (isOpencode) {
    const rawArgs = splitArgs(process.env.SM_OPENCODE_ARGS || '');
    args.push(...rawArgs);
    if (resume) args.push('--session', resume);
    args.push('--model', effectiveModel);
    if (explicitMode === 'dangerously-skip-permissions') {
      args.push('--auto');
    }
    if (firstPrompt) {
      args.push('--prompt', firstPrompt);
    }
  } else if (isOpenrouter) {
    // Session OpenRouter 100% Directe (Node.js natif, sans passer par Kilo)
    args.push(OPENROUTER);
    const rawArgs = splitArgs(process.env.SM_OPENROUTER_ARGS || '');
    args.push(...rawArgs);
    if (resume) args.push('--session', resume);
    else if (s.id) args.push('--session', s.id);
    args.push('--model', effectiveModel);
    if (firstPrompt) {
      args.push('--prompt', firstPrompt);
    }
  } else {
    // Kilo
    const rawArgs = splitArgs(process.env.SM_KILO_ARGS || '');
    args.push(...rawArgs);
    if (resume) args.push('--session', resume);
    args.push('--model', effectiveModel);
    if (explicitMode === 'dangerously-skip-permissions') {
      args.push('--auto');
    }
    if (firstPrompt) {
      args.push('--prompt', firstPrompt);
    }
  }

  args.push(...extraArgs);

  const openrouterKey = process.env.OPENROUTER_API_KEY || process.env.OPENROUTER_API_TOKEN || '';
  const env = {
    ...process.env,
    SM_ID: s.id,
    SM_AGENT: isOpencode ? 'opencode' : (isOpenrouter ? 'openrouter' : 'kilo'),
    SM_PORT: String(PORT),
    SM_TOKEN: HOOK_TOKEN,
    FSM_ID: s.id,
    FSM_PORT: String(PORT),
    FSM_TOKEN: HOOK_TOKEN,
    OPENROUTER_API_KEY: openrouterKey,
    OPENROUTER_API_TOKEN: openrouterKey,
    COLORTERM: 'truecolor',
  };

  // Évite les propagations indésirables d'agents parents
  for (const k of Object.keys(env)) {
    if (/^(CLAUDECODE|CLAUDE_CODE_|CLAUDE_PID$|CLAUDE_EFFORT$|AI_AGENT$|ANTIGRAVITY_AGENT|ELECTRON_RUN_AS_NODE$)/i.test(k)) delete env[k];
  }
  if (isOpenrouter && binary === process.execPath && process.versions.electron) {
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
// `claude` et `agy` n'échangent pas leurs conversations : le contexte est reconstruit
// depuis le transcript (briefing Markdown) puis injecté comme premier prompt de l'agent
// cible. Si cette session a déjà utilisé l'agent cible, on reprend sa conversation :
// les deux historiques s'accumulent alors au fil des allers-retours.
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

  // 1. Sauvegarde et transmission du contexte (Handoff Briefing)
  let brief = null;
  let stats = null;
  let file = handoff.transcriptFile(from, s.conversationId || s.claudeSessionId || s.id);
  if (!file && s.buf && s.buf.length > 50) {
    try {
      const transDir = path.join(DATA, 'transcripts');
      fs.mkdirSync(transDir, { recursive: true });
      const f = path.join(transDir, `${s.id}.jsonl`);
      const cleanBuf = s.buf.replace(/\x1b\[[0-9;]*[a-zA-Z]/g, '').trim();
      if (cleanBuf.length > 20) {
        fs.writeFileSync(f, JSON.stringify({ role: 'user', content: cleanBuf.slice(0, 10000), timestamp: new Date().toISOString() }) + '\n');
        file = f;
      }
    } catch (e) {}
  }

  if (file) {
    const built = handoff.buildBriefing({
      file, from, to, sessionName: s.name, cwd: s.cwd,
    });
    if (built && built.markdown) {
      brief = built.markdown;
      stats = built.stats;
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
  s.buf += `\x1b[90m[fsm] Bascule vers ${AGENT_NAMES[to] || to} · Modèle: ${s.model}${brief ? ' · Contexte partagé transmis' : ''}\x1b[0m\r\n`;
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
      agent: x.agent || 'claude', ...x,
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

// ---------------------------------------------------------------- historique (Claude & AGY)
const histCache = new Map();

function readSlice(fd, pos, len) {
  const b = Buffer.alloc(len); const n = fs.readSync(fd, b, 0, len, pos); return b.slice(0, n).toString('utf8');
}

function parseAgyTranscript(file, stat, id) {
  const fd = fs.openSync(file, 'r');
  try {
    const HEAD = 96 * 1024, TAIL = 96 * 1024;
    const head = readSlice(fd, 0, Math.min(HEAD, stat.size));
    const tail = stat.size > HEAD ? readSlice(fd, Math.max(0, stat.size - TAIL), Math.min(TAIL, stat.size)) : '';
    let firstPrompt = null, lastPrompt = null;
    for (const line of (head + '\n' + tail).split('\n')) {
      if (!line.startsWith('{')) continue;
      let o; try { o = JSON.parse(line); } catch { continue; }
      if (o.type === 'USER_INPUT' && o.content) {
        let text = o.content;
        const m = text.match(/<USER_REQUEST>([\s\S]*?)<\/USER_REQUEST>/);
        if (m) text = m[1].trim();
        if (!firstPrompt) firstPrompt = text;
        lastPrompt = text;
      }
    }
    return {
      id, cwd: '', branch: null, agent: 'agy',
      title: (firstPrompt || lastPrompt || '').slice(0, 120) || '(sans titre)',
      lastPrompt: (lastPrompt || firstPrompt || '').slice(0, 200),
      mtime: stat.mtimeMs, size: stat.size,
    };
  } finally { fs.closeSync(fd); }
}

function parseClaudeTranscript(file, stat) {
  const fd = fs.openSync(file, 'r');
  try {
    const HEAD = 64 * 1024, TAIL = 64 * 1024;
    const head = readSlice(fd, 0, Math.min(HEAD, stat.size));
    const tail = stat.size > HEAD ? readSlice(fd, Math.max(0, stat.size - TAIL), Math.min(TAIL, stat.size)) : '';
    let cwd = '', branch = null, title = null, customTitle = null, firstPrompt = null, lastPrompt = null;
    for (const line of (head + '\n' + tail).split('\n')) {
      if (!line.startsWith('{')) continue;
      let o; try { o = JSON.parse(line); } catch { continue; }
      if (o.cwd && !cwd) cwd = o.cwd;
      if (o.gitBranch && !branch) branch = o.gitBranch;
      if (o.type === 'ai-title' && o.aiTitle) title = o.aiTitle;
      if (o.type === 'custom-title' && o.customTitle) customTitle = o.customTitle;
      if (o.type === 'summary' && o.summary && !title) title = o.summary;
      if (o.type === 'last-prompt' && o.lastPrompt) lastPrompt = o.lastPrompt;
      if (!firstPrompt && o.type === 'user' && o.message && !o.isMeta) {
        const c = o.message.content;
        const txt = typeof c === 'string' ? c : Array.isArray(c) ? (c.find(p => p.type === 'text') || {}).text : null;
        if (txt && !txt.startsWith('<') && !txt.startsWith('Caveat:')) firstPrompt = txt;
      }
    }
    if (!cwd && !firstPrompt && !title) return null;
    return {
      id: path.basename(file, '.jsonl'), cwd, branch, agent: 'claude',
      title: customTitle || title || (firstPrompt || lastPrompt || '').slice(0, 120) || '(sans titre)',
      lastPrompt: (lastPrompt || firstPrompt || '').slice(0, 200),
      mtime: stat.mtimeMs, size: stat.size,
    };
  } finally { fs.closeSync(fd); }
}

function history() {
  const out = [];
  const seen = new Set();
  const seenFiles = new Set(); // fichiers rencontrés durant ce scan, pour purger histCache
  const titles = loadCustomTitles();

  // 1. Antigravity history.jsonl
  if (fs.existsSync(AGY_HISTORY_FILE)) {
    try {
      const lines = fs.readFileSync(AGY_HISTORY_FILE, 'utf8').trim().split('\n');
      for (let i = lines.length - 1; i >= 0; i--) {
        const l = lines[i];
        if (!l.startsWith('{')) continue;
        let o; try { o = JSON.parse(l); } catch { continue; }
        const id = o.conversationId;
        if (!id || seen.has(id)) continue;
        seen.add(id);

        const title = titles[id] || o.display || '(sans titre)';
        out.push({
          id, cwd: o.workspace || '', branch: null, agent: 'agy',
          title: title.slice(0, 120),
          lastPrompt: (o.display || '').slice(0, 200),
          mtime: o.timestamp || Date.now(),
          size: 1024,
        });
      }
    } catch { }
  }

  // 2. Antigravity brain
  if (fs.existsSync(BRAIN_DIR)) {
    try {
      const dirs = fs.readdirSync(BRAIN_DIR);
      for (const id of dirs) {
        if (seen.has(id) || !/^[\w-]+$/.test(id)) continue;
        const transcriptFile = path.join(BRAIN_DIR, id, '.system_generated', 'logs', 'transcript.jsonl');
        let st; try { st = fs.statSync(transcriptFile); } catch { continue; }
        if (st.size < 50) continue;
        seen.add(id);
        seenFiles.add(transcriptFile);
        const c = histCache.get(transcriptFile);
        if (c && c.mtime === st.mtimeMs) { if (c.entry) out.push(c.entry); continue; }
        let entry = null; try { entry = parseAgyTranscript(transcriptFile, st, id); } catch { }
        histCache.set(transcriptFile, { mtime: st.mtimeMs, entry });
        if (entry) {
          if (titles[id]) entry.title = titles[id];
          out.push(entry);
        }
      }
    } catch { }
  }

  // 3. Claude Code projects
  if (fs.existsSync(CLAUDE_PROJECTS_DIR)) {
    try {
      for (const d of fs.readdirSync(CLAUDE_PROJECTS_DIR)) {
        if (/observer-sessions/i.test(d)) continue;
        const dir = path.join(CLAUDE_PROJECTS_DIR, d);
        let files = []; try { files = fs.readdirSync(dir).filter(f => f.endsWith('.jsonl')); } catch { continue; }
        for (const f of files) {
          const file = path.join(dir, f);
          const id = path.basename(f, '.jsonl');
          if (seen.has(id)) continue;
          let st; try { st = fs.statSync(file); } catch { continue; }
          if (st.size < 200) continue;
          seen.add(id);
          seenFiles.add(file);
          const c = histCache.get(file);
          if (c && c.mtime === st.mtimeMs) { if (c.entry) out.push(c.entry); continue; }
          let entry = null; try { entry = parseClaudeTranscript(file, st); } catch { }
          histCache.set(file, { mtime: st.mtimeMs, entry });
          if (entry) out.push(entry);
        }
      }
    } catch { }
  }

  // Purge : les entrées des transcripts disparus ne doivent pas s'accumuler en mémoire.
  if (histCache.size > 400) for (const k of [...histCache.keys()]) if (!seenFiles.has(k)) histCache.delete(k);
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
    const init = initial ? ` default location (POSIX file "${initial.replace(/"/g, '\\"')}")` : '';
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
  // Le jeton « hook » (envoyé par hook.js depuis l'env des agents) n'est accepté que sur /api/hook.
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
      const convId = data && (data.conversationId || data.session_id);
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
      if (convId) {
        const emittingAgent = hookAgent || (s.agent === 'agy' ? 'agy' : 'claude');
        if (emittingAgent === 'agy') {
          if (s.agent === 'agy') s.conversationId = convId;
          s.agentIds = { ...(s.agentIds || {}), agy: convId };
          persist();
        } else if (emittingAgent === 'claude') {
          if (s.agent === 'claude') s.claudeSessionId = convId;
          s.agentIds = { ...(s.agentIds || {}), claude: convId };
          persist();
        }
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
      const managed = new Set([...sessions.values()].map(s => s.conversationId || s.claudeSessionId).filter(Boolean));
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
      const file = handoff.transcriptFile(s.agent, s.conversationId || s.claudeSessionId || s.id);
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
        if (m.d === '\x03' || m.d === '\x1b') checkInterruptedSoon(s);
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
  renameSession, history, transcriptPath, setStatus, DATA, ROOT, PORT, VERSION, CLAUDE, AGY, IS_WIN, IS_MAC, TOKEN_FILE,
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
