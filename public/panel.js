'use strict';
// Panneau latéral : Modifications (#12), Chronologie (#21), Consommation (#20) ; export (#24) et groupes (#13).
(() => {
  const F = window.csmFeatures;
  let tab = LS.get('csm.panelTab', 'changes');
  let open = LS.get('csm.panelOpen', false);
  let gitState = null, selFile = null, busy = false;

  const esc = s => String(s ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);
  const fmtN = n => n >= 1e6 ? (n / 1e6).toFixed(1) + ' M' : n >= 1e3 ? (n / 1e3).toFixed(1) + ' k' : String(n || 0);
  const fmt$ = n => (n || 0) < 0.01 ? '< 0,01 $' : (n || 0).toFixed(2).replace('.', ',') + ' $';

  function setOpen(v, which) {
    open = v; if (which) tab = which;
    LS.set('csm.panelOpen', open); LS.set('csm.panelTab', tab);
    $('#panel').hidden = !open;
    document.querySelectorAll('.ptabs [data-tab]').forEach(b => b.classList.toggle('on', b.dataset.tab === tab));
    for (const n of ['changes', 'timeline', 'usage']) $(`#tab-${n}`).hidden = n !== tab;
    $('#btnChanges').classList.toggle('on', open && tab === 'changes');
    requestAnimationFrame(() => fitAll(true));
    if (open) refresh();
  }
  F.showPanel = which => setOpen(true, which);
  F.togglePanel = which => setOpen(!(open && tab === which), which);
  $('#btnChanges').onclick = () => F.togglePanel('changes');
  $('#panelClose').onclick = () => setOpen(false);
  document.querySelectorAll('.ptabs [data-tab]').forEach(b => { b.onclick = () => setOpen(true, b.dataset.tab); });

  function refresh() {
    if (F.isLockedHere?.(active)) {
      $('#changesCount').textContent = t('Modifications'); $('#btnChanges').classList.remove('has');
      for (const n of ['changes', 'timeline', 'usage']) $(`#tab-${n}`).innerHTML = `<p class="hint">🔒 ${t('Session verrouillée')}</p>`;
      return;
    }
    if (tab === 'changes' || !open) loadChanges(); // compteur de la barre toujours à jour
    if (!open) return;
    if (tab === 'timeline') loadTimeline();
    if (tab === 'usage') loadUsage();
  }

  // ---------------------------------------------------------------- Modifications
  async function loadChanges() {
    const id = active; if (!id) return;
    try { gitState = await api('GET', `/api/sessions/${id}/git`); } catch (e) { gitState = { error: e.message }; }
    if (id !== active) return;
    const n = gitState?.files?.length || 0;
    $('#changesCount').textContent = gitState?.repo ? (n ? `${n}` : '0') : t('Modifs');
    $('#btnChanges').title = gitState?.repo
      ? (n ? `${n} ${t(n > 1 ? 'fichiers modifiés' : 'fichier modifié')} (Ctrl+Alt+G)` : `${t('Aucune modification')} (Ctrl+Alt+G)`)
      : `${t('Modifications')} (Ctrl+Alt+G)`;
    $('#btnChanges').classList.toggle('has', n > 0);
    if (open && tab === 'changes') renderChanges();
  }

  function renderChanges() {
    const el = $('#tab-changes');
    const st = gitState;
    if (!st) { el.innerHTML = `<p class="hint">${t('Chargement…')}</p>`; return; }
    if (st.error) { el.innerHTML = `<p class="err">${esc(st.error)}</p>`; return; }
    if (!st.repo) { el.innerHTML = `<p class="hint">${t('Le dossier de cette session n’est pas un dépôt git.')}</p>`; return; }
    const s = sessions.get(active);
    const files = st.files;
    el.innerHTML = `
      <div class="gitHead">
        <span class="branch">⎇ ${esc(st.branch)}</span>
        ${st.ahead != null ? `<span class="hint">↑${st.ahead} ↓${st.behind}</span>` : ''}
        <span class="spacer"></span>
        <button class="icon" data-act="refresh" title="${t('Actualiser')}">⟳</button>
      </div>
      ${s?.worktree ? `<div class="wtInfo">${t('Worktree dédié')} · ${t('base')} <b>${esc(s.worktree.base)}</b>
        <button data-act="merge">${t('Fusionner dans')} ${esc(s.worktree.base)}</button></div>` : ''}
      ${files.length ? `<ul class="files">${files.map((f, i) => `
        <li data-i="${i}" class="${f.path === selFile ? 'sel' : ''}">
          <span class="fst st-${f.index === '?' ? 'new' : f.state === 'supprimé' ? 'del' : 'mod'}" title="${esc(f.state)}${f.staged ? ' · ' + t('indexé') : ''}">${f.index === '?' ? 'N' : f.state === 'supprimé' ? 'S' : f.state === 'renommé' ? 'R' : 'M'}</span>
          <span class="fp" title="${esc(f.path)}">${esc(f.path.split('/').pop())}<small>${esc(f.path.includes('/') ? f.path.slice(0, f.path.lastIndexOf('/')) : '')}</small></span>
          <button class="icon" data-act="discard" title="${t('Annuler les modifications de ce fichier')}">↺</button>
        </li>`).join('')}</ul>
        <div class="commit">
          <textarea id="commitMsg" rows="2" placeholder="${t('Message du commit')}" spellcheck="false"></textarea>
          <div class="row"><button data-act="suggest">${t('Proposer un message')}</button><span class="spacer"></span><button class="primary" data-act="commit">${t('Committer tout')} (${files.length})</button></div>
        </div>
        <div id="diffView" class="diff">${selFile ? '' : `<p class="hint">${t('Cliquer un fichier pour voir le diff.')}</p>`}</div>`
        : `<p class="hint">${t('Aucune modification dans ce dossier.')}</p>`}`;
    el.querySelectorAll('.files li').forEach(li => {
      li.onclick = e => { if (e.target.closest('button')) return; showDiff(files[+li.dataset.i].path); };
      li.querySelector('[data-act=discard]').onclick = () => discard(files[+li.dataset.i]);
    });
    el.querySelector('[data-act=refresh]').onclick = () => loadChanges();
    el.querySelector('[data-act=commit]')?.addEventListener('click', commit);
    el.querySelector('[data-act=suggest]')?.addEventListener('click', suggest);
    el.querySelector('[data-act=merge]')?.addEventListener('click', merge);
    if (selFile && files.some(f => f.path === selFile)) showDiff(selFile, true);
  }

  async function showDiff(p, keep) {
    selFile = p;
    if (!keep) $('#tab-changes').querySelectorAll('.files li').forEach(li => li.classList.toggle('sel', gitState.files[+li.dataset.i].path === p));
    const box = $('#diffView'); if (!box) return;
    try {
      const { diff } = await api('GET', `/api/sessions/${active}/git/diff?path=${encodeURIComponent(p)}`);
      box.innerHTML = `<div class="dfile">${esc(p)}</div><pre>${diff.split('\n').map(l => {
        const c = l.startsWith('+++') || l.startsWith('---') || l.startsWith('diff ') || l.startsWith('index ') ? 'dh' : l.startsWith('@@') ? 'dat' : l.startsWith('+') ? 'dadd' : l.startsWith('-') ? 'ddel' : '';
        return `<span class="${c}">${esc(l)}</span>`;
      }).join('\n') || t('(fichier binaire ou vide)')}</pre>`;
    } catch (e) { box.innerHTML = `<p class="err">${esc(e.message)}</p>`; }
  }

  async function discard(f) {
    if (!confirm(`${t('Annuler toutes les modifications de')} ${f.path} ?${f.index === '?' ? '\n' + t('Le fichier (non suivi) sera supprimé.') : ''}`)) return;
    try { await api('POST', `/api/sessions/${active}/git/discard`, { paths: [f.path] }); if (selFile === f.path) selFile = null; loadChanges(); }
    catch (e) { toast(e.message, true); }
  }

  function suggest() {
    const files = gitState.files;
    const add = files.filter(f => f.index === '?' || f.state === 'ajouté').map(f => f.path.split('/').pop());
    const del = files.filter(f => f.state === 'supprimé').map(f => f.path.split('/').pop());
    const mod = files.filter(f => !add.includes(f.path.split('/').pop()) && f.state !== 'supprimé').map(f => f.path.split('/').pop());
    const parts = [];
    if (mod.length) parts.push(`${t('Modifie')} ${mod.slice(0, 3).join(', ')}${mod.length > 3 ? '…' : ''}`);
    if (add.length) parts.push(`${t('ajoute')} ${add.slice(0, 3).join(', ')}${add.length > 3 ? '…' : ''}`);
    if (del.length) parts.push(`${t('supprime')} ${del.slice(0, 3).join(', ')}${del.length > 3 ? '…' : ''}`);
    const s = sessions.get(active);
    $('#commitMsg').value = (parts.join(', ') || t('Mise à jour')).replace(/^./, c => c.toUpperCase()) + (s ? `\n\n${t('Session')} : ${s.name}` : '');
    $('#commitMsg').focus();
  }

  async function commit() {
    const msg = $('#commitMsg').value.trim();
    if (!msg) { suggest(); return; }
    busy = true;
    try { await api('POST', `/api/sessions/${active}/git/commit`, { message: msg, all: true }); toast(t('Commit créé')); selFile = null; loadChanges(); }
    catch (e) { toast(e.message, true); } finally { busy = false; }
  }

  async function merge() {
    const s = sessions.get(active); if (!s?.worktree) return;
    if (!confirm(`${t('Fusionner la branche')} ${s.worktree.branch} ${t('dans')} ${s.worktree.base} ?`)) return;
    try { await api('POST', `/api/sessions/${active}/worktree/merge`); toast(`${t('Fusionné dans')} ${s.worktree.base}`); loadChanges(); }
    catch (e) { alert(e.message); }
  }

  // ---------------------------------------------------------------- Chronologie
  const ICON = { Read: '📖', Edit: '✏️', MultiEdit: '✏️', Write: '📝', Bash: '▶', Grep: '🔎', Glob: '🗂', WebFetch: '🌐', WebSearch: '🌐', Task: '🤖', Agent: '🤖', TodoWrite: '☑', NotebookEdit: '📓' };
  async function loadTimeline() {
    const el = $('#tab-timeline');
    let list = [];
    try { list = await api('GET', `/api/sessions/${active}/timeline`); } catch (e) { el.innerHTML = `<p class="err">${esc(e.message)}</p>`; return; }
    if (!list.length) { el.innerHTML = `<p class="hint">${t('Aucune action pour l’instant.')}</p>`; return; }
    const s = sessions.get(active);
    el.innerHTML = `<ul class="timeline">${list.slice().reverse().map(x => `
      <li title="${esc(x.target)}"><span class="ti">${ICON[x.name] || '•'}</span>
        <span class="tn">${esc(x.name)}</span>
        <span class="tt">${esc(x.target.replace(s?.cwd || '\u0000', '.'))}</span>
        <span class="tw">${x.ts ? new Date(x.ts).toLocaleTimeString((F.locale ? F.locale() : 'fr-FR'), { hour: '2-digit', minute: '2-digit' }) : ''}</span></li>`).join('')}</ul>`;
  }

  function fmtRemainingTime(targetTs) {
    if (!targetTs) return '';
    const diff = targetTs - Date.now();
    if (diff <= 0) return t('Réinitialisé');
    const mins = Math.floor(diff / 60000);
    const hours = Math.floor(mins / 60);
    const remMins = mins % 60;
    const days = Math.floor(hours / 24);
    const remHours = hours % 24;
    if (days > 0) return `${t('dans')} ${days}j ${remHours}h`;
    if (hours > 0) return `${t('dans')} ${hours}h ${remMins}m`;
    return `${t('dans')} ${remMins}m`;
  }

  function renderQuotaCards(quotas, updatedAt) {
    if (!quotas || !quotas.length) {
      return `<p class="hint">${t('Aucune donnée de quota Antigravity disponible pour le moment.')}</p>`;
    }
    return `
      <div class="quota-grid">
        ${quotas.map(q => {
          const rem = q.remainingPercent != null ? q.remainingPercent : 0;
          const used = q.usedPercent != null ? q.usedPercent : (100 - rem);
          const colorClass = rem > 50 ? 'quota-good' : (rem >= 20 ? 'quota-warn' : 'quota-crit');
          const resetDateStr = q.resetTime ? new Date(q.resetTime).toLocaleString((F.locale ? F.locale() : 'fr-FR'), { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }) : (q.resetIso || '');
          const resetRel = q.resetTime ? fmtRemainingTime(q.resetTime) : '';
          return `
            <div class="quota-card ${colorClass}">
              <div class="quota-card-head">
                <span class="quota-cat">${esc(q.category)}</span>
                <span class="quota-limit-name">${esc(q.limitName)}</span>
              </div>
              <div class="quota-bar-wrap">
                <div class="quota-bar">
                  <div class="quota-bar-fill" style="width: ${rem}%"></div>
                </div>
              </div>
              <div class="quota-stats-row">
                <div class="quota-stat">
                  <span class="quota-label">${t('Restant')}</span>
                  <span class="quota-val-rem">${rem}%</span>
                </div>
                <div class="quota-stat">
                  <span class="quota-label">${t('Utilisé')}</span>
                  <span class="quota-val-used">${used}%</span>
                </div>
                <div class="quota-stat reset">
                  <span class="quota-label">${t('Réinitialisation')}</span>
                  <span class="quota-val-reset" title="${esc(resetDateStr)}">${resetRel ? `<b>${resetRel}</b>` : ''} <small>(${esc(resetDateStr)})</small></span>
                </div>
              </div>
            </div>
          `;
        }).join('')}
      </div>
      ${updatedAt ? `<div class="quota-foot-hint"><small>${t('Dernière mise à jour')} : ${new Date(updatedAt).toLocaleTimeString()}</small></div>` : ''}
    `;
  }
  F.renderQuotaCards = renderQuotaCards;
  F.fmtRemainingTime = fmtRemainingTime;
  F.esc = esc;

  // ---------------------------------------------------------------- Consommation
  async function loadUsage() {
    const el = $('#tab-usage');
    el.innerHTML = `<p class="hint">${t('Calcul…')}</p>`;
    try {
      const [mine, all] = await Promise.all([active ? api('GET', `/api/sessions/${active}/usage`) : null, api('GET', '/api/usage')]);
      const row = (label, u) => `<tr><td>${label}</td><td>${fmtN(u.in + u.cr + u.cw)}</td><td>${fmtN(u.out)}</td><td>${fmt$(u.cost)}</td></tr>`;
      const days = Object.entries(all.perDay).sort();
      const max = Math.max(1, ...days.map(([, v]) => v));

      const isClaude = sessions.get(active)?.agent === 'claude';
      const activeAgent = isClaude ? 'claude' : 'agy';
      const activeData = isClaude ? all.claudeQuota : all.agyQuota;

      const renderAgentBox = (agent, qData) => {
        const isAgy = agent === 'agy';
        const title = isAgy ? `🔷 ${t('Quotas Antigravity (agy)')}` : `🧡 ${t('Quotas Claude Code')}`;
        const refId = isAgy ? 'btnRefreshTabAgyQuota' : 'btnRefreshTabClaudeQuota';
        const hasCards = qData?.quotas?.length > 0;
        const bodyHtml = hasCards
          ? renderQuotaCards(qData.quotas, qData.updatedAt)
          : `<p class="hint">${esc(qData?.error || (isAgy ? t('Aucune donnée de quota Antigravity disponible pour le moment.') : t('Aucune donnée de quota Claude Code disponible pour le moment.')))}</p>`;
        return `
          <div class="usage-agy-quota-box" data-quota-agent="${agent}">
            <div class="usage-head-row">
              <h3>${title}</h3>
              <button type="button" class="mini-btn" id="${refId}" title="${t('Actualiser')}">⟳</button>
            </div>
            ${bodyHtml}
          </div>
        `;
      };

      const quotaBoxHtml = renderAgentBox(activeAgent, activeData);

      el.innerHTML = `
        ${quotaBoxHtml}
        <h3>${t('Cette session')}</h3>
        ${mine ? `<table class="usage"><tr><th></th><th>${t('Entrée')}</th><th>${t('Sortie')}</th><th>${t('Coût estimé')}</th></tr>
          ${row(t('Total'), mine.total)}
          ${Object.entries(mine.models).map(([m, u]) => row(`<small>${esc(m)}</small>`, u)).join('')}</table>` : ''}
        <h3>${t('Toutes les sessions')}</h3>
        <table class="usage"><tr><th></th><th>${t('Entrée')}</th><th>${t('Sortie')}</th><th>${t('Coût estimé')}</th></tr>
          ${row(t('5 dernières heures'), all.h5)}${row(t('Aujourd’hui'), all.today)}${row(t('7 derniers jours'), all.d7)}</table>
        <div class="bars">${days.map(([d, v]) => `<div class="bar" title="${d} : ${fmtN(v)} tokens"><i style="height:${Math.round(v / max * 100)}%"></i><span>${d.slice(8)}</span></div>`).join('')}</div>
        <h3>${t('Sessions les plus coûteuses (7 jours)')}</h3>
        <ul class="topUse">${all.top.map(x => `<li><span>${esc(x.name)}</span><b>${fmt$(x.cost)}</b></li>`).join('')}</ul>
        <p class="hint">${t('Coût estimé aux tarifs API publics, à titre indicatif (inclus dans un abonnement Claude). Entrée = tokens lus, cache compris.')}</p>`;

      const refBtn = $(`#btnRefreshTab${activeAgent === 'agy' ? 'Agy' : 'Claude'}Quota`);
      if (refBtn) {
        refBtn.onclick = async () => {
          refBtn.disabled = true;
          try {
            await api('GET', `/api/agents/${activeAgent}/quota?force=true`);
            loadUsage();
          } catch (e) {
            toast(e.message, true);
          } finally {
            refBtn.disabled = false;
          }
        };
      }
    } catch (e) { el.innerHTML = `<p class="err">${esc(e.message)}</p>`; }
  }

  // ---------------------------------------------------------------- export de conversation
  F.exportConversation = async (s) => {
    const id = s.claudeSessionId || s.id;
    let r;
    try { r = await api('GET', `/api/history/${id}/export`); } catch (e) { return toast(e.message, true); }
    const name = (s.name || r.title || 'conversation').replace(/[^\w\- ]+/g, '').trim().slice(0, 60) || 'conversation';
    showMenu([
      [t('Enregistrer en Markdown (.md)'), () => download(`${name}.md`, r.markdown, 'text/markdown')],
      [t('Copier le Markdown'), () => clip.copy(r.markdown).then(() => toast(t('Copié')))],
      [t('Imprimer / PDF…'), () => printMarkdown(r.title, r.markdown)],
    ], ...lastMenuPos);
  };
  function download(name, text, type) {
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([text], { type: `${type};charset=utf-8` }));
    a.download = name; document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 2000);
  }
  F.download = download;
  // Rendu Markdown minimal (titres, code, listes, gras) pour l'impression — iframe sans script.
  function printMarkdown(title, md) {
    const blocks = md.split(/\n```/);
    const html = md.replace(/[&<>]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' })[c])
      .replace(/```[\w-]*\n([\s\S]*?)```/g, (_, c) => `<pre>${c}</pre>`)
      .replace(/^### (.*)$/gm, '<h3>$1</h3>').replace(/^## (.*)$/gm, '<h2>$1</h2>').replace(/^# (.*)$/gm, '<h1>$1</h1>')
      .replace(/^&gt; (.*)$/gm, '<blockquote>$1</blockquote>').replace(/^- (.*)$/gm, '<li>$1</li>')
      .replace(/\*\*(.+?)\*\*/g, '<b>$1</b>').replace(/`([^`]+)`/g, '<code>$1</code>')
      .replace(/\n{2,}/g, '<br><br>');
    void blocks;
    const f = document.createElement('iframe');
    f.style.cssText = 'position:fixed;width:0;height:0;border:0;right:0;bottom:0';
    f.sandbox = 'allow-modals allow-same-origin';
    document.body.appendChild(f);
    f.srcdoc = `<!doctype html><meta charset="utf-8"><title>${esc(title)}</title><style>body{font:13px/1.55 -apple-system,Segoe UI,sans-serif;max-width:780px;margin:24px auto;color:#111}h1{font-size:22px}h2{font-size:15px;margin-top:22px;border-bottom:1px solid #ddd}pre,code{font-family:Consolas,Menlo,monospace;font-size:12px}pre{background:#f5f5f5;padding:8px;white-space:pre-wrap}blockquote{color:#666;margin:0}li{margin-left:18px}</style>${html}`;
    f.onload = () => { f.contentWindow.focus(); f.contentWindow.print(); setTimeout(() => f.remove(), 60000); };
  }

  // ---------------------------------------------------------------- groupe
  F.setGroup = async id => {
    const s = sessions.get(id); if (!s) return;
    const existing = [...new Set([...sessions.values()].map(x => x.group).filter(Boolean))];
    const g = await askName(t('Groupe de la session'), s.group || '', (existing.length ? `${t('Groupes existants')} : ${existing.join(', ')}. ` : '') + t('« - » pour retirer la session de son groupe.'), true);
    if (g === null) return;
    api('POST', `/api/sessions/${id}/meta`, { group: g.trim() === '-' ? '' : g }).catch(e => toast(e.message, true));
  };

  // ---------------------------------------------------------------- rafraîchissements
  window.addEventListener('csm:active', debounce(refresh, 150));
  window.addEventListener('csm:session', e => {
    const { prev, s } = e.detail;
    // fin d'un tour de Claude : les fichiers ont pu changer
    if (s.id === active && prev && prev.status !== s.status && (s.status === 'idle' || s.status === 'attention') && !busy) refresh();
  });
  setInterval(() => { if (document.visibilityState === 'visible') loadChanges(); }, 20000);
  function debounce(fn, ms) { let h; return () => { clearTimeout(h); h = setTimeout(fn, ms); }; }
  window.addEventListener('csm:ready', () => setOpen(open));
})();
