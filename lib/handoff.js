'use strict';
// Bascule d'agent dans une même session (kilo / opencode / openrouter).
//
// Les trois runners natifs partagent le même transcript (DATA/transcripts/<id>.jsonl,
// une ligne {role, content, timestamp} par message) et le rechargent à la reprise :
// le contexte est donc transmis nativement. Le briefing Markdown construit ici sert
// d'aperçu (route GET /handoff) et de repli quand aucun transcript n'existe encore.

const fs = require('fs');
const path = require('path');
const { DATA } = require('./config');

const AGENT_LABEL = {
  kilo: 'Kilo Free',
  opencode: 'OpenCode',
  openrouter: 'OpenRouter Free',
};
const MAX_BRIEFING = 60000;      // garde-fou : reste très sous la fenêtre de contexte
const HEAD_MSGS = 4;             // objectifs initiaux conservés en entier
const TAIL_MSGS = 24;            // échanges récents conservés verbatim

// ------------------------------------------------------------------ localisation

/** Chemin du transcript natif d'une session (commun aux trois agents). */
function transcriptFile(id) {
  if (!id || !/^[\w-]+$/.test(id)) return null;
  const f = path.join(DATA, 'transcripts', `${id}.jsonl`);
  return fs.existsSync(f) ? f : null;
}

// ------------------------------------------------------------------ normalisation

const clean = t => String(t || '').replace(/```[\s\S]*?```/g, '```…```').replace(/\n{3,}/g, '\n\n').trim();

/**
 * Transforme un transcript natif en une liste de tours normalisée.
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

    // --- Free Session Manager / OpenRouter / Standard JSONL
    if ((o.role === 'user' || o.type === 'user') && (o.content || o.text)) {
      turns.push({ role: 'user', text: clean(o.content || o.text), tools: [], ts });
    } else if ((o.role === 'assistant' || o.role === 'agent' || o.type === 'assistant') && (o.content || o.text)) {
      turns.push({ role: 'agent', text: clean(o.content || o.text), tools: [], ts });
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

module.exports = { transcriptFile, parseConversation, buildBriefing, AGENT_LABEL, MAX_BRIEFING };
