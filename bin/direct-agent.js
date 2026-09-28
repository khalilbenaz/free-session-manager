#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');
const os = require('os');
const readline = require('readline');
const http = require('http');
const { execSync } = require('child_process');
const { spawn } = require('child_process');

const { PROVIDERS, resolveProvider } = require('../lib/direct-providers');

// -----------------------------------------------------------------------------
// Configuration & Arguments
// -----------------------------------------------------------------------------
const args = process.argv.slice(2);
let providerArg = 'openrouter';
let modelArg = '';
let initialPrompt = '';
let sessionId = process.env.SM_ID || process.env.FSM_ID || '';
let runOnce = false;

for (let i = 0; i < args.length; i++) {
  if (args[i] === '--provider' && i + 1 < args.length) providerArg = args[++i];
  else if (args[i].startsWith('--provider=')) providerArg = args[i].slice(11);
  else if (args[i] === '--model' && i + 1 < args.length) modelArg = args[++i];
  else if (args[i].startsWith('--model=')) modelArg = args[i].slice(8);
  else if (args[i] === '--prompt' && i + 1 < args.length) initialPrompt = args[++i];
  else if (args[i].startsWith('--prompt=')) initialPrompt = args[i].slice(9);
  else if (args[i] === '--session' && i + 1 < args.length) sessionId = args[++i];
  else if (args[i].startsWith('--session=')) sessionId = args[i].slice(10);
  else if (args[i] === '--once') runOnce = true;
}

if (!PROVIDERS[providerArg]) {
  console.error(`Fournisseur inconnu : "${providerArg}". Valeurs acceptées : openrouter, kilo, opencode.`);
  process.exit(1);
}

// Détection du binaire OpenCode natif (aucune lecture de credential store ici :
// resolveOpencode()/hasOpencode() ne font que localiser le binaire lui-même).
const {
  DATA, resolveOpencode, hasOpencode,
} = (() => {
  try { return require('../lib/config'); } catch { return { DATA: path.join(os.homedir(), 'Library', 'Application Support', 'free-session-manager'), resolveOpencode: () => 'opencode', hasOpencode: () => false }; }
})();

let target;
try {
  target = resolveProvider(providerArg, process.env, hasOpencode());
} catch (err) {
  console.error(`\n[Erreur de configuration] ${err.message}\n`);
  process.exit(1);
}

let CURRENT_MODEL = target.normalizeModel(modelArg);

const SM_PORT = process.env.SM_PORT || process.env.FSM_PORT || '7898';
const SM_TOKEN = process.env.SM_TOKEN || process.env.FSM_TOKEN || '';

// -----------------------------------------------------------------------------
// Notification des statuts à Free Session Manager (Hooks)
// -----------------------------------------------------------------------------
// Identifiant de la session gérée (SM_ID) : distinct de --session quand on reprend
// une conversation existante, dont le transcript porte un autre identifiant.
const hookId = process.env.SM_ID || process.env.FSM_ID || sessionId;
function notifyHook(event, message = '') {
  if (!SM_PORT || !hookId) return;
  try {
    const body = JSON.stringify({
      id: hookId,
      agent: providerArg, // toujours le fournisseur demandé sur la CLI, même en cas de repli
      event,
      data: { message }
    });
    const req = http.request({
      host: '127.0.0.1',
      port: Number(SM_PORT),
      path: '/api/hook',
      method: 'POST',
      timeout: 2000,
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(body),
        'X-SM-Token': SM_TOKEN,
      }
    }, res => { res.resume(); });
    req.on('error', () => {});
    req.write(body);
    req.end();
  } catch (e) {}
}

// -----------------------------------------------------------------------------
// Historique de conversation & Contexte
// -----------------------------------------------------------------------------
const CWD = process.cwd();

function providerDisplayName() {
  if (providerArg === 'opencode') {
    if (target.fallback) return 'OpenCode → Kilo Gateway (repli)';
    if (target.mode === 'engine') return 'OpenCode (moteur local)';
    if (target.mode === 'zen') return 'OpenCode Zen';
  }
  if (providerArg === 'kilo') return 'Kilo Gateway';
  if (providerArg === 'openrouter') return 'OpenRouter';
  return providerArg;
}

const SYSTEM_PROMPT = `Tu es l'agent ${providerDisplayName()} fonctionnant nativement dans Free Session Manager.
Tu es un assistant IA de programmation concis, précis et efficace.
- Répertoire de travail : ${CWD}
- Système d'exploitation : ${process.platform} (${os.release()})
- Modèle actif : ${CURRENT_MODEL}

Directives :
1. Réponds toujours dans la langue de l'utilisateur (par défaut en français si demandé en français).
2. Fournis du code propre et bien formaté en Markdown.
3. Si l'utilisateur demande d'analyser des fichiers ou d'exécuter des commandes, donne des explications directes ou indique les commandes shell appropriées.`;

const messages = [
  { role: 'system', content: SYSTEM_PROMPT }
];

// Gestion de la persistance et du partage de contexte
const TRANSCRIPTS_DIR = path.join(DATA, 'transcripts');
try { fs.mkdirSync(TRANSCRIPTS_DIR, { recursive: true }); } catch {}

const transcriptFile = sessionId ? path.join(TRANSCRIPTS_DIR, `${sessionId}.jsonl`) : null;
// Sidecar : identifiant de session côté moteur OpenCode local, pour permettre
// à `--session` de reprendre la même session opencode serve d'un lancement à l'autre.
const engineSessionFile = sessionId ? path.join(TRANSCRIPTS_DIR, `${sessionId}.opencode-engine-session`) : null;

// Chargement automatique du contexte existant si session reprise
if (transcriptFile && fs.existsSync(transcriptFile)) {
  try {
    const raw = fs.readFileSync(transcriptFile, 'utf8').trim();
    if (raw) {
      for (const line of raw.split('\n')) {
        if (!line.startsWith('{')) continue;
        try {
          const entry = JSON.parse(line);
          if (entry.role && entry.content) {
            messages.push({ role: entry.role, content: entry.content });
          }
        } catch {}
      }
    }
  } catch {}
}

function persistTranscript(userText, assistantText) {
  if (!transcriptFile) return;
  try {
    fs.appendFileSync(transcriptFile,
      JSON.stringify({ role: 'user', content: userText, timestamp: new Date().toISOString() }) + '\n' +
      JSON.stringify({ role: 'assistant', content: assistantText, timestamp: new Date().toISOString() }) + '\n'
    );
  } catch (e) {}
}

// -----------------------------------------------------------------------------
// UI Terminal & Couleurs
// -----------------------------------------------------------------------------
const C = {
  reset: '\x1b[0m',
  bold: '\x1b[1m',
  dim: '\x1b[2m',
  cyan: '\x1b[36m',
  brightCyan: '\x1b[96m',
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  blue: '\x1b[34m',
  magenta: '\x1b[35m',
  red: '\x1b[31m',
  gray: '\x1b[90m',
  bgDark: '\x1b[48;5;236m',
};

const PROVIDER_ICON = { openrouter: '🌐', kilo: '⚡', opencode: '💻' };

function printBanner() {
  const icon = PROVIDER_ICON[providerArg] || '🤖';
  console.log(`\r\n${C.cyan}${C.bold}╭────────────────────────────────────────────────────────────────────────────╮${C.reset}`);
  console.log(`${C.cyan}${C.bold}│${C.reset}  ${C.magenta}${C.bold}${icon} ${providerDisplayName()} Agent${C.reset}`);
  console.log(`${C.cyan}${C.bold}│${C.reset}  ${C.gray}Modèle actif :${C.reset} ${C.bold}${CURRENT_MODEL}${C.reset}`);
  console.log(`${C.cyan}${C.bold}│${C.reset}  ${C.gray}Dossier      :${C.reset} ${CWD}`);
  console.log(`${C.cyan}${C.bold}│${C.reset}  ${C.gray}Commandes    :${C.reset} ${C.yellow}/help${C.reset}, ${C.yellow}/model <nom>${C.reset}, ${C.yellow}/read <fichier>${C.reset}, ${C.yellow}!cmd${C.reset}, ${C.yellow}/clear${C.reset}, ${C.yellow}/exit${C.reset}  ${C.cyan}${C.bold}│${C.reset}`);
  console.log(`${C.cyan}${C.bold}╰────────────────────────────────────────────────────────────────────────────╯${C.reset}\r\n`);
  if (target.notice) {
    console.log(`${C.yellow}${target.notice}${C.reset}\r\n`);
  }
}

function printHelp() {
  console.log(`\r\n${C.bold}Commandes disponibles :${C.reset}`);
  console.log(`  ${C.yellow}/help${C.reset}              - Afficher cette aide`);
  console.log(`  ${C.yellow}/model [nom]${C.reset}       - Afficher ou changer le modèle`);
  console.log(`  ${C.yellow}/models${C.reset}            - Liste des modèles gratuits recommandés`);
  console.log(`  ${C.yellow}/read <fichier>${C.reset}    - Lire un fichier et l'ajouter au contexte de l'IA`);
  console.log(`  ${C.yellow}/ls [dossier]${C.reset}      - Lister le contenu du dossier de travail`);
  console.log(`  ${C.yellow}!cmd${C.reset} ou ${C.yellow}/sh <cmd>${C.reset} - Exécuter une commande shell directement`);
  console.log(`  ${C.yellow}/clear${C.reset}             - Réinitialiser la conversation et l'écran`);
  console.log(`  ${C.yellow}/exit${C.reset} ou ${C.yellow}/quit${C.reset}      - Quitter la session`);
  console.log(`  ${C.gray}Ctrl+C${C.reset}             - Interrompre la génération en cours\r\n`);
}

// Catalogues statiques de modèles gratuits (identifiants "nus", sans préfixe de
// catalogue), utilisés uniquement pour l'affichage de la commande /models.
const FREE_MODELS = {
  openrouter: [
    ['openrouter/free', 'Auto-router gratuit le plus adapté'],
    ['nvidia/nemotron-3-super-120b-a12b:free', ''],
    ['nvidia/nemotron-3.5-lightning:free', 'Rapide'],
    ['qwen/qwen3.8-27b:free', ''],
    ['google/gemma-4-31b-it:free', ''],
    ['cohere/north-mini-code:free', 'Code'],
  ],
  kilo: [
    ['kilo-auto/free', 'Sélection automatique Kilo'],
    ['openrouter/free', 'Auto-router OpenRouter via Kilo Gateway'],
    ['nvidia/nemotron-3-super-120b-a12b:free', ''],
    ['nvidia/nemotron-3-ultra-550b-a55b:free', ''],
    ['nvidia/nemotron-3.5-lightning:free', ''],
    ['liquid/lfm-2.5-2.6b:free', ''],
  ],
  opencode: [
    ['big-pickle', 'Modèle par défaut'],
    ['nemotron-3.5-lightning-free', ''],
    ['nemotron-3-ultra-free', ''],
    ['ling-3.0-flash-fin-free', ''],
    ['longcat-2.5-preview-free', ''],
    ['mimo-v2.6-flash-free', ''],
    ['space-bunny-free', ''],
  ],
};

function printModels() {
  const list = FREE_MODELS[target.provider] || FREE_MODELS[providerArg] || [];
  console.log(`\r\n${C.bold}Modèles gratuits recommandés (${providerDisplayName()}) :${C.reset}`);
  for (const [id, desc] of list) {
    console.log(`  • ${C.cyan}${id}${C.reset}${desc ? ` (${desc})` : ''}`);
  }
  if (target.fallback) {
    console.log(`  ${C.yellow}(repli actif : identifiants ci-dessus valables côté Kilo Gateway)${C.reset}`);
  }
  console.log('');
}

// -----------------------------------------------------------------------------
// Mode API (openrouter / kilo / opencode-zen) — streaming SSE
// -----------------------------------------------------------------------------
let currentAbortController = null;

async function askAPI(userText, startTime) {
  messages.push({ role: 'user', content: userText });

  currentAbortController = new AbortController();

  process.stdout.write(`\r\n${C.magenta}${C.bold}${providerDisplayName()}${C.reset} ${C.gray}(${CURRENT_MODEL})${C.reset} :\r\n`);

  const res = await fetch(`${target.baseURL}/chat/completions`, {
    method: 'POST',
    signal: currentAbortController.signal,
    headers: {
      'Content-Type': 'application/json',
      'HTTP-Referer': 'https://opencode.ai',
      'X-Title': 'OpenCode',
      'User-Agent': 'opencode/1.0',
      ...target.headers,
    },
    body: JSON.stringify({
      model: CURRENT_MODEL,
      messages: messages,
      stream: true,
    })
  });

  if (!res.ok) {
    const errText = await res.text();
    let errorMsg = `HTTP ${res.status}`;
    try {
      const parsed = JSON.parse(errText);
      errorMsg = parsed.error?.message || errText;
    } catch (e) {
      errorMsg = errText;
    }
    messages.pop();
    // Modèle devenu payant ou retiré : bascule une fois sur le routeur gratuit
    // automatique et relance la question, plutôt que de laisser la session bloquée.
    const fallbackModel = target.normalizeModel('');
    if (/unavailable for free|not.*free|paid version|No endpoints found/i.test(errorMsg) && CURRENT_MODEL !== fallbackModel) {
      console.log(`${C.yellow}${CURRENT_MODEL} n'est plus gratuit : bascule automatique sur ${C.bold}${fallbackModel}${C.reset}${C.yellow} (routeur gratuit).${C.reset}`);
      CURRENT_MODEL = fallbackModel;
      return askAPI(userText, startTime);
    }
    console.log(`\r\n${C.red}[Erreur ${providerDisplayName()}] ${errorMsg}${C.reset}\r\n`);
    return;
  }

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  let fullResponse = '';
  let thinking = false; // raisonnement en cours d'affichage (grisé)
  let streamError = '';

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;

    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split('\n');
    buffer = lines.pop();

    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed || !trimmed.startsWith('data: ')) continue;
      const dataStr = trimmed.slice(6);
      if (dataStr === '[DONE]') break;
      try {
        const json = JSON.parse(dataStr);
        if (json.error) { streamError = json.error.message || JSON.stringify(json.error); continue; }
        const delta = json.choices?.[0]?.delta || {};
        // Les modèles de raisonnement (Nemotron Ultra, etc.) diffusent d'abord
        // `delta.reasoning` : on n'en montre qu'un indicateur compact, effacé dès
        // que la réponse arrive, pour ne pas donner l'impression d'un blocage.
        const reasoning = delta.reasoning || delta.reasoning_content || '';
        if (reasoning && !fullResponse) {
          thinking = true;
          const secs = Math.round((Date.now() - startTime) / 1000);
          process.stdout.write(`\r\x1b[2K${C.gray}💭 réflexion… ${secs}s${C.reset}`);
        }
        const chunk = delta.content || '';
        if (chunk) {
          if (thinking) { thinking = false; process.stdout.write('\r\x1b[2K'); }
          fullResponse += chunk;
          process.stdout.write(chunk);
        }
      } catch (e) {}
    }
  }
  if (thinking) process.stdout.write('\r\x1b[2K');

  if (streamError) {
    console.log(`\r\n${C.red}[Erreur ${providerDisplayName()}] ${streamError}${C.reset}\r\n`);
  } else if (!fullResponse) {
    console.log(`\r\n${C.yellow}(Réponse vide du modèle ${CURRENT_MODEL} : réessaie ou choisis un autre modèle via /model)${C.reset}`);
  }
  if (!fullResponse) { messages.pop(); return; }

  messages.push({ role: 'assistant', content: fullResponse });
  persistTranscript(userText, fullResponse);
  const duration = ((Date.now() - startTime) / 1000).toFixed(1);
  console.log(`\r\n\r\n${C.gray}⚡ Réponse complétée en ${duration}s${C.reset}\r\n`);
}

// -----------------------------------------------------------------------------
// Mode moteur local OpenCode (`opencode serve --port 0 --pure`)
// -----------------------------------------------------------------------------
let engineChild = null;
let enginePort = null;
let engineSessionId = null;
let engineStarting = null;

function stopEngine() {
  if (engineChild) {
    try { engineChild.kill('SIGTERM'); } catch {}
    engineChild = null;
    enginePort = null;
  }
}

function startEngine() {
  if (engineStarting) return engineStarting;
  engineStarting = new Promise((resolve, reject) => {
    const bin = resolveOpencode();
    let resolved = false;
    let out = '';
    let child;
    try {
      child = spawn(bin, ['serve', '--port', '0', '--pure'], {
        cwd: CWD,
        env: process.env,
        stdio: ['ignore', 'pipe', 'pipe'],
      });
    } catch (err) {
      reject(err);
      return;
    }
    engineChild = child;

    const onData = (buf) => {
      out += buf.toString('utf8');
      const m = out.match(PROVIDERS.opencode.engine.readyLineRe);
      if (m && !resolved) {
        resolved = true;
        enginePort = Number(m[1]);
        resolve(enginePort);
      }
    };
    child.stdout.on('data', onData);
    child.stderr.on('data', onData);
    child.on('error', (err) => {
      if (!resolved) { resolved = true; reject(err); }
    });
    child.on('exit', () => {
      if (engineChild === child) { engineChild = null; enginePort = null; }
      if (!resolved) { resolved = true; reject(new Error('opencode serve s\'est arrêté avant d\'être prêt.')); }
    });
    setTimeout(() => {
      if (!resolved) { resolved = true; reject(new Error('Timeout : opencode serve n\'a pas démarré à temps.')); }
    }, 15000);
  }).finally(() => { engineStarting = null; });
  return engineStarting;
}

async function engineRequest(method, urlPath, body) {
  const res = await fetch(`http://127.0.0.1:${enginePort}${urlPath}`, {
    method,
    headers: { 'Content-Type': 'application/json' },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  let json = null;
  try { json = text ? JSON.parse(text) : null; } catch {}
  if (!res.ok) {
    throw new Error(`HTTP ${res.status} ${method} ${urlPath} : ${text.slice(0, 200)}`);
  }
  return json;
}

async function createEngineSession() {
  const created = await engineRequest('POST', '/session', { title: `fsm-${sessionId || 'session'}` });
  engineSessionId = created && created.id;
  if (engineSessionFile && engineSessionId) {
    try { fs.writeFileSync(engineSessionFile, engineSessionId); } catch {}
  }
  return engineSessionId;
}

async function sendEngineMessage(userText) {
  if (enginePort == null) await startEngine();

  if (!engineSessionId && engineSessionFile && fs.existsSync(engineSessionFile)) {
    const stored = fs.readFileSync(engineSessionFile, 'utf8').trim();
    if (stored) engineSessionId = stored;
  }
  if (!engineSessionId) await createEngineSession();

  const body = {
    model: { providerID: 'opencode', modelID: CURRENT_MODEL },
    parts: [{ type: 'text', text: userText }],
  };

  let result;
  try {
    result = await engineRequest('POST', `/session/${engineSessionId}/message`, body);
  } catch (err) {
    // La session stockée n'est peut-être plus valide côté serveur (nouveau
    // processus opencode serve) : on en recrée une puis on réessaie une fois.
    await createEngineSession();
    result = await engineRequest('POST', `/session/${engineSessionId}/message`, body);
  }

  const parts = (result && result.parts) || [];
  let fullResponse = '';
  for (const part of parts) {
    // On ignore délibérément les parts `reasoning`/`step-start`/`step-finish` :
    // seul le texte final est affiché et persisté.
    if (part && part.type === 'text' && part.text) fullResponse += part.text;
  }
  return fullResponse;
}

function startSpinner(label) {
  const frames = ['⠋', '⠙', '⠹', '⠸', '⠼', '⠴', '⠦', '⠧', '⠇', '⠏'];
  let i = 0;
  const id = setInterval(() => {
    i = (i + 1) % frames.length;
    process.stdout.write(`\r${C.gray}${frames[i]} ${label}${C.reset}`);
  }, 80);
  return () => {
    clearInterval(id);
    process.stdout.write(`\r${' '.repeat(label.length + 4)}\r`);
  };
}

async function askEngine(userText, startTime) {
  messages.push({ role: 'user', content: userText });
  process.stdout.write(`\r\n${C.magenta}${C.bold}${providerDisplayName()}${C.reset} ${C.gray}(${CURRENT_MODEL})${C.reset} :\r\n`);
  const stopSpin = startSpinner('Génération en cours (moteur OpenCode local)…');
  let fullResponse = '';
  try {
    fullResponse = await sendEngineMessage(userText);
  } finally {
    stopSpin();
  }
  process.stdout.write(fullResponse || `${C.gray}(réponse vide)${C.reset}`);
  messages.push({ role: 'assistant', content: fullResponse });
  persistTranscript(userText, fullResponse);
  const duration = ((Date.now() - startTime) / 1000).toFixed(1);
  console.log(`\r\n\r\n${C.gray}⚡ Réponse complétée en ${duration}s${C.reset}\r\n`);
}

// -----------------------------------------------------------------------------
// Dispatcher générique
// -----------------------------------------------------------------------------
async function ask(userText) {
  notifyHook('working', 'Génération...');
  const startTime = Date.now();
  try {
    if (target.mode === 'engine') {
      await askEngine(userText, startTime);
    } else {
      await askAPI(userText, startTime);
    }
  } catch (err) {
    if (err.name === 'AbortError') {
      console.log(`\r\n${C.yellow}[Interrompu par l'utilisateur]${C.reset}\r\n`);
    } else {
      console.log(`\r\n${C.red}[Erreur de connexion] ${err.message}${C.reset}\r\n`);
    }
  } finally {
    currentAbortController = null;
    notifyHook('idle');
  }
}

// -----------------------------------------------------------------------------
// Boucle Interactive Readline
// -----------------------------------------------------------------------------
const rl = readline.createInterface({
  input: process.stdin,
  output: process.stdout,
  prompt: `${C.cyan}${C.bold}❯${C.reset} `,
  terminal: true,
});

let isBusy = false;
let sigintCount = 0;

function promptUser() {
  isBusy = false;
  rl.prompt();
}

function exitCleanly(code) {
  stopEngine();
  process.exit(code);
}

async function handleCommand(input) {
  const line = input.trim();
  if (!line) {
    promptUser();
    return;
  }

  // Quitter
  if (line === '/exit' || line === '/quit' || line === ':q') {
    console.log(`\r\n${C.gray}Fermeture de la session ${providerDisplayName()}. À bientôt !${C.reset}`);
    exitCleanly(0);
  }

  // Aide
  if (line === '/help' || line === '?') {
    printHelp();
    promptUser();
    return;
  }

  // Liste des modèles
  if (line === '/models') {
    printModels();
    promptUser();
    return;
  }

  // Modèle actuel ou changement
  if (line.startsWith('/model')) {
    const parts = line.split(/\s+/);
    if (parts.length > 1) {
      CURRENT_MODEL = target.normalizeModel(parts.slice(1).join(' '));
      console.log(`\r\n${C.green}✔ Modèle changé pour :${C.reset} ${C.bold}${CURRENT_MODEL}${C.reset}\r\n`);
    } else {
      console.log(`\r\n${C.cyan}Modèle actif :${C.reset} ${C.bold}${CURRENT_MODEL}${C.reset}\r\n`);
    }
    promptUser();
    return;
  }

  // Nettoyage
  if (line === '/clear') {
    console.clear();
    messages.length = 1; // Garder uniquement le prompt système
    if (transcriptFile) {
      try { fs.writeFileSync(transcriptFile, ''); } catch (e) {}
    }
    printBanner();
    promptUser();
    return;
  }

  // Listing fichiers
  if (line.startsWith('/ls') || line.startsWith('/dir')) {
    const sub = line.split(/\s+/)[1] || '.';
    const target2 = path.resolve(CWD, sub);
    try {
      const items = fs.readdirSync(target2, { withFileTypes: true });
      console.log(`\r\n${C.bold}Contenu de ${target2} :${C.reset}`);
      for (const item of items) {
        if (item.name.startsWith('.') && item.name !== '.env') continue;
        const icon = item.isDirectory() ? `${C.blue}📁 ` : `${C.gray}📄 `;
        console.log(`  ${icon}${item.name}${C.reset}`);
      }
      console.log('');
    } catch (e) {
      console.log(`\r\n${C.red}Erreur : ${e.message}${C.reset}\r\n`);
    }
    promptUser();
    return;
  }

  // Lecture de fichier
  if (line.startsWith('/read ') || line.startsWith('/cat ')) {
    const filePath = line.replace(/^\/(read|cat)\s+/, '').trim();
    const full = path.resolve(CWD, filePath);
    try {
      const content = fs.readFileSync(full, 'utf8');
      console.log(`\r\n${C.green}✔ Fichier chargé : ${filePath} (${content.length} caractères)${C.reset}`);
      messages.push({
        role: 'user',
        content: `Contenu du fichier \`${filePath}\` :\n\`\`\`\n${content}\n\`\`\``
      });
      console.log(`${C.gray}Le fichier a été ajouté au contexte de l'IA.${C.reset}\r\n`);
    } catch (e) {
      console.log(`\r\n${C.red}Impossible de lire le fichier : ${e.message}${C.reset}\r\n`);
    }
    promptUser();
    return;
  }

  // Exécution shell directe (!cmd ou /sh cmd)
  if (line.startsWith('!') || line.startsWith('/sh ')) {
    const cmd = line.startsWith('!') ? line.slice(1).trim() : line.slice(4).trim();
    if (!cmd) {
      promptUser();
      return;
    }
    console.log(`\r\n${C.yellow}$ ${cmd}${C.reset}`);
    try {
      execSync(cmd, { cwd: CWD, encoding: 'utf8', stdio: 'inherit' });
    } catch (e) {
      console.log(`\r\n${C.red}[Commande terminée avec erreur]${C.reset}`);
    }
    console.log('');
    promptUser();
    return;
  }

  // Requête normale vers le fournisseur actif
  isBusy = true;
  await ask(line);
  promptUser();
}

// -----------------------------------------------------------------------------
// Gestion des événements clavier & signaux
// -----------------------------------------------------------------------------
rl.on('line', async (line) => {
  if (isBusy) return;
  sigintCount = 0;
  await handleCommand(line);
});

rl.on('SIGINT', () => {
  if (isBusy && currentAbortController) {
    currentAbortController.abort();
    sigintCount = 0;
  } else {
    sigintCount++;
    if (sigintCount >= 2) {
      console.log(`\r\n${C.gray}Au revoir !${C.reset}`);
      exitCleanly(0);
    } else {
      console.log(`\r\n${C.yellow}(Appuyez à nouveau sur Ctrl+C ou tapez /exit pour quitter)${C.reset}`);
      promptUser();
    }
  }
});

process.on('exit', () => { stopEngine(); });
process.on('SIGTERM', () => { exitCleanly(0); });

// -----------------------------------------------------------------------------
// Démarrage
// -----------------------------------------------------------------------------
printBanner();

if (initialPrompt) {
  (async () => {
    isBusy = true;
    console.log(`${C.cyan}Prompt initial :${C.reset} ${initialPrompt}`);
    await ask(initialPrompt);
    if (runOnce) {
      exitCleanly(0);
    }
    promptUser();
  })();
} else {
  promptUser();
}
