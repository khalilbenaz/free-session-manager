'use strict';
// Consommation, chronologie des outils et export de conversation des sessions natives (transcripts DATA/transcripts/<id>.jsonl).
const fs = require('fs');
const path = require('path');
const { DATA } = require('./config');
const { getOpenrouterQuota, getKiloQuota, getOpencodeQuota } = require('./agents');

// Tarifs indicatifs des modèles ($ par million de tokens)
const PRICES = [
  [/gpt-oss/, 0, 0],
  [/:free|openrouter\/free/, 0, 0],
];

function price(model) {
  if (/:free|openrouter\/free/i.test(model || '')) return { i: 0, o: 0 };
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

function ingest(st, line) {
  if (!line.startsWith('{')) return;
  let o; try { o = JSON.parse(line); } catch { return; }
  const ts = o.created_at ? Date.parse(o.created_at) : (o.timestamp ? Date.parse(o.timestamp) : 0);
  if (ts) { st.first = st.first || ts; st.last = Math.max(st.last, ts); }

  // Format natif Free Session Manager : {role, content, timestamp}
  if ((o.role === 'user' || o.type === 'user') && (o.content || o.text)) {
    const txt = String(o.content || o.text).trim();
    st.tools.push({ ts: ts || Date.now(), name: 'Question', target: txt.slice(0, 300) });
    const inTokens = Math.max(1, Math.round(txt.length / 4));
    const m = st.models['openrouter/free'] = st.models['openrouter/free'] || { in: 0, out: 0, cr: 0, cw: 0 };
    m.in += inTokens;
    const h = Math.floor((ts || Date.now()) / 3600e3) * 3600e3;
    const b = st.hours[h] = st.hours[h] || { in: 0, out: 0, cr: 0, cw: 0, cost: 0 };
    b.in += inTokens;
    if (st.tools.length > 2000) st.tools.splice(0, st.tools.length - 2000);
    return;
  }
  if ((o.role === 'assistant' || o.role === 'agent' || o.type === 'assistant') && (o.content || o.text)) {
    const txt = String(o.content || o.text).trim();
    st.tools.push({ ts: ts || Date.now(), name: 'Réponse IA', target: txt.slice(0, 300) });
    const outTokens = Math.max(1, Math.round(txt.length / 4));
    const m = st.models['openrouter/free'] = st.models['openrouter/free'] || { in: 0, out: 0, cr: 0, cw: 0 };
    m.out += outTokens;
    const h = Math.floor((ts || Date.now()) / 3600e3) * 3600e3;
    const b = st.hours[h] = st.hours[h] || { in: 0, out: 0, cr: 0, cw: 0, cost: 0 };
    b.out += outTokens;
    if (st.tools.length > 2000) st.tools.splice(0, st.tools.length - 2000);
    return;
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
  const fsmFile = path.join(DATA, 'transcripts', `${id}.jsonl`);
  if (fs.existsSync(fsmFile)) return fsmFile;
  return null;
}

// ---------------------------------------------------------------- export Markdown
function exportMarkdown(file, title) {
  const out = [`# ${title || 'Conversation'}`, ''];
  let last = '';
  for (const line of fs.readFileSync(file, 'utf8').split('\n')) {
    if (!line.startsWith('{')) continue;
    let o; try { o = JSON.parse(line); } catch { continue; }

    const txt = String(o.content || o.text || '').trim();
    if (!txt) continue;
    if (o.role === 'user') { out.push('## 🧑 Vous', '', txt, ''); last = 'user'; }
    else if (o.role === 'assistant' || o.role === 'agent') {
      if (last !== 'agent') out.push('## 🤖 Agent', '');
      out.push(txt, '');
      last = 'agent';
    }
  }
  return out.join('\n');
}

module.exports = function (ctx) {
  const { route, json, sessions, history } = ctx;

  route('GET', /^\/api\/sessions\/(\w+)\/usage$/, async ({ res, m }) => {
    const s = sessions.get(m[1]); if (!s) return json(res, 404, { error: 'session inconnue' });
    const f = findTranscript(s.conversationId || s.claudeSessionId || s.id);
    if (!f) {
      if (s.buf) {
        const cleanBuf = s.buf.replace(/\x1b\[[0-9;]*[a-zA-Z]/g, '');
        const chars = cleanBuf.length;
        const estTokens = Math.round(chars / 4);
        const inTok = Math.round(estTokens * 0.3);
        const outTok = estTokens - inTok;
        const modName = s.model || 'openrouter/free';
        return json(res, 200, {
          total: { in: inTok, out: outTok, cr: 0, cw: 0, cost: 0 },
          models: { [modName]: { in: inTok, out: outTok, cr: 0, cw: 0, cost: 0 } },
          since: s.createdAt, last: s.lastActivity
        });
      }
      return json(res, 200, { total: { in: 0, out: 0, cr: 0, cw: 0, cost: 0 }, models: {} });
    }
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
    const byConv = new Map([...sessions.values()].map(s => [s.conversationId || s.claudeSessionId || s.id, s]));

    const TR = path.join(DATA, 'transcripts');
    const add = (a, b) => { for (const k in a) a[k] += b[k]; };
    let files = []; try { files = fs.readdirSync(TR).filter(f => f.endsWith('.jsonl')); } catch { }
    for (const f of files) {
      const file = path.join(TR, f);
      let stat; try { stat = fs.statSync(file); } catch { continue; }
      if (stat.mtimeMs < weekAgo) continue;
      const st = read(file); if (!st) continue;
      add(agg.h5, totals(st, now - 5 * 3600e3)); add(agg.today, totals(st, +today)); add(agg.d7, totals(st, weekAgo));
      const id = path.basename(f, '.jsonl');
      const s = byConv.get(id);
      top.push({ id, agent: (s && s.agent) || 'kilo', name: (s && s.name) || titles.get(id) || id.slice(0, 8), ...totals(st, weekAgo) });
    }

    top.sort((a, b) => b.cost - a.cost);
    let openrouterQuota = null, kiloQuota = null, opencodeQuota = null;
    try {
      openrouterQuota = await getOpenrouterQuota().catch(() => null);
      kiloQuota = getKiloQuota();
      opencodeQuota = getOpencodeQuota();
    } catch { }
    json(res, 200, {
      ...agg, perDay, top: top.slice(0, 15),
      openrouterQuota, kiloQuota, opencodeQuota,
      note: 'Tokens estimés (≈ 4 caractères par token) ; 0 $ pour les modèles :free.'
    });
  });

  route('GET', /^\/api\/sessions\/(\w+)\/timeline$/, async ({ res, m }) => {
    const s = sessions.get(m[1]); if (!s) return json(res, 404, { error: 'session inconnue' });
    const f = findTranscript(s.conversationId || s.claudeSessionId || s.id);
    let tools = f ? (read(f)?.tools?.slice(-500) || []) : [];
    if (!tools.length && s.buf) {
      const cleanBuf = s.buf.replace(/\x1b\[[0-9;]*[a-zA-Z]/g, '');
      for (const line of cleanBuf.split('\n')) {
        const tr = line.trim();
        if (tr.startsWith('❯') || tr.startsWith('>')) {
          tools.push({ ts: s.lastActivity || Date.now(), name: 'Question', target: tr.replace(/^[❯>]\s*/, '') });
        } else if (tr.startsWith('OpenRouter (') || tr.startsWith('Kilo (') || tr.startsWith('OpenCode (')) {
          tools.push({ ts: s.lastActivity || Date.now(), name: 'Réponse IA', target: tr });
        }
      }
    }
    json(res, 200, tools);
  });

  route('GET', /^\/api\/history\/([\w-]+)\/export$/, async ({ res, m }) => {
    const f = findTranscript(m[1]); if (!f) return json(res, 404, { error: 'conversation introuvable' });
    const title = (history().find(h => h.id === m[1]) || {}).title;
    json(res, 200, { title: title || m[1], markdown: exportMarkdown(f, title) });
  });
};
