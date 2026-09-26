'use strict';
// File d'attente de prompts (#17) : « quand cette session a fini, envoyer ce prompt ».
// Envoi en « collage entre crochets » (bracketed paste) : le texte multiligne arrive d'un bloc dans Claude.

module.exports = function (ctx) {
  const { route, on, json, readBody, sessions, publicView, persist, broadcast } = ctx;
  const clean = q => (Array.isArray(q) ? q : []).slice(0, 50)
    .map(x => ({ id: /^[\w-]{1,40}$/.test(x.id || '') ? x.id : Math.random().toString(36).slice(2, 10), text: String(x.text || '').slice(0, 20000) }))
    .filter(x => x.text.trim());

  function sendPrompt(s, text) {
    if (!s.pty) return false;
    s.pty.write(`\x1b[200~${text}\x1b[201~`);
    setTimeout(() => { if (s.pty) s.pty.write('\r'); }, 150);
    return true;
  }
  ctx.sendPrompt = sendPrompt;

  route('PUT', /^\/api\/sessions\/(\w+)\/queue$/, async ({ req, res, m }) => {
    const s = sessions.get(m[1]); if (!s) return json(res, 404, { error: 'session inconnue' });
    const q = clean(await readBody(req));
    s.queue = q.length ? q : undefined;
    persist(); broadcast({ t: 'session', s: publicView(s) });
    // session déjà prête : on envoie tout de suite le premier
    if (q.length && s.pty && s.status === 'idle') next(s);
    json(res, 200, publicView(s));
  });

  // Envoi direct d'un prompt (bibliothèque, envoi groupé, modèle de session)
  route('POST', /^\/api\/sessions\/(\w+)\/prompt$/, async ({ req, res, m }) => {
    const s = sessions.get(m[1]); if (!s) return json(res, 404, { error: 'session inconnue' });
    const { text, submit } = await readBody(req);
    if (!s.pty) return json(res, 409, { error: 'session arrêtée' });
    const t = String(text || '').slice(0, 20000);
    if (submit === false) s.pty.write(`\x1b[200~${t}\x1b[201~`); else sendPrompt(s, t);
    json(res, 200, { ok: true });
  });

  function next(s) {
    if (!s.queue || !s.queue.length || !s.pty) return;
    const [first, ...rest] = s.queue;
    s.queue = rest.length ? rest : undefined;
    persist(); broadcast({ t: 'session', s: publicView(s) });
    setTimeout(() => sendPrompt(s, first.text), 600); // laisse Claude afficher son invite
  }
  on('idle', s => next(s));

  // Premier prompt d'un modèle de session : envoyé dès que la session est prête.
  on('start', s => { if (s.initialPrompt) { const t = s.initialPrompt; delete s.initialPrompt; setTimeout(() => sendPrompt(s, t), 1200); } });
};
