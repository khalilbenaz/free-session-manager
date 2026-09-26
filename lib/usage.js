'use strict';
// Consommation, chronologie des outils et export de conversation pour Claude Code & Antigravity (agy).
const fs = require('fs');
const path = require('path');
const os = require('os');
const { BRAIN_DIR, CLAUDE_PROJECTS_DIR } = require('./config');
const { getAgyQuota, getClaudeQuota } = require('./agents');

// Tarifs indicatifs des modèles ($ par million de tokens)
const PRICES = [
  [/gemini-.*flash/, 0.15, 0.60],
  [/gemini-.*pro/, 1.25, 5.00],
  [/opus-4-[01]|opus-4-2025|claude-3-opus/, 15, 75],
  [/claude-.*opus/, 5.00, 25.00],
  [/claude-.*sonnet/, 3.00, 15.00],
  [/haiku-3/, 0.25, 1.25],
  [/haiku/, 1, 5],
  [/fable/, 3, 15],
  [/gpt-oss/, 0, 0],
];

function price(model) {
  for (const [re, i, o] of PRICES) if (re.test(model || '')) return { i, o };
  return { i: 0.5, o: 2.0 };
}

function cost(model, u) {
  const p = price(model);
  return ((u.in || 0) * p.i + (u.out || 0) * p.o + (u.cr || 0) * p.i * 0.1 + (u.cw || 0) * p.i * 1.25) / 1e6;
}

// ---------------------------------------------------------------- lecture incrémentale
const CACHE_MAX = 400; // bornes : les transcripts consultés une fois ne doivent pas retenir la mémoire
const cache = new Map();
function fresh() { return { size: 0, offset: 0, rest: '', ids: new Set(), models: {}, hours: {}, tools: [], first: 0, last: 0, at: 0 }; }

function target(input) {
  if (!input || typeof input !== 'object') return '';
  return String(input.file_path || input.path || input.notebook_path || input.command || input.pattern || input.url || input.query || input.DirectoryPath || input.CommandLine || input.Url || input.description || input.prompt || input.toolAction || input.toolSummary || '').slice(0, 300);
}

function ingest(st, line) {
  if (!line.startsWith('{')) return;
  let o; try { o = JSON.parse(line); } catch { return; }
  const ts = o.created_at ? Date.parse(o.created_at) : (o.timestamp ? Date.parse(o.timestamp) : 0);
  if (ts) { st.first = st.first || ts; st.last = Math.max(st.last, ts); }

  // Antigravity format
  if (Array.isArray(o.tool_calls)) {
    for (const tc of o.tool_calls) {
      st.tools.push({ ts, name: tc.name, target: target(tc.args) });
      if (st.tools.length > 2000) st.tools.splice(0, st.tools.length - 2000);
    }
  }

  // Claude Code format
  if (o.type === 'assistant' && o.message) {
    const msg = o.message;
    const key = msg.id || o.requestId || o.uuid;
    const u = msg.usage;
    if (u && key && !st.ids.has(key)) {
      if (st.ids.size > 100000) st.ids.clear(); // borné : les doublons rares au-delà seront recomptés
      st.ids.add(key);
      const d = { in: u.input_tokens || 0, out: u.output_tokens || 0, cr: u.cache_read_input_tokens || 0, cw: u.cache_creation_input_tokens || 0 };
      const m = st.models[msg.model || '?'] = st.models[msg.model || '?'] || { in: 0, out: 0, cr: 0, cw: 0 };
      for (const k in d) m[k] += d[k];
      if (ts) {
        const h = Math.floor(ts / 3600e3) * 3600e3;
        const b = st.hours[h] = st.hours[h] || { in: 0, out: 0, cr: 0, cw: 0, cost: 0 };
        for (const k in d) b[k] += d[k];
        b.cost += cost(msg.model, d);
      }
    }
    for (const c of Array.isArray(msg.content) ? msg.content : []) {
      if (c.type === 'tool_use') {
        st.tools.push({ ts, name: c.name, target: target(c.input) });
        if (st.tools.length > 2000) st.tools.splice(0, st.tools.length - 2000);
      }
    }
  }
}

function read(file) {
  let stat; try { stat = fs.statSync(file); } catch { cache.delete(file); return null; }
  let st = cache.get(file);
  if (!st || stat.size < st.size) { st = fresh(); cache.set(file, st); }
  st.at = Date.now();
  if (cache.size > CACHE_MAX) {
    const oldest = [...cache.entries()].filter(([f]) => f !== file).sort((a, b) => a[1].at - b[1].at);
    for (const [f] of oldest.slice(0, cache.size - CACHE_MAX + 50)) cache.delete(f);
  }
  if (stat.size > st.offset) {
    const fd = fs.openSync(file, 'r');
    try {
      const CH = 4 * 1024 * 1024;
      while (st.offset < stat.size) {
        const len = Math.min(CH, stat.size - st.offset);
        const buf = Buffer.alloc(len);
        fs.readSync(fd, buf, 0, len, st.offset);
        st.offset += len;
        const lines = (st.rest + buf.toString('utf8')).split('\n');
        st.rest = lines.pop();
        for (const l of lines) ingest(st, l);
      }
    } finally { fs.closeSync(fd); }
  }
  st.size = stat.size;
  return st;
}

function totals(st, since = 0) {
  const t = { in: 0, out: 0, cr: 0, cw: 0, cost: 0 };
  for (const [h, b] of Object.entries(st.hours)) if (+h + 3600e3 > since) for (const k in t) t[k] += b[k];
  return t;
}

function findTranscript(id) {
  if (!/^[\w-]+$/.test(id || '')) return null;
  // Antigravity brain logs
  const agyLog = path.join(BRAIN_DIR, id, '.system_generated', 'logs', 'transcript.jsonl');
  if (fs.existsSync(agyLog)) return agyLog;
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

// ---------------------------------------------------------------- export Markdown
function exportMarkdown(file, title) {
  const out = [`# ${title || 'Conversation'}`, ''];
  let last = '';
  for (const line of fs.readFileSync(file, 'utf8').split('\n')) {
    if (!line.startsWith('{')) continue;
    let o; try { o = JSON.parse(line); } catch { continue; }

    // AGY user request
    if (o.type === 'USER_INPUT' && o.content) {
      let t = o.content;
      const m = t.match(/<USER_REQUEST>([\s\S]*?)<\/USER_REQUEST>/);
      if (m) t = m[1].trim();
      out.push('## 🧑 Vous', '', t, '');
      last = 'user';
    }
    // AGY response
    else if (o.type === 'PLANNER_RESPONSE') {
      const parts = [];
      if (o.content && o.content.trim()) parts.push(o.content.trim());
      if (Array.isArray(o.tool_calls)) {
        for (const tc of o.tool_calls) {
          parts.push(`- 🔧 **${tc.name}** ${target(tc.args) ? '`' + target(tc.args).replace(/`/g, "'").slice(0, 160) + '`' : ''}`);
        }
      }
      if (parts.length) {
        if (last !== 'agent') out.push('## 🔷 Antigravity', '');
        out.push(parts.join('\n\n'), '');
        last = 'agent';
      }
    }
    // Claude user request
    else if (o.type === 'user' && o.message && !o.isMeta) {
      const c = o.message.content;
      const txt = typeof c === 'string' ? c : Array.isArray(c) ? (c.find(p => p.type === 'text') || {}).text : null;
      if (txt && !txt.startsWith('<') && !txt.startsWith('Caveat:')) {
        out.push('## 🧑 Vous', '', txt, '');
        last = 'user';
      }
    }
    // Claude assistant response
    else if (o.type === 'assistant' && o.message) {
      const parts = [];
      for (const b of Array.isArray(o.message.content) ? o.message.content : []) {
        if (b.type === 'text' && b.text) parts.push(b.text.trim());
        else if (b.type === 'tool_use') parts.push(`- 🔧 **${b.name}** ${target(b.input) ? '`' + target(b.input).replace(/`/g, "'").slice(0, 160) + '`' : ''}`);
      }
      if (parts.length) {
        if (last !== 'agent') out.push('## 🧡 Claude Code', '');
        out.push(parts.join('\n\n'), '');
        last = 'agent';
      }
    }
  }
  return out.join('\n');
}

module.exports = function (ctx) {
  const { route, json, sessions, history } = ctx;

  route('GET', /^\/api\/sessions\/(\w+)\/usage$/, async ({ res, m }) => {
    const s = sessions.get(m[1]); if (!s) return json(res, 404, { error: 'session inconnue' });
    const f = findTranscript(s.conversationId || s.claudeSessionId || s.id);
    if (!f) return json(res, 200, { total: { in: 0, out: 0, cr: 0, cw: 0, cost: 0 }, models: {} });
    const st = read(f);
    const models = Object.fromEntries(Object.entries(st.models).map(([k, v]) => [k, { ...v, cost: cost(k, v) }]));
    json(res, 200, { total: totals(st), models, since: st.first, last: st.last });
  });

  // Vue globale
  route('GET', /^\/api\/usage$/, async ({ res }) => {
    const now = Date.now(), weekAgo = now - 7 * 86400e3;
    const today = new Date(); today.setHours(0, 0, 0, 0);
    const agg = { h5: { in: 0, out: 0, cr: 0, cw: 0, cost: 0 }, today: { in: 0, out: 0, cr: 0, cw: 0, cost: 0 }, d7: { in: 0, out: 0, cr: 0, cw: 0, cost: 0 } };
    const perDay = {}, top = [];
    const hist = history();
    const titles = new Map(hist.map(h => [h.id, h.title]));
    const managed = new Map([...sessions.values()].map(s => [s.conversationId || s.claudeSessionId, s.name]).filter(([k]) => !!k));

    // Antigravity transcripts
    try {
      if (fs.existsSync(BRAIN_DIR)) {
        for (const id of fs.readdirSync(BRAIN_DIR)) {
          const file = path.join(BRAIN_DIR, id, '.system_generated', 'logs', 'transcript.jsonl');
          let stat; try { stat = fs.statSync(file); } catch { continue; }
          if (stat.mtimeMs < weekAgo) continue;
          const st = read(file); if (!st) continue;
          const add = (a, b) => { for (const k in a) a[k] += b[k]; };
          add(agg.h5, totals(st, now - 5 * 3600e3)); add(agg.today, totals(st, +today)); add(agg.d7, totals(st, weekAgo));
          const w = totals(st, weekAgo);
          top.push({ id, agent: 'agy', name: managed.get(id) || titles.get(id) || id.slice(0, 8), ...w });
        }
      }
    } catch { }

    // Claude Code transcripts
    try {
      if (fs.existsSync(CLAUDE_PROJECTS_DIR)) {
        for (const d of fs.readdirSync(CLAUDE_PROJECTS_DIR)) {
          if (/observer-sessions/i.test(d)) continue;
          const pDir = path.join(CLAUDE_PROJECTS_DIR, d);
          let files = []; try { files = fs.readdirSync(pDir).filter(f => f.endsWith('.jsonl')); } catch { continue; }
          for (const f of files) {
            const file = path.join(pDir, f);
            let stat; try { stat = fs.statSync(file); } catch { continue; }
            if (stat.mtimeMs < weekAgo) continue;
            const st = read(file); if (!st) continue;
            const add = (a, b) => { for (const k in a) a[k] += b[k]; };
            add(agg.h5, totals(st, now - 5 * 3600e3)); add(agg.today, totals(st, +today)); add(agg.d7, totals(st, weekAgo));
            const w = totals(st, weekAgo);
            const id = path.basename(f, '.jsonl');
            top.push({ id, agent: 'claude', name: managed.get(id) || titles.get(id) || id.slice(0, 8), ...w });
          }
        }
      }
    } catch { }

    top.sort((a, b) => b.cost - a.cost);
    let agyQuota = null, claudeQuota = null;
    try {
      [agyQuota, claudeQuota] = await Promise.all([
        getAgyQuota().catch(() => null),
        getClaudeQuota().catch(() => null)
      ]);
    } catch { }
    json(res, 200, { ...agg, perDay, top: top.slice(0, 15), agyQuota, claudeQuota, note: 'Coût estimé indicatif pour les modèles Claude & Antigravity.' });
  });

  route('GET', /^\/api\/sessions\/(\w+)\/timeline$/, async ({ res, m }) => {
    const s = sessions.get(m[1]); if (!s) return json(res, 404, { error: 'session inconnue' });
    const f = findTranscript(s.conversationId || s.claudeSessionId || s.id);
    json(res, 200, f ? read(f).tools.slice(-500) : []);
  });

  route('GET', /^\/api\/history\/([\w-]+)\/export$/, async ({ res, m }) => {
    const f = findTranscript(m[1]); if (!f) return json(res, 404, { error: 'conversation introuvable' });
    const title = (history().find(h => h.id === m[1]) || {}).title;
    json(res, 200, { title: title || m[1], markdown: exportMarkdown(f, title) });
  });
};
