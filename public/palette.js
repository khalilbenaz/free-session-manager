'use strict';
// Palette de commandes (#5), recherche dans les sessions (#19), envoi groupé (#18),
// file d'attente (#17), bibliothèque de prompts (#16).
(() => {
  const F = window.csmFeatures;
  const esc = s => String(s ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);
  let prompts = [];
  const loadPrompts = async () => { try { prompts = await api('GET', '/api/prompts'); } catch { prompts = []; } return prompts; };
  window.addEventListener('csm:prompts', e => { prompts = e.detail; });

  // Correspondance floue : toutes les lettres de la requête, dans l'ordre ; bonus début de mot / contiguïté.
  function score(q, text) {
    if (!q) return 1;
    const s = text.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
    q = q.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
    const direct = s.indexOf(q);
    if (direct >= 0) return 1000 - direct + (direct === 0 || /\W/.test(s[direct - 1]) ? 200 : 0);
    let i = 0, sc = 0, run = 0;
    for (const c of s) { if (c === q[i]) { i++; run++; sc += run; if (i === q.length) return sc; } else run = 0; }
    return 0;
  }

  // ---------------------------------------------------------------- palette
  const RECENT = LS.get('csm.recent', []);
  let items = [], sel = 0;
  function actions() {
    const s = sessions.get(active);
    const a = [
      ['⊕', t('Nouvelle session'), () => openNew(), `${MOD}+Alt+N`],
      ['🕘', t('Historique des conversations'), () => openHistory(), `${MOD}+Alt+H`],
      ['🔎', t('Rechercher dans toutes les sessions'), () => F.openSearch(), `${MOD}+Maj+F`],
      ['📣', t('Envoyer à plusieurs sessions'), () => F.openBroadcast(), `${MOD}+Alt+B`],
      ['📚', t('Bibliothèque de prompts'), () => F.openPrompts(active)],
      ['±', t('Panneau Modifications'), () => F.togglePanel('changes'), `${MOD}+Alt+G`],
      ['🕑', t('Chronologie de la session'), () => F.showPanel('timeline')],
      ['💰', t('Consommation'), () => F.showPanel('usage')],
      ['▢', t('Disposition : une session'), () => setLayout('1')],
      ['◫', t('Disposition : deux colonnes'), () => setLayout('2c')],
      ['⊟', t('Disposition : deux lignes'), () => setLayout('2r')],
      ['⊞', t('Disposition : grille 2×2'), () => setLayout('4')],
      ['⛶', t('Mode focus (masquer la barre latérale)'), () => { document.body.classList.toggle('focusmode'); requestAnimationFrame(() => fitAll(true)); }, `${MOD}+Alt+F`],
      ['⇤', t('Barre latérale compacte'), () => saveSettings({ compactSidebar: !SETTINGS.compactSidebar })],
      ['◐', t('Thème : basculer clair / sombre'), () => saveSettings({ theme: themeName() === 'dark' ? 'light' : 'dark' })],
      ['⚙', t('Réglages'), () => F.openSettings(), `${MOD}+,`],
      ['🩺', t('Diagnostic'), () => F.openSettings('diag')],
      ['📜', t('Journaux'), () => F.openSettings('logs')],
    ];
    if (s) a.push(
      ['✎', `${t('Renommer')} « ${s.name} »`, () => renameSession(s.id), `${MOD}+Alt+R`],
      ['🔀', `${t('Basculer vers')} ${AGENT_LABEL[s.agent === 'agy' ? 'claude' : 'agy']}`, () => switchAgent(s.id), `${MOD}+Alt+S`],
      ['📤', t('Aperçu du transfert de contexte'), () => previewHandoff(s.id)],
      ['↗', t('Ouvrir dans l’éditeur'), () => openIn(s.id, 'editor'), `${MOD}+Alt+E`],
      ['📁', IS_MAC ? t('Ouvrir dans le Finder') : t('Ouvrir dans l’Explorateur'), () => openIn(s.id, 'folder')],
      ['⌨', t('Ouvrir un terminal ici'), () => openIn(s.id, 'terminal')],
      ['⏳', t('File d’attente de la session'), () => F.openQueue(s.id), `${MOD}+Alt+Q`],
      ['⬇', t('Exporter la conversation'), () => F.exportConversation(s)],
      ['⚡', t('Enregistrer la session comme modèle'), () => saveSessionAsTemplate(s.id)],
      ['↻', s.alive ? t('Relancer la session') : t('Reprendre la session'), () => api('POST', `/api/sessions/${s.id}/restart`)],
      ['✕', t('Fermer la session'), () => closeSession(s.id), `${MOD}+Alt+W`],
      ['🔒', s.locked ? t('Verrouiller maintenant') : t('Verrouiller par mot de passe…'), () => (s.locked ? F.lockNow(s.id) : F.setPassword(s.id)), `${MOD}+Alt+L`],
    );
    return a.map(([icon, label, run, kbd]) => ({ kind: 'action', icon, label, run, kbd }));
  }
  async function build(q) {
    const list = [
      ...sorted().map(s => ({ kind: 'session', icon: '●', cls: s.status, label: s.name, sub: `${s.worktree ? '⎇ ' + s.worktree.branch + ' · ' : ''}${s.cwd}`, run: () => select(s.id) })),
      ...templates.map(x => ({ kind: 'template', icon: '⚡', label: `${t('Lancer le modèle')} : ${x.name}`, sub: x.cwd, run: () => openNew(x) })),
      ...prompts.map(p => ({ kind: 'prompt', icon: '📝', label: `${t('Prompt')} : ${p.title}`, sub: p.text.slice(0, 90), run: () => insertPrompt(active, p) })),
      ...actions(),
      ...(q.length >= 2 ? historyCache.filter(h => !h.managed).slice(0, 200).map(h => ({ kind: 'history', icon: '🕘', label: h.title, sub: `${h.cwd || ''} · ${new Date(h.mtime).toLocaleDateString()}`, run: () => resumeHistory(h) })) : []),
    ];
    return list.map(x => ({ ...x, sc: score(q, `${x.label} ${x.sub || ''}`) + (RECENT.indexOf(x.label) >= 0 ? 50 - RECENT.indexOf(x.label) : 0) }))
      .filter(x => x.sc > 0).sort((a, b) => b.sc - a.sc).slice(0, 60);
  }
  async function renderPalette() {
    const q = $('#palInput').value.trim();
    items = await build(q);
    sel = Math.min(sel, Math.max(0, items.length - 1));
    const KIND = { session: t('session'), template: t('modèle'), prompt: t('prompt'), action: t('action'), history: t('conversation') };
    $('#palList').innerHTML = items.map((x, i) => `<li data-i="${i}" class="${i === sel ? 'sel' : ''}"><span class="pi ${x.kind === 'session' ? 'dot ' + x.cls : ''}">${x.kind === 'session' ? '' : esc(x.icon)}</span>
      <span class="pl">${esc(x.label)}${x.sub ? `<small>${esc(x.sub)}</small>` : ''}</span><span class="pk">${x.kbd ? `<kbd>${esc(x.kbd)}</kbd>` : esc(KIND[x.kind])}</span></li>`).join('')
      || `<li class="hint">${t('Aucun résultat')}</li>`;
    $('#palList').querySelectorAll('li[data-i]').forEach(li => { li.onmousedown = e => { e.preventDefault(); run(+li.dataset.i); }; });
    $('#palList').children[sel]?.scrollIntoView({ block: 'nearest' });
  }
  function run(i) {
    const x = items[i]; if (!x) return;
    $('#dlgPalette').close();
    const ix = RECENT.indexOf(x.label); if (ix >= 0) RECENT.splice(ix, 1);
    RECENT.unshift(x.label); RECENT.length = Math.min(RECENT.length, 20); LS.set('csm.recent', RECENT);
    setTimeout(x.run, 0);
  }
  F.openPalette = async () => {
    const d = $('#dlgPalette');
    if (d.open) { d.close(); return; }
    $('#palInput').value = ''; sel = 0;
    d.showModal(); $('#palInput').focus();
    loadTemplates(); loadPrompts(); if (!historyCache.length) loadHistory().then(renderPalette);
    renderPalette();
  };
  $('#palInput').oninput = () => { sel = 0; renderPalette(); };
  $('#palInput').onkeydown = e => {
    if (e.key === 'ArrowDown') { sel = Math.min(items.length - 1, sel + 1); renderPalette(); e.preventDefault(); }
    else if (e.key === 'ArrowUp') { sel = Math.max(0, sel - 1); renderPalette(); e.preventDefault(); }
    else if (e.key === 'Enter') { e.preventDefault(); run(sel); }
  };
  $('#dlgPalette').addEventListener('click', e => { if (e.target === $('#dlgPalette')) $('#dlgPalette').close(); });
  $('#dlgPalette').addEventListener('close', () => terms.get(active)?.term.focus());
  $('#btnPalette').onclick = () => F.openPalette();
  $('#palKbd').textContent = IS_MAC ? '⌘K' : 'Ctrl+K';

  // ---------------------------------------------------------------- recherche dans les terminaux ouverts
  F.openSearch = () => { $('#srchInput').value = ''; $('#srchList').innerHTML = ''; $('#dlgSearch').showModal(); $('#srchInput').focus(); };
  $('#srchClose').onclick = () => $('#dlgSearch').close();
  let srchTimer = null;
  $('#srchInput').oninput = () => { clearTimeout(srchTimer); srchTimer = setTimeout(doSearch, 150); };
  function doSearch() {
    const q = $('#srchInput').value.trim().toLowerCase();
    const out = [];
    if (q.length >= 2) for (const s of sorted()) {
      const tt = terms.get(s.id); if (!tt) continue;
      const b = tt.term.buffer.active;
      for (let y = 0; y < b.length && out.length < 300; y++) {
        const line = b.getLine(y)?.translateToString(true) || '';
        const i = line.toLowerCase().indexOf(q);
        if (i >= 0) out.push({ s, y, line, i });
      }
    }
    $('#srchList').innerHTML = out.length ? out.map((r, k) => `<li data-k="${k}"><b>${esc(r.s.name)}</b><code>${esc(r.line.slice(Math.max(0, r.i - 40), r.i))}<mark>${esc(r.line.substr(r.i, q.length))}</mark>${esc(r.line.slice(r.i + q.length, r.i + q.length + 80))}</code></li>`).join('')
      : q.length >= 2 ? `<li class="hint">${t('Aucun résultat dans les terminaux ouverts.')}</li>` : '';
    $('#srchList').querySelectorAll('li[data-k]').forEach(li => {
      li.onclick = () => {
        const r = out[+li.dataset.k];
        $('#dlgSearch').close(); select(r.s.id);
        requestAnimationFrame(() => { const tt = terms.get(r.s.id); tt.term.scrollToLine(Math.max(0, r.y - 5)); tt.term.select(r.i, r.y, q.length); });
      };
    });
  }

  // ---------------------------------------------------------------- variables de prompt
  function fill(text, id) {
    const s = sessions.get(id);
    const sel = terms.get(id)?.term.getSelection() || '';
    return text.replace(/\{dossier\}|\{folder\}/g, s?.cwd || '').replace(/\{branche\}|\{branch\}/g, s?.worktree?.branch || '')
      .replace(/\{nom\}|\{name\}/g, s?.name || '').replace(/\{selection\}/g, sel);
  }
  // Insère dans la ligne de saisie de Claude sans valider (l'utilisateur relit puis Entrée).
  function insertPrompt(id, p) {
    if (!id) return;
    const tt = terms.get(id); if (!tt) return;
    select(id);
    tt.term.paste(fill(p.text, id));
    tt.term.focus();
  }

  // ---------------------------------------------------------------- bibliothèque de prompts
  let prTarget = null;
  F.openPrompts = async id => {
    prTarget = id || active;
    $('#prSearch').value = '';
    $('#dlgPrompts').showModal(); $('#prSearch').focus();
    await loadPrompts(); renderPrompts();
  };
  $('#prClose').onclick = () => $('#dlgPrompts').close();
  $('#prSearch').oninput = () => renderPrompts();
  $('#prNew').onclick = () => editPrompt(null);
  function renderPrompts() {
    const q = $('#prSearch').value.trim();
    const list = prompts.map((p, i) => ({ p, i, sc: score(q, `${p.title} ${p.tags} ${p.text}`) })).filter(x => x.sc > 0).sort((a, b) => b.sc - a.sc);
    $('#prList').innerHTML = list.length ? list.map(({ p, i }) => `<li data-i="${i}"><div><b>${esc(p.title)}</b>${p.tags ? `<span class="tag">${esc(p.tags)}</span>` : ''}<small>${esc(p.text.slice(0, 160))}</small></div>
      <span class="acts"><button data-a="use" class="primary">${t('Insérer')}</button><button data-a="send">${t('Envoyer')}</button><button data-a="edit">✎</button></span></li>`).join('')
      : `<li class="hint">${prompts.length ? t('Aucun résultat') : t('Aucun prompt. « + Nouveau » pour en créer un (ex. « Relis les modifications et propose des tests »).')}</li>`;
    $('#prList').querySelectorAll('li[data-i]').forEach(li => {
      const p = prompts[+li.dataset.i];
      li.querySelector('[data-a=use]').onclick = () => { $('#dlgPrompts').close(); insertPrompt(prTarget, p); };
      li.querySelector('[data-a=send]').onclick = () => { $('#dlgPrompts').close(); sendTo([prTarget], fill(p.text, prTarget), true); };
      li.querySelector('[data-a=edit]').onclick = () => editPrompt(+li.dataset.i);
    });
  }
  async function editPrompt(i) {
    const p = i == null ? { title: '', text: '', tags: '' } : prompts[i];
    $('#peTitle').value = p.title; $('#peText').value = p.text; $('#peTags').value = p.tags || '';
    $('#peDelete').hidden = i == null;
    const d = $('#dlgPromptEdit'); d.returnValue = ''; d.showModal(); $('#peTitle').focus();
    const r = await new Promise(res => d.addEventListener('close', () => res(d.returnValue), { once: true }));
    if (r === 'delete') prompts.splice(i, 1);
    else if (r === 'ok') {
      const v = { ...p, title: $('#peTitle').value.trim(), text: $('#peText').value, tags: $('#peTags').value.trim() };
      if (i == null) prompts.push(v); else prompts[i] = v;
    } else return;
    try { prompts = await api('PUT', '/api/prompts', prompts); } catch (e) { toast(e.message, true); }
    renderPrompts();
  }
  $('#peDelete').onclick = () => { if (confirm(t('Supprimer ce prompt ?'))) $('#dlgPromptEdit').close('delete'); };

  // ---------------------------------------------------------------- envoi (direct ou file d'attente)
  async function sendTo(ids, text, queueIfBusy) {
    let n = 0;
    for (const id of ids) {
      const s = sessions.get(id); if (!s) continue;
      try {
        if (queueIfBusy && s.status !== 'idle') await api('PUT', `/api/sessions/${id}/queue`, [...(s.queue || []), { text }]);
        else await api('POST', `/api/sessions/${id}/prompt`, { text });
        n++;
      } catch (e) { toast(`${s.name} : ${e.message}`, true); }
    }
    if (n) toast(`${t('Envoyé à')} ${n} ${t(n > 1 ? 'sessions' : 'session')}`);
  }

  F.openBroadcast = () => {
    const alive = sorted().filter(s => s.alive);
    $('#bcList').innerHTML = alive.map(s => `<label class="check"><input type="checkbox" value="${s.id}" ${visibleIds().includes(s.id) ? 'checked' : ''}> <span class="dot ${s.status}"></span> <span>${esc(s.name)}</span></label>`).join('')
      || `<p class="hint">${t('Aucune session active.')}</p>`;
    $('#bcText').value = ''; $('#bcQueue').checked = true;
    const d = $('#dlgBroadcast'); d.returnValue = ''; d.showModal(); $('#bcText').focus();
    d.addEventListener('close', () => {
      if (d.returnValue !== 'ok') return;
      const ids = [...$('#bcList').querySelectorAll('input:checked')].map(x => x.value);
      if (ids.length) sendTo(ids, $('#bcText').value, $('#bcQueue').checked);
    }, { once: true });
  };

  // ---------------------------------------------------------------- file d'attente
  let qId = null;
  F.openQueue = id => {
    qId = id; const s = sessions.get(id); if (!s) return;
    $('#qName').textContent = s.name; $('#qNew').value = '';
    renderQueue(); $('#dlgQueue').showModal(); $('#qNew').focus();
  };
  function renderQueue() {
    const s = sessions.get(qId); const q = s?.queue || [];
    $('#qList').innerHTML = q.length ? q.map((x, i) => `<li data-i="${i}"><span>${esc(x.text.slice(0, 300))}</span><span class="acts">
      <button class="icon" data-a="up" title="${t('Monter')}" ${i ? '' : 'disabled'}>↑</button><button class="icon" data-a="del" title="${t('Retirer')}">✕</button></span></li>`).join('')
      : `<li class="hint">${t('File vide.')}</li>`;
    $('#qList').querySelectorAll('li[data-i]').forEach(li => {
      const i = +li.dataset.i;
      li.querySelector('[data-a=del]').onclick = () => saveQueue(q.filter((_, k) => k !== i));
      li.querySelector('[data-a=up]').onclick = () => { const c = q.slice(); [c[i - 1], c[i]] = [c[i], c[i - 1]]; saveQueue(c); };
    });
  }
  async function saveQueue(q) {
    try { const v = await api('PUT', `/api/sessions/${qId}/queue`, q); sessions.set(qId, v); renderQueue(); render(); } catch (e) { toast(e.message, true); }
  }
  $('#qAdd').onclick = () => {
    const text = $('#qNew').value.trim(); if (!text) return;
    $('#qNew').value = '';
    saveQueue([...(sessions.get(qId)?.queue || []), { text }]);
  };
  $('#qNew').addEventListener('keydown', e => { if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) { e.preventDefault(); $('#qAdd').click(); } });
  $('#curQueue').onclick = () => active && F.openQueue(active);
  window.addEventListener('csm:session', e => { if ($('#dlgQueue').open && e.detail.s.id === qId) renderQueue(); });
})();
