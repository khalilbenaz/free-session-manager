#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');
const os = require('os');
const readline = require('readline');
const http = require('http');
const { execSync } = require('child_process');

// -----------------------------------------------------------------------------
// Configuration & Arguments
// -----------------------------------------------------------------------------
const args = process.argv.slice(2);
let modelArg = '';
let initialPrompt = '';
let sessionId = process.env.SM_ID || process.env.FSM_ID || '';
let runOnce = false;

for (let i = 0; i < args.length; i++) {
  if (args[i] === '--model' && i + 1 < args.length) modelArg = args[++i];
  else if (args[i].startsWith('--model=')) modelArg = args[i].slice(8);
  else if (args[i] === '--prompt' && i + 1 < args.length) initialPrompt = args[++i];
  else if (args[i].startsWith('--prompt=')) initialPrompt = args[i].slice(9);
  else if (args[i] === '--session' && i + 1 < args.length) sessionId = args[++i];
  else if (args[i].startsWith('--session=')) sessionId = args[i].slice(10);
  else if (args[i] === '--once') runOnce = true;
}

// Normalisation de l'identifiant de modèle OpenRouter
function normalizeModel(m) {
  if (!m) return 'openrouter/free';
  let clean = m.trim();
  if (clean === 'openrouter/openrouter/free' || clean === 'openrouter/free' || clean === 'free' || clean === 'kilo/openrouter/free') {
    return 'openrouter/free';
  }
  if (clean.startsWith('kilo/')) {
    clean = clean.slice('kilo/'.length);
  }
  if (clean.startsWith('openrouter/openrouter/')) {
    return clean.replace('openrouter/openrouter/', 'openrouter/');
  }
  if (clean.startsWith('openrouter/')) {
    return clean.slice('openrouter/'.length);
  }
  return clean;
}

let CURRENT_MODEL = normalizeModel(modelArg);

// Clé API
const API_KEY = process.env.OPENROUTER_API_KEY ||
  process.env.OPENROUTER_API_TOKEN || '';

const SM_PORT = process.env.SM_PORT || process.env.FSM_PORT || '7898';
const SM_TOKEN = process.env.SM_TOKEN || process.env.FSM_TOKEN || '';

// -----------------------------------------------------------------------------
// Notification des statuts à Free Session Manager (Hooks)
// -----------------------------------------------------------------------------
function notifyHook(event, message = '') {
  if (!SM_PORT || !sessionId) return;
  try {
    const body = JSON.stringify({
      id: sessionId,
      agent: 'openrouter',
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
const SYSTEM_PROMPT = `Tu es l'agent OpenRouter Direct fonctionnant nativement dans Free Session Manager.
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
const { DATA } = (() => {
  try { return require('../lib/config'); } catch { return { DATA: path.join(os.homedir(), 'Library', 'Application Support', 'free-session-manager') }; }
})();
const TRANSCRIPTS_DIR = path.join(DATA, 'transcripts');
try { fs.mkdirSync(TRANSCRIPTS_DIR, { recursive: true }); } catch {}

const transcriptFile = sessionId ? path.join(TRANSCRIPTS_DIR, `${sessionId}.jsonl`) : null;

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

function printBanner() {
  console.log(`\r\n${C.cyan}${C.bold}╭────────────────────────────────────────────────────────────────────────────╮${C.reset}`);
  console.log(`${C.cyan}${C.bold}│${C.reset}  ${C.magenta}${C.bold}🌐 OpenRouter Agent${C.reset}                                                      ${C.cyan}${C.bold}│${C.reset}`);
  console.log(`${C.cyan}${C.bold}│${C.reset}  ${C.gray}Modèle actif :${C.reset} ${C.bold}${CURRENT_MODEL}${C.reset}`);
  console.log(`${C.cyan}${C.bold}│${C.reset}  ${C.gray}Dossier      :${C.reset} ${CWD}`);
  console.log(`${C.cyan}${C.bold}│${C.reset}  ${C.gray}Commandes    :${C.reset} ${C.yellow}/help${C.reset}, ${C.yellow}/model <nom>${C.reset}, ${C.yellow}/read <fichier>${C.reset}, ${C.yellow}!cmd${C.reset}, ${C.yellow}/clear${C.reset}, ${C.yellow}/exit${C.reset}  ${C.cyan}${C.bold}│${C.reset}`);
  console.log(`${C.cyan}${C.bold}╰────────────────────────────────────────────────────────────────────────────╯${C.reset}\r\n`);
}

function printHelp() {
  console.log(`\r\n${C.bold}Commandes disponibles :${C.reset}`);
  console.log(`  ${C.yellow}/help${C.reset}              - Afficher cette aide`);
  console.log(`  ${C.yellow}/model [nom]${C.reset}       - Afficher ou changer le modèle OpenRouter`);
  console.log(`  ${C.yellow}/models${C.reset}            - Liste des modèles gratuits recommandés`);
  console.log(`  ${C.yellow}/read <fichier>${C.reset}    - Lire un fichier et l'ajouter au contexte de l'IA`);
  console.log(`  ${C.yellow}/ls [dossier]${C.reset}      - Lister le contenu du dossier de travail`);
  console.log(`  ${C.yellow}!cmd${C.reset} ou ${C.yellow}/sh <cmd>${C.reset} - Exécuter une commande shell directement`);
  console.log(`  ${C.yellow}/clear${C.reset}             - Réinitialiser la conversation et l'écran`);
  console.log(`  ${C.yellow}/exit${C.reset} ou ${C.yellow}/quit${C.reset}      - Quitter la session`);
  console.log(`  ${C.gray}Ctrl+C${C.reset}             - Interrompre la génération en cours\r\n`);
}

function printModels() {
  console.log(`\r\n${C.bold}Modèles gratuits recommandés sur OpenRouter :${C.reset}`);
  console.log(`  • ${C.cyan}openrouter/free${C.reset} (Auto-router gratuit le plus adapté)`);
  console.log(`  • ${C.cyan}deepseek/deepseek-r1:free${C.reset} (Raisonnement avancé)`);
  console.log(`  • ${C.cyan}deepseek/deepseek-chat:free${C.reset} (V3 conversation)`);
  console.log(`  • ${C.cyan}meta-llama/llama-3.3-70b-instruct:free${C.reset}`);
  console.log(`  • ${C.cyan}qwen/qwen-2.5-coder-32b-instruct:free${C.reset}`);
  console.log(`  • ${C.cyan}nvidia/nemotron-3-super-120b-a12b:free${C.reset}\r\n`);
}

// -----------------------------------------------------------------------------
// Appel de streaming OpenRouter API
// -----------------------------------------------------------------------------
let currentAbortController = null;

async function askOpenRouter(userText) {
  notifyHook('working', 'Génération...');
  messages.push({ role: 'user', content: userText });

  currentAbortController = new AbortController();
  const startTime = Date.now();

  try {
    process.stdout.write(`\r\n${C.magenta}${C.bold}OpenRouter${C.reset} ${C.gray}(${CURRENT_MODEL})${C.reset} :\r\n`);

    const res = await fetch('https://openrouter.ai/api/v1/chat/completions', {
      method: 'POST',
      signal: currentAbortController.signal,
      headers: {
        'Authorization': `Bearer ${API_KEY}`,
        'Content-Type': 'application/json',
        'HTTP-Referer': 'https://opencode.ai',
        'X-Title': 'OpenCode',
        'User-Agent': 'opencode/1.0',
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
      console.log(`\r\n${C.red}[Erreur OpenRouter] ${errorMsg}${C.reset}\r\n`);
      notifyHook('idle');
      return;
    }

    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';
    let fullResponse = '';

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
          const chunk = json.choices?.[0]?.delta?.content || '';
          if (chunk) {
            fullResponse += chunk;
            process.stdout.write(chunk);
          }
        } catch (e) {}
      }
    }

    messages.push({ role: 'assistant', content: fullResponse });
    if (transcriptFile) {
      try {
        fs.appendFileSync(transcriptFile,
          JSON.stringify({ role: 'user', content: userText, timestamp: new Date().toISOString() }) + '\n' +
          JSON.stringify({ role: 'assistant', content: fullResponse, timestamp: new Date().toISOString() }) + '\n'
        );
      } catch (e) {}
    }
    const duration = ((Date.now() - startTime) / 1000).toFixed(1);
    console.log(`\r\n\r\n${C.gray}⚡ Réponse complétée en ${duration}s${C.reset}\r\n`);
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

async function handleCommand(input) {
  const line = input.trim();
  if (!line) {
    promptUser();
    return;
  }

  // Quitter
  if (line === '/exit' || line === '/quit' || line === ':q') {
    console.log(`\r\n${C.gray}Fermeture de la session OpenRouter Direct. À bientôt !${C.reset}`);
    process.exit(0);
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
      CURRENT_MODEL = normalizeModel(parts.slice(1).join(' '));
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
    const target = path.resolve(CWD, sub);
    try {
      const items = fs.readdirSync(target, { withFileTypes: true });
      console.log(`\r\n${C.bold}Contenu de ${target} :${C.reset}`);
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
      const out = execSync(cmd, { cwd: CWD, encoding: 'utf8', stdio: 'inherit' });
    } catch (e) {
      console.log(`\r\n${C.red}[Commande terminée avec erreur]${C.reset}`);
    }
    console.log('');
    promptUser();
    return;
  }

  // Requête normale vers OpenRouter
  isBusy = true;
  await askOpenRouter(line);
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
      process.exit(0);
    } else {
      console.log(`\r\n${C.yellow}(Appuyez à nouveau sur Ctrl+C ou tapez /exit pour quitter)${C.reset}`);
      promptUser();
    }
  }
});

// -----------------------------------------------------------------------------
// Démarrage
// -----------------------------------------------------------------------------
printBanner();

if (initialPrompt) {
  (async () => {
    isBusy = true;
    console.log(`${C.cyan}Prompt initial :${C.reset} ${initialPrompt}`);
    await askOpenRouter(initialPrompt);
    if (runOnce) {
      process.exit(0);
    }
    promptUser();
  })();
} else {
  promptUser();
}

