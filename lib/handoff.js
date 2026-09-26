'use strict';
// Bascule d'agent dans une même session : transfert du contexte de Claude Code vers
// Antigravity (agy) ou l'inverse, sans perdre la conversation.
//
// Ni `claude` ni `agy` n'importent le format de l'autre : le seul canal fiable est donc
// un briefing Markdown reconstruit depuis le transcript, injecté comme premier prompt de
// la nouvelle session — auquel on peut ajouter la reprise de la conversation déjà
// existante côté cible, ce qui accumule le contexte des deux agents.

const fs = require('fs');
const path = require('path');
const os = require('os');
const { BRAIN_DIR, CLAUDE_PROJECTS_DIR } = require('./config');

const AGENT_LABEL = { claude: 'Claude Code', agy: 'Antigravity CLI' };
const MAX_BRIEFING = 60000;      // garde-fou : reste très sous la fenêtre de contexte
const HEAD_MSGS = 4;             // objectifs initiaux conservés en entier
const TAIL_MSGS = 24;            // échanges récents conservés verbatim

// ------------------------------------------------------------------ localisation

/** Chemin du transcript d'un agent, sans parcourir tous les projets. */
function transcriptFile(agent, id) {
  if (!id || !/^[\w-]+$/.test(id)) return null;
  const inBrain = () => {
    const f = path.join(BRAIN_DIR, id, '.system_generated', 'logs', 'transcript.jsonl');
    return fs.existsSync(f) ? f : null;
  };
  if (agent === 'agy') return inBrain();
  // Claude Code : le dossier du projet encode le chemin (`/Users/x/y` -> `-Users-x-y`).
  let dirs = [];
  try { dirs = fs.existsSync(CLAUDE_PROJECTS_DIR) ? fs.readdirSync(CLAUDE_PROJECTS_DIR) : []; } catch { }
  for (const d of dirs) {
    const f = path.join(CLAUDE_PROJECTS_DIR, d, `${id}.jsonl`);
    if (fs.existsSync(f)) return f;
  }
  // Repli : en mode test (fake-agy simule les deux agents dans brain)
  if (process.env.SM_CLAUDE_ARGS || process.env.ASM_CLAUDE_ARGS) {
    return inBrain();
  }
  return null;
}

/** Dossier Claude Code correspondant à un chemin de travail. */
function claudeProjectDir(cwd) {
  const abs = path.resolve(cwd || os.homedir());
  const slug = abs.replace(/[/.]/g, '-');
  return path.join(CLAUDE_PROJECTS_DIR, slug);
}

// ------------------------------------------------------------------ normalisation

function toolTarget(input) {
  if (!input || typeof input !== 'object') return '';
  return String(input.file_path || input.path || input.notebook_path || input.command || input.pattern
    || input.url || input.DirectoryPath || input.CommandLine || input.Url || input.description
    || input.prompt || input.toolAction || input.toolSummary || '').slice(0, 300);
}

const clean = t => String(t || '').replace(/```[\s\S]*?```/g, '```…```').replace(/\n{3,}/g, '\n\n').trim();

/**
 * Transforme un transcript (Claude Code ou Antigravity) en une liste de tours normalisée.
 * @returns {{role:'user'|'agent', text:string, tools:{name:string,target:string}[], ts:number}[]}
 */
function parseConversation(file) {
  const turns = [];
  let raw;
  try { raw = fs.readFileSync(file, 'utf8'); } catch { return turns; }

  for (const line of raw.split('\n')) {
    if (!line.startsWith('{')) continue;
    let o; try { o = JSON.parse(line); } catch { continue; }
    const ts = o.created_at ? Date.parse(o.created_at) : (o.timestamp ? Date.parse(o.timestamp) : 0);

    // --- Antigravity
    if (o.type === 'USER_INPUT' && o.content) {
      const m = o.content.match(/<USER_REQUEST>([\s\S]*?)<\/USER_REQUEST>/);
      turns.push({ role: 'user', text: clean(m ? m[1] : o.content), tools: [], ts });
    } else if (o.type === 'PLANNER_RESPONSE') {
      const tools = (Array.isArray(o.tool_calls) ? o.tool_calls : []).map(tc => ({ name: tc.name || '?', target: toolTarget(tc.args) }));
      const text = clean(o.content || '');
      if (!text && !tools.length) continue;
      // Regroupe les tool_calls consecutifs sans texte dans le tour précédent.
      const prev = turns[turns.length - 1];
      if (prev && prev.role === 'agent' && !text && tools.length) { prev.tools.push(...tools); continue; }
      turns.push({ role: 'agent', text, tools, ts });
    }
    // --- Claude Code
    else if (o.type === 'user' && o.message && !o.isMeta) {
      const c = o.message.content;
      const txt = typeof c === 'string' ? c : Array.isArray(c) ? (c.find(p => p.type === 'text') || {}).text : null;
      if (!txt || txt.startsWith('<') || txt.startsWith('Caveat:') || txt.startsWith('<')) continue;
      turns.push({ role: 'user', text: clean(txt), tools: [], ts });
    } else if (o.type === 'assistant' && o.message) {
      const parts = [], tools = [];
      for (const b of Array.isArray(o.message.content) ? o.message.content : []) {
        if (b.type === 'text' && b.text) parts.push(clean(b.text));
        else if (b.type === 'tool_use') tools.push({ name: b.name || '?', target: toolTarget(b.input) });
      }
      if (!parts.length && !tools.length) continue;
      turns.push({ role: 'agent', text: parts.join('\n\n'), tools, ts });
    }
  }
  return turns;
}

// ------------------------------------------------------------------ briefing

const cut = (s, n) => (!s || s.length <= n ? (s || '') : s.slice(0, n) + ' …[tronqué]');

/** Fichiers réellement touchés (écritures/éditions), puis simplement lus. */
function collectFiles(turns) {
  const written = new Set(), read = new Set();
  const WRITE = /^(write|edit|create|apply_patch|str_replace|delete|remove|patch)/i;
  const READ = /^(read|list|search|grep|find|glob|view)/i;
  for (const t of turns) for (const tool of t.tools) {
    const f = (tool.target || '').match(/[\w./@-]+\.\w{1,12}\b/);
    if (!f) continue;
    if (WRITE.test(tool.name)) written.add(f[0]);
    else if (READ.test(tool.name)) read.add(f[0]);
  }
  for (const f of written) read.delete(f);
  return { written: [...written], read: [...read] };
}

/**
 * Construit le briefing de transfert.
 * @returns {{markdown:string, stats:object}|null}
 */
function buildBriefing({ file, from, to, sessionName, cwd }) {
  const turns = parseConversation(file);
  const users = turns.filter(t => t.role === 'user');
  const agents = turns.filter(t => t.role === 'agent');
  if (!turns.length) return null;

  const { written, read } = collectFiles(turns);
  const toolCount = new Map();
  for (const t of turns) for (const tool of t.tools) toolCount.set(tool.name, (toolCount.get(tool.name) || 0) + 1);

  const out = [];
  out.push(`# Transfert de contexte : ${AGENT_LABEL[from] || from} → ${AGENT_LABEL[to] || to}`);
  out.push('');
  out.push(`Tu reprends une conversation déjà commencée dans **${AGENT_LABEL[from] || from}**. `
    + `L'utilisateur ne va pas tout réexpliquer : ci-dessous l'état exact du travail. `
    + `Lis ce briefing, puis poursuis là où l'autre agent s'est arrêté, sans rien refaire et sans redemander ce qui est déjà décidé.`);
  out.push('');
  out.push(`- **Session** : ${sessionName || 'sans nom'}`);
  out.push(`- **Dossier** : \`${cwd || ''}\``);
  out.push(`- **Date du transfert** : ${new Date().toISOString().slice(0, 16).replace('T', ' ')}`);
  out.push(`- **Transcript source** : \`${file}\``);
  out.push('');

  out.push('## 1. Objectif demandé');
  out.push('');
  for (const t of users.slice(0, HEAD_MSGS)) { out.push(`> ${cut(t.text.replace(/\n+/g, ' '), 600)}`); out.push(''); }
  if (users.length > HEAD_MSGS) out.push(`_(+ ${users.length - HEAD_MSGS} messages utilisateur suivants, dont les plus récents en section 4.)_`);
  out.push('');

  out.push('## 2. Travail déjà réalisé');
  out.push('');
  if (written.length) {
    out.push(`**Fichiers modifiés ou créés (${written.length}) :**`);
    out.push('');
    for (const f of written.slice(0, 40)) out.push(`- \`${f}\``);
    if (written.length > 40) out.push(`- …et ${written.length - 40} autres`);
    out.push('');
  } else out.push('_Aucun fichier modifié._\n');
  if (read.length) {
    out.push(`**Fichiers consultés (${read.length}) :** \`${read.slice(0, 25).join('`, `')}\`${read.length > 25 ? ' …' : ''}`);
    out.push('');
  }
  const tools = [...toolCount.entries()].sort((a, b) => b[1] - a[1]).slice(0, 12);
  if (tools.length) out.push(`**Outils les plus utilisés :** ${tools.map(([n, c]) => `\`${n}\`×${c}`).join(', ')}\n`);
  out.push('');

  out.push('## 3. Conventions et contraintes retenues');
  out.push('');
  const decisions = agents.filter(t => t.text && t.text.length > 120).slice(-6);
  if (decisions.length) {
    for (const t of decisions) { out.push(cut(t.text, 1200)); out.push(''); }
  } else out.push('_(aucune réponse détaillée à retransmettre)_\n');

  out.push('## 4. Derniers échanges (verbatim)');
  out.push('');
  const tail = turns.slice(-TAIL_MSGS);
  const head = `## ✳ Suite\n\nContinue le travail à partir de ce qui précède. `
    + `Si quelque chose est ambigu, demande confirmation au lieu de supposer.\n`;

  const body = t => `### ${t.role === 'user' ? '🧑 Utilisateur' : `🧠 ${AGENT_LABEL[from] || from}`}\n\n${cut(t.text || `_(outil : ${t.tools.map(x => x.name).join(', ')})_`, 3000)}\n`;
  let md = tail.map(body).join('\n');
  // rogne les tours les plus anciens du début si le budget est dépassé
  while (md.length > MAX_BRIEFING - 2500 && tail.length > 2) { tail.shift(); md = tail.map(body).join('\n'); }

  out.push(md);
  out.push('');
  out.push(head);
  return {
    markdown: out.join('\n'),
    stats: {
      turns: turns.length, users: users.length, agents: agents.length,
      written: written.length, read: read.length,
      chars: out.join('\n').length,
    },
  };
}

module.exports = { transcriptFile, claudeProjectDir, parseConversation, buildBriefing, AGENT_LABEL, MAX_BRIEFING };
