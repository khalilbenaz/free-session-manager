'use strict';
// Verrouillage des sessions par mot de passe (côté page). Le serveur applique le verrou (lib/lock.js) :
// ici on affiche l'écran de déverrouillage, on garde les tickets de cette fenêtre et on efface le
// contenu du terminal à chaque reverrouillage.
(() => {
  const F = window.csmFeatures;
  const tickets = new Map(); // sessionId -> ticket (cette fenêtre seulement, en mémoire)
  window.csmUnlockHeader = () => [...tickets].map(([id, tk]) => `${id}:${tk}`).join(',');
  const isLockedHere = id => !!sessions.get(id)?.locked && !tickets.has(id);
  F.isLockedHere = isLockedHere;
  const esc = s => String(s ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);

  // ---------------------------------------------------------------- écran de verrouillage dans les panneaux
  function overlays() {
    paneEls().forEach((p, i) => {
      const id = panes[i];
      let ov = p.querySelector('.lockov');
      const locked = id && sessions.has(id) && isLockedHere(id);
      if (!locked) { ov?.remove(); return; }
      if (!ov || ov.dataset.id !== id) {
        ov?.remove();
        const s = sessions.get(id);
        ov = document.createElement('form');
        ov.className = 'lockov'; ov.dataset.id = id;
        ov.innerHTML = `<div class="lockbox"><div class="lockic">🔒</div><h3></h3><p class="hint">${t('Session verrouillée. Elle continue de tourner ; son contenu est masqué.')}</p>
          <input type="password" autocomplete="current-password" placeholder="${t('Mot de passe')}">
          <p class="lockhint hint"></p><p class="lockerr err"></p><button class="primary">${t('Déverrouiller')}</button></div>`;
        ov.querySelector('h3').textContent = s.name;
        ov.querySelector('.lockhint').textContent = s.lockHint ? `${t('Indice')} : ${s.lockHint}` : '';
        ov.onsubmit = e => {
          e.preventDefault();
          const pw = ov.querySelector('input').value;
          if (!pw) return;
          ov.querySelector('button').disabled = true;
          send({ t: 'unlock', id, password: pw });
        };
        ov.addEventListener('mousedown', e => e.stopPropagation());
        p.querySelector('.pslot').appendChild(ov);
      }
      if (i === focusedPane) setTimeout(() => ov.querySelector('input')?.focus(), 30);
    });
  }
  F.lockOverlays = overlays;

  window.addEventListener('csm:ws', e => {
    const m = e.detail;
    if (m.t === 'unlock-result') {
      const ov = document.querySelector(`.lockov[data-id="${m.id}"]`);
      if (m.ok) {
        tickets.set(m.id, m.ticket);
        terms.get(m.id)?.term.reset(); // la relecture complète arrive juste après
        overlays(); render(); renderPanes();
        requestAnimationFrame(() => terms.get(m.id)?.term.focus());
      } else if (ov) {
        ov.querySelector('.lockerr').textContent = t(m.error) || m.error;
        ov.querySelector('button').disabled = false;
        const inp = ov.querySelector('input'); inp.select(); inp.focus();
      }
    } else if (m.t === 'relocked') purge(m.id);
  });

  // Reverrouille ici : ticket oublié, terminal vidé (le contenu ne reste pas en mémoire de la page).
  function purge(id) {
    tickets.delete(id);
    const tt = terms.get(id);
    if (tt) { tt.term.reset(); tt.term.clear(); }
    overlays(); render();
  }
  // Verrouillée ailleurs (autre fenêtre, API) : ce qui est déjà affiché ici est effacé aussitôt.
  window.addEventListener('csm:session', e => { const { prev, s } = e.detail; if (s.locked && !prev?.locked && !tickets.has(s.id)) purge(s.id); else if (!s.locked && prev?.locked) { tickets.delete(s.id); overlays(); } });
  F.lockNow = id => { if (sessions.get(id)?.locked) { send({ t: 'lock', id }); purge(id); } };
  const lockAll = () => { for (const id of [...tickets.keys()]) F.lockNow(id); };

  // ---------------------------------------------------------------- définir / changer / retirer le mot de passe
  async function askPassword({ title, needCurrent, confirmNew = true, hintField = true }) {
    const d = $('#dlgLock');
    $('#lkTitle').textContent = title;
    $('#lkCurRow').hidden = !needCurrent;
    $('#lkNewRow').hidden = !confirmNew; $('#lkNew2Row').hidden = !confirmNew; $('#lkHintRow').hidden = !hintField;
    for (const x of ['#lkCur', '#lkNew', '#lkNew2', '#lkHint']) $(x).value = '';
    $('#lkErr').textContent = '';
    d.returnValue = ''; d.showModal();
    (needCurrent ? $('#lkCur') : $('#lkNew')).focus();
    return new Promise(res => {
      const done = () => { d.removeEventListener('close', onClose); };
      const onClose = () => {
        done();
        if (d.returnValue !== 'ok') return res(null);
        res({ current: $('#lkCur').value, password: $('#lkNew').value, hint: $('#lkHint').value.trim() });
      };
      d.addEventListener('close', onClose);
    });
  }
  // validation avant fermeture (les deux saisies identiques, 4 caractères minimum)
  $('#dlgLock form').addEventListener('submit', e => {
    if (e.submitter?.value !== 'ok' || $('#lkNewRow').hidden) return;
    const a = $('#lkNew').value, b = $('#lkNew2').value;
    if (a.length < 4) { e.preventDefault(); $('#lkErr').textContent = t('4 caractères minimum.'); return; }
    if (a !== b) { e.preventDefault(); $('#lkErr').textContent = t('Les deux mots de passe ne correspondent pas.'); }
  });

  F.setPassword = async id => {
    const s = sessions.get(id); if (!s) return;
    const r = await askPassword({ title: s.locked ? `${t('Changer le mot de passe')} — ${s.name}` : `${t('Verrouiller')} « ${s.name} »`, needCurrent: s.locked && !tickets.has(id) });
    if (!r) return;
    try {
      const v = await api('POST', `/api/sessions/${id}/lock`, r);
      sessions.set(id, v); purge(id);
      toast(t('Session verrouillée'));
    } catch (e) { toast(e.message, true); }
  };
  F.removePassword = async id => {
    const s = sessions.get(id); if (!s?.locked) return;
    const r = await askPassword({ title: `${t('Retirer le mot de passe')} — ${s.name}`, needCurrent: true, confirmNew: false, hintField: false });
    if (!r) return;
    try { const v = await api('POST', `/api/sessions/${id}/unlock-remove`, { password: r.current }); sessions.set(id, v); render(); overlays(); toast(t('Mot de passe retiré')); }
    catch (e) { toast(t(e.message) || e.message, true); }
  };
  F.lockItems = id => {
    const s = sessions.get(id); if (!s) return [];
    if (!s.locked) return [[t('Verrouiller par mot de passe…'), () => F.setPassword(id)]];
    return [
      ...(tickets.has(id) ? [[t('Verrouiller maintenant'), () => F.lockNow(id), { kbd: `${MOD}+Alt+L` }]] : []),
      [t('Changer le mot de passe…'), () => F.setPassword(id)],
      [t('Retirer le mot de passe…'), () => F.removePassword(id)],
    ];
  };

  // ---------------------------------------------------------------- reverrouillage automatique
  let lastInput = Date.now();
  for (const ev of ['keydown', 'mousedown', 'wheel']) document.addEventListener(ev, () => { lastInput = Date.now(); }, true);
  document.addEventListener('visibilitychange', () => { if (document.hidden && SETTINGS.lockOnHide !== false) lockAll(); });
  setInterval(() => {
    const m = Number(SETTINGS.autoLockMinutes) || 0;
    if (m > 0 && tickets.size && Date.now() - lastInput > m * 60000) lockAll();
  }, 15000);
  document.addEventListener('keydown', e => {
    if (e.ctrlKey && e.altKey && e.key.toLowerCase() === 'l' && active) { e.preventDefault(); if (sessions.get(active)?.locked) F.lockNow(active); else F.setPassword(active); }
  }, true);
})();
