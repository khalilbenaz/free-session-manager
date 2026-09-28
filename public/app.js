'use strict';
const $ = s => document.querySelector(s);
window.$ = $;
const TOKEN = document.querySelector('meta[name="sm-token"]')?.content || document.querySelector('meta[name="asm-token"]')?.content || document.querySelector('meta[name="csm-token"]')?.content || '';
const IS_MAC = /Mac/i.test(navigator.platform || navigator.userAgent);
window.IS_MAC = IS_MAC;
const MOD = IS_MAC ? '⌘' : 'Ctrl';
window.MOD = MOD;
const AGENT_LABEL = { kilo: 'Kilo Free', opencode: 'OpenCode', openrouter: 'OpenRouter Free' };
window.AGENT_LABEL = AGENT_LABEL;
const getNextAgent = cur => cur === 'kilo' ? 'opencode' : (cur === 'opencode' ? 'openrouter' : 'kilo');
window.getNextAgent = getNextAgent;
/** Vrai pour ⌘+Alt sur macOS, Ctrl+Alt ailleurs. */
const isModAlt = e => (IS_MAC ? e.metaKey : e.ctrlKey) && e.altKey;
window.isModAlt = isModAlt;
const LS = { get(k, d) { try { return JSON.parse(localStorage.getItem(k)) ?? d; } catch { return d; } }, set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch { } } };
window.LS = LS;

let AGENT_MODELS = {
  kilo: [
    { value: 'kilo/nvidia/nemotron-3-super-120b-a12b:free', label: '⚡ Nemotron 3 Super 120B (Free)' },
    { value: 'kilo/nvidia/nemotron-3-ultra-550b-a55b:free', label: '⚡ Nemotron 3 Ultra 550B (Free)' },
    { value: 'kilo/nvidia/nemotron-3.5-lightning:free', label: '⚡ Nemotron 3.5 Lightning (Free)' },
    { value: 'kilo/nvidia/nemotron-3-nano-omni-30b-a3b-reasoning:free', label: '⚡ Nemotron 3 Nano Omni (Free)' },
    { value: 'kilo/kilo-auto/free', label: '⚡ Kilo Auto (Free)' },
    { value: 'kilo/openrouter/free', label: '⚡ OpenRouter Free via Gateway (Auto)' },
    { value: 'kilo/liquid/lfm-2.5-2.6b:free', label: '⚡ Liquid LFM 2.5 2.6B (Free)' },
    { value: 'kilo/qwen/qwen3.8-27b:free', label: '⚡ Qwen 3.8 27B (Free)' },
    { value: 'kilo/google/gemma-4-31b-it:free', label: '⚡ Google Gemma 4 31B (Free)' },
    { value: 'kilo/google/gemma-4-26b-a4b-it:free', label: '⚡ Google Gemma 4 26B (Free)' },
    { value: 'kilo/cohere/north-mini-code:free', label: '⚡ Cohere North Mini Code (Free)' },
    { value: 'kilo/stepfun/step-3.7-flash:free', label: '⚡ StepFun 3.7 Flash (Free)' },
    { value: 'kilo/dots-studio/dots-3-note-preview:free', label: '⚡ Dots 3 Note Preview (Free)' },
    { value: 'kilo/poolside/laguna-s-2.1:free', label: '⚡ Poolside Laguna S 2.1 (Free)' },
    { value: 'kilo/poolside/laguna-xs-2.1:free', label: '⚡ Poolside Laguna XS 2.1 (Free)' },
    { value: 'kilo/inclusionai/ling-3.0-flash-fin:free', label: '⚡ InclusionAI Ling 3.0 Flash Fin (Free)' },
    { value: 'kilo/inclusionai/ling-3.0-flash-sante:free', label: '⚡ InclusionAI Ling 3.0 Flash Santé (Free)' },
    { value: 'kilo/thinkingmachines/inkling-small:free', label: '⚡ Thinking Machines Inkling Small (Free)' },
  ],
  opencode: [
    { value: 'opencode/nemotron-3-ultra-free', label: '💻 Nemotron 3 Ultra (Free)' },
    { value: 'opencode/nemotron-3.5-lightning-free', label: '💻 Nemotron 3.5 Lightning (Free)' },
    { value: 'opencode/ling-3.0-flash-fin-free', label: '💻 Ling 3.0 Flash Fin (Free)' },
    { value: 'opencode/longcat-2.5-preview-free', label: '💻 Longcat 2.5 Preview (Free)' },
    { value: 'opencode/mimo-v2.6-flash-free', label: '💻 Mimo v2.6 Flash (Free)' },
    { value: 'opencode/muse-spark-1.3-contributor-free', label: '💻 Muse Spark 1.3 Contributor (Free)' },
    { value: 'opencode/space-bunny-free', label: '💻 Space Bunny (Free)' },
    { value: 'opencode/big-pickle', label: '💻 Big Pickle (Free)' },
  ],
  openrouter: [
    { value: 'openrouter/openrouter/free', label: '🌐 OpenRouter Free (Auto)' },
    { value: 'openrouter/nvidia/nemotron-3-super-120b-a12b:free', label: '🌐 Nemotron 3 Super 120B (Free)' },
    { value: 'openrouter/nvidia/nemotron-3-ultra-550b-a55b:free', label: '🌐 Nemotron 3 Ultra 550B (Free)' },
    { value: 'openrouter/nvidia/nemotron-3.5-lightning:free', label: '🌐 Nemotron 3.5 Lightning (Free)' },
    { value: 'openrouter/nvidia/nemotron-3-nano-omni-30b-a3b-reasoning:free', label: '🌐 Nemotron 3 Nano Omni (Free)' },
    { value: 'openrouter/liquid/lfm-2.5-2.6b:free', label: '🌐 Liquid LFM 2.5 2.6B (Free)' },
    { value: 'openrouter/qwen/qwen3.8-27b:free', label: '🌐 Qwen 3.8 27B (Free)' },
    { value: 'openrouter/google/gemma-4-31b-it:free', label: '🌐 Google Gemma 4 31B (Free)' },
    { value: 'openrouter/google/gemma-4-26b-a4b-it:free', label: '🌐 Google Gemma 4 26B (Free)' },
    { value: 'openrouter/cohere/north-mini-code:free', label: '🌐 Cohere North Mini Code (Free)' },
    { value: 'openrouter/stepfun/step-3.7-flash:free', label: '🌐 StepFun 3.7 Flash (Free)' },
    { value: 'openrouter/dots-studio/dots-3-note-preview:free', label: '🌐 Dots 3 Note Preview (Free)' },
    { value: 'openrouter/poolside/laguna-s-2.1:free', label: '🌐 Poolside Laguna S 2.1 (Free)' },
    { value: 'openrouter/poolside/laguna-xs-2.1:free', label: '🌐 Poolside Laguna XS 2.1 (Free)' },
    { value: 'openrouter/inclusionai/ling-3.0-flash-fin:free', label: '🌐 InclusionAI Ling 3.0 Flash Fin (Free)' },
    { value: 'openrouter/inclusionai/ling-3.0-flash-sante:free', label: '🌐 InclusionAI Ling 3.0 Flash Santé (Free)' },
    { value: 'openrouter/thinkingmachines/inkling-small:free', label: '🌐 Thinking Machines Inkling Small (Free)' },
  ],
};
window.AGENT_MODELS = AGENT_MODELS;

const sessions = new Map(); // id -> public view
const terms = new Map();    // id -> { term, fit, el }
window.sessions = sessions;
window.terms = terms;
let active = LS.get('csm.active', null);
let ws = null;
let historyCache = [];

const STATUS_KEYS = { starting: 'démarrage', working: 'travaille', attention: 'attend une réponse', idle: 'prêt', exited: 'arrêtée' };
// Fonction (et non table figée au chargement) : les libellés suivent la langue choisie dans les réglages.
const statusLabel = st => t(STATUS_KEYS[st] || st);

// Réglages (serveur) : voir lib/settings.js. Valeurs par défaut en attendant la réponse.
let SETTINGS = { theme: 'system', fontSize: 14, fontFamily: '', defaultAgent: 'kilo', defaultMode: '', notifications: true, sound: 'soft', dnd: false, waitingMinutes: 10, longRunMinutes: 0, worktreeDefault: false, compactSidebar: false, autoUpdate: true, onboarded: true };
const THEMES = {
  dark: { background: '#101114', foreground: '#e6e6e6', cursor: '#d97757', selectionBackground: '#3a4150' },
  light: { background: '#fbfaf8', foreground: '#1f1b18', cursor: '#c4613f', selectionBackground: '#d9d2c7', black: '#1f1b18', brightBlack: '#6b6560', white: '#8b8580', brightWhite: '#1f1b18', yellow: '#9a6b00', brightYellow: '#8a5a00', green: '#1f7a3f', brightGreen: '#1a6b36', cyan: '#0e6f86', brightCyan: '#0b5f73', blue: '#1f5fbf', brightBlue: '#1a4fa0', magenta: '#8a3fa0', brightMagenta: '#7a2f90', red: '#c0392b', brightRed: '#a93226' },
};
const themeName = () => SETTINGS.theme === 'system' ? (matchMedia('(prefers-color-scheme: light)').matches ? 'light' : 'dark') : SETTINGS.theme;
const termTheme = () => THEMES[themeName()] || THEMES.dark;
function applySettings() {
  document.documentElement.dataset.theme = themeName();
  document.body.classList.toggle('compact', !!SETTINGS.compactSidebar);
  window.csmNative?.setPrefs?.({ minimizeToTray: SETTINGS.minimizeToTray !== false, closeToTray: SETTINGS.closeToTray !== false });
  for (const tt of terms.values()) {
    tt.term.options.theme = termTheme();
    if (SETTINGS.fontFamily) tt.term.options.fontFamily = SETTINGS.fontFamily;
  }
  fitAll(false);
}
matchMedia('(prefers-color-scheme: light)').addEventListener('change', () => SETTINGS.theme === 'system' && applySettings());
async function loadSettings() {
  try { SETTINGS = { ...SETTINGS, ...(await api('GET', '/api/settings')) }; } catch { }
  setLang(SETTINGS.lang); applySettings();
  publishLocale();
  await loadAgentModels();
}

async function loadAgentModels() {
  for (const ag of ['kilo', 'opencode', 'openrouter']) {
    try {
      const r = await api('GET', `/api/agents/${ag}/models`);
      if (r && Array.isArray(r.models) && r.models.length > 0) {
        AGENT_MODELS[ag] = r.models;
      }
    } catch { }
  }
}

/** La locale vit dans app.js : panel.js en a besoin pour formater dates et nombres. */
function publishLocale() {
  window.csmFeatures = window.csmFeatures || {};
  window.csmFeatures.locale = () => (SETTINGS.lang === 'en' ? 'en-GB' : 'fr-FR');
}
publishLocale();
async function saveSettings(patch) {
  SETTINGS = { ...SETTINGS, ...patch };
  applySettings();
  try { SETTINGS = await api('PUT', '/api/settings', patch); } catch (e) { toast(t('Réglage non enregistré : ') + e.message, true); }
}

async function api(method, url, body) {
  const r = await fetch(url, {
    method, headers: {
      'Content-Type': 'application/json',
      'X-SM-Token': TOKEN,
      'X-ASM-Token': TOKEN,
      'X-CSM-Token': TOKEN,
      'X-SM-Unlock': window.csmUnlockHeader?.() || '',
      'X-CSM-Unlock': window.csmUnlockHeader?.() || ''
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  if (!r.ok) throw new Error((await r.json().catch(() => ({}))).error || r.statusText);
  return r.json();
}
window.api = api;

// ------------------------------------------------------------------ terminaux
function ensureTerm(id) {
  if (terms.has(id)) return terms.get(id);
  const el = document.createElement('div');
  el.className = 'term';
  $('#park').appendChild(el);
  const term = new Terminal({
    fontFamily: SETTINGS.fontFamily || '"Cascadia Mono", "Cascadia Code", Consolas, "SF Mono", Menlo, monospace', fontSize: LS.get('csm.font', SETTINGS.fontSize || 14),
    cursorBlink: true, scrollback: 10000, allowProposedApi: true, macOptionIsMeta: true,
    theme: termTheme(),
  });
  const fit = new FitAddon.FitAddon();
  term.loadAddon(fit);
  term.loadAddon(new WebLinksAddon.WebLinksAddon((e, uri) => window.open(uri, '_blank')));
  term.open(el);
  el.addEventListener('pointerdown', () => term.focus());
  el.addEventListener('click', () => term.focus());
  term.onData(d => send({ t: 'input', id, d }));
  // clic / focus dans un panneau de la vue partagée : ce panneau devient le panneau actif
  term.textarea?.addEventListener('focus', () => {
    const i = panes.indexOf(id);
    if (i >= 0 && id !== active) { focusedPane = i; active = id; LS.set('csm.active', id); unread.delete(id); render(); renderPaneFrames(); }
  });
  // Images / fichiers : glisser-déposer ou coller → copie enregistrée par le serveur, chemin collé dans l'agent.
  el.addEventListener('dragover', e => { if (hasFiles(e.dataTransfer)) { e.preventDefault(); el.classList.add('dropping'); } });
  el.addEventListener('dragleave', e => { if (!el.contains(e.relatedTarget)) el.classList.remove('dropping'); });
  el.addEventListener('drop', e => {
    el.classList.remove('dropping');
    const files = [...(e.dataTransfer?.files || [])];
    if (!files.length) return;
    e.preventDefault();
    attachFiles(id, files);
  });
  el.addEventListener('paste', e => {
    const files = [...(e.clipboardData?.items || [])].filter(i => i.kind === 'file').map(i => i.getAsFile()).filter(Boolean);
    if (!files.length) return; // texte : xterm s'en charge
    e.preventDefault(); e.stopImmediatePropagation();
    attachFiles(id, files);
  }, true); // phase de capture : avant le gestionnaire de xterm, qui ne garderait que le texte
  term.attachCustomKeyEventHandler(e => {
    if (e.type !== 'keydown') return true;
    if (isModAlt(e) && globalShortcut(e)) return false;
    // Windows : Ctrl+C avec sélection = copier ; Ctrl+V = coller (texte) via le presse-papiers du navigateur.
    // macOS : Cmd+C / Cmd+V sont natifs ; Ctrl+C et Ctrl+V restent à l'agent (interrompre, coller une image).
    if (!IS_MAC && e.ctrlKey && !e.altKey && !e.shiftKey && e.key.toLowerCase() === 'c' && term.hasSelection()) {
      navigator.clipboard.writeText(term.getSelection()); term.clearSelection(); return false;
    }
    if (!IS_MAC && e.ctrlKey && !e.altKey && e.key.toLowerCase() === 'v') return false; // laisse l'événement paste natif
    if ((IS_MAC ? e.metaKey : e.ctrlKey) && (e.key === '=' || e.key === '+' || e.key === '-' || e.key === '0')) { zoom(e.key); e.preventDefault(); return false; }
    return true;
  });
  // Molette / trackpad : xterm 6 ignore les petits deltas en pixels (trackpad macOS) → défilement géré ici,
  // en cumulant les pixels jusqu'à une ligne. Hors mode souris de l'agent seulement (sinon xterm transmet).
  let wheelAcc = 0;
  term.attachCustomWheelEventHandler(e => {
    if (e.ctrlKey || term.modes.mouseTrackingMode !== 'none' || term.buffer.active.type !== 'normal') return true;
    const cell = term._core?._renderService?.dimensions?.css?.cell?.height || term.options.fontSize * 1.2;
    const lines = e.deltaMode === 1 ? e.deltaY : e.deltaMode === 2 ? e.deltaY * term.rows : e.deltaY / cell;
    wheelAcc += e.shiftKey || e.altKey ? lines * 5 : lines;
    const n = Math.trunc(wheelAcc);
    if (n) { wheelAcc -= n; term.scrollLines(n); }
    e.preventDefault();
    return false;
  });
  const t = { term, fit, el };
  terms.set(id, t);
  return t;
}

// Rendu GPU (WebGL) pour le terminal affiché seulement : fluide, et un seul contexte WebGL quel que soit
// le nombre de sessions (les navigateurs en limitent le nombre). Repli automatique sur le rendu DOM.
function gpu(t, on) {
  if (on && !t.webgl && window.WebglAddon) {
    try {
      const gl = new WebglAddon.WebglAddon();
      gl.onContextLoss(() => { gl.dispose(); t.webgl = null; });
      t.term.loadAddon(gl); t.webgl = gl;
    } catch { t.webgl = null; }
  } else if (!on && t.webgl) { try { t.webgl.dispose(); } catch { } t.webgl = null; }
}

function zoom(k) {
  let size = LS.get('csm.font', 14);
  size = k === '0' ? 14 : Math.max(9, Math.min(28, size + (k === '-' ? -1 : 1)));
  LS.set('csm.font', size);
  for (const t of terms.values()) t.term.options.fontSize = size;
  fitAll();
}

// redraw=true : force l'agent à repeindre tout l'écran (le PTY ne signale un resize que si la taille change,
// d'où l'aller-retour rows-1 → rows). Nécessaire après un changement de session ou une reconnexion,
// car le terminal caché a reçu la sortie à une autre taille.
function fitOne(id, redraw) {
  const t = id && terms.get(id);
  if (!t || !t.el.classList.contains('show')) return;
  try { t.fit.fit(); } catch { }
  // garde-fou : la dernière ligne ne doit jamais passer sous le bord visible (arrondis de cellule, zoom, fenêtre)
  try {
    const scr = t.el.querySelector('.xterm-screen');
    const limit = Math.min(t.el.parentElement.getBoundingClientRect().bottom, window.innerHeight);
    if (scr && t.term.rows > 3 && scr.getBoundingClientRect().bottom > limit - 2) t.term.resize(t.term.cols, t.term.rows - 1);
  } catch { }
  // un terminal resté caché (display:none) garde une barre de défilement fausse : la recalculer
  const resync = () => { try { t.term._core?._viewport?._sync?.(); } catch { } };
  resync(); requestAnimationFrame(resync); setTimeout(resync, 200);
  const { cols, rows } = t.term;
  if (!redraw && t.sent === `${cols}x${rows}`) return;
  t.sent = `${cols}x${rows}`;
  if (redraw) send({ t: 'resize', id, cols, rows: rows - 1 });
  setTimeout(() => send({ t: 'resize', id, cols, rows }), redraw ? 80 : 0);
  t.term.refresh(0, rows - 1);
}
function fitAll(redraw) { for (const id of visibleIds()) fitOne(id, redraw); }
const fitActive = redraw => fitOne(active, redraw);
new ResizeObserver(() => requestAnimationFrame(() => fitAll(false))).observe($('#terms'));
const redrawTimers = {};
function scheduleRedraw(id = active) { clearTimeout(redrawTimers[id]); redrawTimers[id] = setTimeout(() => fitOne(id, true), 150); }

// ------------------------------------------------------------------ vue partagée (#11)
// Disposition : 1 panneau, 2 colonnes, 2 lignes ou grille 2×2 ; chaque panneau affiche une session.
const LAYOUTS = { 1: 1, '2c': 2, '2r': 2, 4: 4 };
let layout = LS.get('csm.layout', '1');
let panes = LS.get('csm.panes', []);
let focusedPane = 0;
const paneEls = () => [...$('#terms').querySelectorAll(':scope > .pane')];
const visibleIds = () => panes.slice(0, LAYOUTS[layout] || 1).filter(id => id && sessions.has(id));

function setLayout(l) {
  if (!LAYOUTS[l]) return;
  layout = l; LS.set('csm.layout', l);
  const n = LAYOUTS[l];
  panes = panes.filter(id => sessions.has(id));
  if (active && !panes.slice(0, n).includes(active)) panes = [active, ...panes.filter(x => x !== active)];
  for (const s of sorted()) { if (panes.length >= n) break; if (!panes.includes(s.id)) panes.push(s.id); }
  panes = panes.slice(0, n);
  focusedPane = Math.max(0, panes.indexOf(active));
  renderPanes();
  document.querySelectorAll('[data-layout]').forEach(b => b.classList.toggle('on', b.dataset.layout === l));
}

function renderPaneFrames() {
  paneEls().forEach((p, i) => {
    p.classList.toggle('focused', i === focusedPane && (LAYOUTS[layout] || 1) > 1);
    const s = sessions.get(panes[i]);
    p.querySelector('.phead .dot').className = `dot ${s ? s.status : ''}`;
    p.querySelector('.phead .pn').textContent = s ? s.name : t('(vide — glisser une session ici)');
    p.querySelector('.phead .pb').textContent = s?.worktree ? `⎇ ${s.worktree.branch}` : '';
  });
  window.csmFeatures.lockOverlays?.();
}

function makePane() {
  const p = document.createElement('div');
  p.className = 'pane';
  p.innerHTML = '<div class="phead"><span class="dot"></span><span class="pn"></span><span class="pb"></span><button class="pclose">✕</button></div><div class="pslot"></div>';
  p.querySelector('.pclose').title = t('Vider ce panneau');
  const idx = () => paneEls().indexOf(p);
  p.addEventListener('mousedown', () => {
    const k = idx();
    if (k !== focusedPane) { focusedPane = k; if (panes[k]) select(panes[k]); else renderPaneFrames(); }
    else if (panes[k] && terms.has(panes[k])) { terms.get(panes[k]).term.focus(); }
  });
  p.querySelector('.pclose').onclick = e => { e.stopPropagation(); panes[idx()] = null; renderPanes(); };
  p.addEventListener('dragover', e => { if (e.dataTransfer.types.includes('text/csm-session')) { e.preventDefault(); p.classList.add('dragover'); } });
  p.addEventListener('dragleave', () => p.classList.remove('dragover'));
  p.addEventListener('drop', e => {
    const sid = e.dataTransfer.getData('text/csm-session'); p.classList.remove('dragover');
    if (!sid) return; e.preventDefault(); e.stopPropagation();
    const k = idx(), old = panes.indexOf(sid);
    if (old >= 0 && old !== k) panes[old] = panes[k] || null;
    panes[k] = sid; focusedPane = k; select(sid);
  });
  return p;
}

function renderPanes() {
  const n = LAYOUTS[layout] || 1;
  const grid = $('#terms');
  grid.dataset.layout = layout;
  while (paneEls().length < 4) grid.appendChild(makePane());
  paneEls().forEach((p, i) => { p.hidden = i >= n; });
  const shown = new Set(visibleIds());
  for (const [id, tt] of terms) {
    const slot = shown.has(id) ? paneEls()[panes.indexOf(id)].querySelector('.pslot') : $('#park');
    if (tt.el.parentElement !== slot) slot.appendChild(tt.el);
    tt.el.classList.toggle('show', shown.has(id));
    gpu(tt, shown.has(id));
  }
  LS.set('csm.panes', panes);
  renderPaneFrames();
  requestAnimationFrame(() => fitAll(true));
}

// ------------------------------------------------------------------ WebSocket
function send(m) { if (ws && ws.readyState === 1) ws.send(JSON.stringify(m)); }

function connect() {
  ws = new WebSocket(`ws://${location.host}/ws?token=${TOKEN}`);
  ws.onopen = () => { $('#conn').classList.remove('off'); checkServerVersion(); };
  ws.onclose = () => { $('#conn').classList.add('off'); setTimeout(connect, 1500); };
  ws.onmessage = ev => {
    let m; try { m = JSON.parse(ev.data); } catch { return; } // frame invalide : ignorée, pas d'exception non gérée
    window.dispatchEvent(new CustomEvent('csm:ws', { detail: m })); // modules (verrouillage…)
    if (m.t === 'sessions') {
      const ids = new Set(m.list.map(s => s.id));
      for (const id of [...sessions.keys()]) if (!ids.has(id)) removeLocal(id);
      for (const s of m.list) { sessions.set(s.id, s); const t = ensureTerm(s.id); t.term.reset(); }
      if (!sessions.has(active)) active = sorted()[0]?.id || null;
      render(); select(active); setLayout(layout);
    } else if (m.t === 'replay' || m.t === 'out') {
      ensureTerm(m.id).term.write(m.d);
      if (m.t === 'out' && m.id !== active) bump(m.id);
      if (m.t === 'replay' && visibleIds().includes(m.id)) scheduleRedraw(m.id);
    } else if (m.t === 'clear') {
      terms.get(m.id)?.term.reset();
    } else if (m.t === 'session') {
      const prev = sessions.get(m.s.id);
      sessions.set(m.s.id, m.s);
      ensureTerm(m.s.id);
      notifyTransition(prev, m.s);
      window.dispatchEvent(new CustomEvent('csm:session', { detail: { prev, s: m.s } }));
      render();
      if (!active) select(m.s.id);
      if (m.s.id === active) renderBar();
      if (panes.includes(m.s.id)) renderPaneFrames();
    } else if (m.t === 'settings') {
      const langChanged = m.settings.lang !== SETTINGS.lang;
      SETTINGS = { ...SETTINGS, ...m.settings }; applySettings();
      if (langChanged) location.reload();
    } else if (m.t === 'templates' || m.t === 'prompts') {
      window.dispatchEvent(new CustomEvent(`csm:${m.t}`, { detail: m[m.t] }));
    } else if (m.t === 'removed') {
      removeLocal(m.id);
      panes = panes.map(x => (x === m.id ? null : x));
      if (active === m.id) active = visibleIds()[0] || sorted()[0]?.id || null;
      render(); select(active);
    }
  };
}

function removeLocal(id) {
  sessions.delete(id);
  const t = terms.get(id);
  if (t) { t.term.dispose(); t.el.remove(); terms.delete(id); }
}

const unread = new Set();
function bump(id) { if (!unread.has(id)) { unread.add(id); render(); } }

// ------------------------------------------------------------------ notifications
function notifyTransition(prev, s) {
  if (!prev || prev.status === s.status) return;
  const focused = document.hasFocus() && visibleIds().includes(s.id);
  const important = s.status === 'attention' || (s.status === 'idle' && prev.status === 'working');
  if (!important || focused) return;
  alertUser(s, s.status === 'attention' ? t('attend une réponse') : t('terminé'), s.locked ? t('Session verrouillée') : (s.message || s.cwd));
}

function alertUser(s, what, body) {
  if (SETTINGS.dnd || s.alerts?.mute) return;
  playSound();
  if (!SETTINGS.notifications) return;
  // macOS : par l'app (repli si elle n'est pas signée par Apple — le centre de notifications la refuse)
  if (window.csmNative?.platform === 'darwin' && window.csmNative.notify) return window.csmNative.notify(`${s.name} — ${what}`, body, s.id);
  if (!('Notification' in window) || Notification.permission !== 'granted') return;
  const n = new Notification(`${s.name} — ${what}`, { body, tag: s.id, icon: 'icon.svg', silent: true });
  n.onclick = () => { window.csmNative ? window.csmNative.focus() : window.focus(); select(s.id); n.close(); };
}

// Son synthétisé (aucun fichier) : « discret » = deux notes douces, « clochette » = tintement.
let audioCtx = null;
function playSound(kind = SETTINGS.sound) {
  if (!kind || kind === 'off') return;
  try {
    audioCtx = audioCtx || new AudioContext();
    const now = audioCtx.currentTime;
    const notes = kind === 'bell' ? [[1318, 0, 0.9], [1975, 0.02, 0.6]] : [[660, 0, 0.18], [880, 0.12, 0.22]];
    for (const [freq, at, dur] of notes) {
      const o = audioCtx.createOscillator(), g = audioCtx.createGain();
      o.type = kind === 'bell' ? 'triangle' : 'sine'; o.frequency.value = freq;
      g.gain.setValueAtTime(0.0001, now + at); g.gain.exponentialRampToValueAtTime(0.12, now + at + 0.01);
      g.gain.exponentialRampToValueAtTime(0.0001, now + at + dur);
      o.connect(g).connect(audioCtx.destination); o.start(now + at); o.stop(now + at + dur + 0.05);
    }
  } catch { }
}

// Rappels : session qui attend depuis longtemps / qui travaille depuis trop longtemps.
const reminded = new Map();
setInterval(() => {
  const now = Date.now();
  for (const s of sessions.values()) {
    const key = `${s.id}:${s.status}:${s.statusSince}`;
    if (reminded.get(s.id) === key) continue;
    const mins = (now - s.statusSince) / 60000;
    if (s.status === 'attention' && SETTINGS.waitingMinutes > 0 && mins >= SETTINGS.waitingMinutes) {
      reminded.set(s.id, key); alertUser(s, t('attend toujours une réponse'), `${Math.round(mins)} min`);
    } else if (s.status === 'working' && SETTINGS.longRunMinutes > 0 && mins >= SETTINGS.longRunMinutes) {
      reminded.set(s.id, key); alertUser(s, t('travaille depuis longtemps'), `${Math.round(mins)} min`);
    }
  }
}, 30000);

// ------------------------------------------------------------------ rendu
// Ordre d'affichage : épinglées d'abord, puis par groupe (ordre d'apparition), puis ordre manuel.
function sorted() {
  const all = [...sessions.values()].sort((a, b) => (a.order || 0) - (b.order || 0));
  const groups = [...new Set(all.map(s => s.group || ''))];
  return all.sort((a, b) => (!!b.pinned - !!a.pinned) || (a.pinned && b.pinned ? 0 : groups.indexOf(a.group || '') - groups.indexOf(b.group || '')) || (a.order || 0) - (b.order || 0));
}
const collapsed = new Set(LS.get('csm.collapsed', []));
let currentAgentFilter = LS.get('sm.filter', 'all');

function setupFilters() {
  const bar = $('#sideFilterBar');
  if (!bar) return;
  bar.querySelectorAll('.flt-btn').forEach(btn => {
    btn.classList.toggle('active', btn.dataset.filter === currentAgentFilter);
    btn.onclick = () => {
      currentAgentFilter = btn.dataset.filter;
      LS.set('sm.filter', currentAgentFilter);
      bar.querySelectorAll('.flt-btn').forEach(b => b.classList.toggle('active', b === btn));
      render();
    };
  });
}

function ago(ts) {
  const s = Math.max(0, (Date.now() - ts) / 1000);
  if (s < 60) return `${Math.floor(s)}s`; if (s < 3600) return `${Math.floor(s / 60)}min`;
  if (s < 86400) return `${Math.floor(s / 3600)}h`; return `${Math.floor(s / 86400)}j`;
}

function render() {
  const ul = $('#list');
  ul.innerHTML = '';
  let lastGroup = null;
  const all = sorted();
  const filtered = currentAgentFilter === 'all'
    ? all
    : all.filter(s => (s.agent || 'kilo') === currentAgentFilter);

  filtered.forEach((s, i) => {
    const g = s.pinned ? '📌' : (s.group || '');
    if (g !== lastGroup && (g || lastGroup !== null)) {
      lastGroup = g;
      if (g || [...sessions.values()].some(x => x.group || x.pinned)) {
        const h = document.createElement('li');
        h.className = 'ghead' + (collapsed.has(g) ? ' closed' : '');
        h.innerHTML = '<span class="gcar">▾</span><span class="gname"></span><span class="gcount"></span>';
        h.querySelector('.gname').textContent = g === '📌' ? t('Épinglées') : g || t('Sans groupe');
        h.querySelector('.gcount').textContent = [...sessions.values()].filter(x => (x.pinned ? '📌' : (x.group || '')) === g).length;
        h.onclick = () => { collapsed.has(g) ? collapsed.delete(g) : collapsed.add(g); LS.set('csm.collapsed', [...collapsed]); render(); };
        ul.appendChild(h);
      }
    }
    lastGroup = g;
    if (collapsed.has(g) && s.id !== active) return;
    const li = document.createElement('li');
    li.className = `${s.id === active ? 'active' : ''} ${visibleIds().includes(s.id) ? 'shown' : ''} ${s.status}`;
    if (s.color) li.style.setProperty('--sc', s.color);
    li.draggable = true;
    li.dataset.id = s.id;
    li.title = `${s.name}\n${s.cwd}${s.worktree ? `\n⎇ ${s.worktree.branch}` : ''}\n${statusLabel(s.status)}${s.message ? ' — ' + t(s.message) : ''}`;
    const curAgent = s.agent || 'kilo';
    const nextAgent = getNextAgent(curAgent);
    const badgeCls = `badge-${curAgent}`;
    const badgeLbl = curAgent === 'kilo' ? '⚡ Kilo' : (curAgent === 'opencode' ? '💻 OpenCode' : '🌐 OpenRouter');
    const badgeHtml = `<span class="agent-badge ${badgeCls}${s.switching ? ' switching' : ''}" title="${t('Basculer vers ')}${AGENT_LABEL[nextAgent]} (${MOD}+Alt+S)">${badgeLbl}</span>`;
    li.innerHTML = `<span class="dot ${s.status}"></span><span class="n"></span>${badgeHtml}<span class="acts"><button class="ren" title="Renommer">✎</button><span class="k">${i < 9 ? i + 1 : ''}${unread.has(s.id) && s.id !== active ? ' •' : ''}</span></span><span class="sub"></span>`;
    li.querySelector('.agent-badge').onclick = e => { e.stopPropagation(); switchAgent(s.id); };
    li.querySelector('.n').textContent = (s.locked ? (window.csmFeatures.isLockedHere?.(s.id) ? '🔒 ' : '🔓 ') : '') + s.name;
    li.querySelector('.dot').textContent = '';
    li.querySelector('.dot').dataset.initial = (s.name || '?').trim().charAt(0).toUpperCase();
    li.querySelector('.sub').textContent = (s.worktree ? `⎇ ${s.worktree.branch} · ` : '') + (s.queue?.length ? `⏳${s.queue.length} · ` : '') + `${statusLabel(s.status)}${s.message && s.status !== 'working' ? ' · ' + t(s.message) : ''} · ${ago(s.statusSince)}`;
    li.onclick = () => select(s.id);
    li.ondblclick = () => renameSession(s.id);
    li.querySelector('.ren').onclick = e => { e.stopPropagation(); renameSession(s.id); };
    li.oncontextmenu = e => { e.preventDefault(); e.stopPropagation(); sessionMenu(s.id, e.clientX, e.clientY); };
    li.ondragstart = e => { e.dataTransfer.setData('text/plain', s.id); e.dataTransfer.setData('text/csm-session', s.id); };
    li.ondragover = e => { e.preventDefault(); li.classList.add('dragover'); };
    li.ondragleave = () => li.classList.remove('dragover');
    li.ondrop = e => {
      e.preventDefault(); li.classList.remove('dragover');
      const from = e.dataTransfer.getData('text/plain'); if (!from || from === s.id) return;
      const ids = sorted().map(x => x.id).filter(x => x !== from);
      ids.splice(ids.indexOf(s.id), 0, from);
      api('POST', '/api/order', { ids });
    };
    ul.appendChild(li);
  });
  const attn = [...sessions.values()].filter(s => s.status === 'attention').length;
  document.title = attn ? `(${attn}) Free Session Manager` : 'Free Session Manager';
  $('#groups').innerHTML = [...new Set([...sessions.values()].map(x => x.group).filter(Boolean))].map(x => `<option value="${x.replace(/"/g, '&quot;')}">`).join('');
  window.csmNative?.setAttention(attn); // pastille Dock / barre des tâches
  document.body.classList.toggle('nosession', sessions.size === 0);
  renderBar();
}
setInterval(render, 15000);

function renderBar() {
  const s = sessions.get(active);
  if (!s) return;
  $('#curDot').className = `dot ${s.status}`;
  const curAgent = s.agent || 'kilo';
  const nextAgent = getNextAgent(curAgent);
  const badgeEl = $('#curAgentBadge');
  if (badgeEl) {
    badgeEl.className = `agent-badge badge-${curAgent}`;
    badgeEl.textContent = curAgent === 'kilo' ? '⚡ Kilo' : (curAgent === 'opencode' ? '💻 OpenCode' : '🌐 OpenRouter');
    badgeEl.title = `${t('Agent actif')} : ${AGENT_LABEL[curAgent]} (cliquer pour basculer vers ${AGENT_LABEL[nextAgent]})`;
    badgeEl.onclick = () => switchAgent(s.id);
  }
  const modelEl = $('#curModelBadge');
  if (modelEl) {
    const modelLabel = formatModelLabel(s.agent, s.model, s.effort);
    modelEl.textContent = modelLabel;
    modelEl.title = `${t('Modèle actif')} : ${modelLabel}\n${t('Cliquer pour changer de modèle')}`;
    modelEl.dataset.agent = s.agent;
  }
  $('#curName').textContent = s.name;
  $('#curCwd').textContent = s.cwd;
  $('#curCwd').title = s.cwd + (s.conversationId || s.claudeSessionId ? `\nsession ${s.conversationId || s.claudeSessionId}` : '');
  $('#curMsg').textContent = `${statusLabel(s.status)}${s.message ? ' — ' + t(s.message) : ''}`;
  $('#curMsg').className = `msg ${s.status}`;
  $('#btnKill').disabled = !s.alive;
  $('#btnRestart').textContent = t('Redémarrer');
  $('#btnRestart').title = s.alive ? t('Redémarrer la session') : t('Redémarrer / reprendre la conversation');
  // Bouton de bascule : compact, annonce la cible et son raccourci.
  const sw = $('#btnSwitch'), swL = $('#btnSwitchLabel');
  if (sw && swL) {
    swL.textContent = nextAgent === 'kilo' ? 'Kilo' : (nextAgent === 'opencode' ? 'OpenCode' : 'OpenRouter');
    sw.title = `${t('Basculer vers')} ${AGENT_LABEL[nextAgent]} (${MOD}+Alt+S)`;
    sw.className = `switch-btn to-${nextAgent}${s.switching ? ' busy' : ''}`;
    sw.disabled = !!s.switching;
  }
  $('#curBranch').hidden = !s.worktree;
  $('#curBranch').textContent = s.worktree ? `⎇ ${s.worktree.branch}` : '';
  $('#curBranch').title = s.worktree ? `${t('Worktree')} : ${s.worktree.path}\n${t('base')} : ${s.worktree.base}` : '';
  $('#curQueue').hidden = !s.queue?.length;
  $('#curQueue').textContent = s.queue?.length ? `⏳ ${s.queue.length}` : '';
  window.dispatchEvent(new CustomEvent('csm:active', { detail: s }));
}

function select(id) {
  if (!id || !sessions.has(id)) { active = null; LS.set('csm.active', null); render(); return; }
  active = id; LS.set('csm.active', id);
  unread.delete(id);
  const n = LAYOUTS[layout] || 1;
  const at = panes.indexOf(id);
  if (at >= 0 && at < n) focusedPane = at;
  else { focusedPane = Math.min(focusedPane, n - 1); panes[focusedPane] = id; }
  renderPanes();
  render();
  requestAnimationFrame(() => terms.get(id)?.term.focus());
  setTimeout(() => terms.get(id)?.term.focus(), 80);
  const s = sessions.get(id);
  if (s && !window.csmFeatures.isLockedHere?.(id) && s.status === 'idle' && s.message === 'terminé') api('POST', `/api/sessions/${id}/seen`).catch(() => { });
}

// ------------------------------------------------------------------ actions
// Boîte « Renommer » commune (barre, liste, menu clic droit, historique, Ctrl+Alt+R).
function askName(title, current, hint, allowSame) {
  const dlg = $('#dlgRename'), input = $('#renInput');
  $('#renTitle').textContent = title;
  $('#renHint').textContent = hint ?? t('Le nom est aussi mémorisé pour cette session.');
  input.value = current || '';
  dlg.returnValue = '';
  dlg.showModal();
  input.select();
  return new Promise(resolve => dlg.addEventListener('close', () => {
    const v = input.value.trim();
    resolve(dlg.returnValue === 'ok' && v && (allowSame || v !== current) ? v : null);
    terms.get(active)?.term.focus();
  }, { once: true }));
}

async function renameSession(id) {
  const s = sessions.get(id); if (!s) return;
  const name = await askName(t('Renommer la session'), s.name);
  if (!name) return;
  try { const v = await api('POST', `/api/sessions/${id}/rename`, { name }); sessions.set(id, v); render(); }
  catch (e) { alert(t('Renommage impossible : ') + e.message); }
}
function startRename() { if (active) renameSession(active); }
$('#curName').ondblclick = startRename;
$('#btnRename').onclick = startRename;
$('#curModelBadge').onclick = e => {
  e.stopPropagation();
  if (active) pickSessionModel(active, $('#curModelBadge'));
};
$('#curModelBadge').onkeydown = e => {
  if (e.key === 'Enter' || e.key === ' ') {
    e.preventDefault();
    if (active) pickSessionModel(active, $('#curModelBadge'));
  }
};

// ------------------------------------------------------------------ menu clic droit
// Menu propre à l'application partout : le menu du navigateur n'apparaît jamais.
// Entrée = [libellé, action, { kbd, danger, disabled }] ; '-' = séparateur.
// popover : passe au-dessus des boîtes de dialogue modales (top layer).
let lastMenuPos = [100, 100];
function showMenu(items, x, y) {
  lastMenuPos = [x, y];
  const menu = $('#ctx');
  // Une boîte modale rend inerte tout ce qui est hors d'elle : le menu doit vivre dedans pour être cliquable.
  const host = document.querySelector('dialog[open]') || document.body;
  if (menu.parentElement !== host) { hideMenu(); host.appendChild(menu); }
  menu.innerHTML = '';
  for (const it of items.filter((it, i, a) => it !== '-' || (i > 0 && a[i - 1] !== '-' && i < a.length - 1))) {
    if (it === '-') { menu.appendChild(document.createElement('hr')); continue; }
    const [label, fn, o = {}] = it;
    const b = document.createElement('button');
    b.innerHTML = '<span></span><kbd></kbd>';
    b.firstChild.textContent = t(label);
    b.lastChild.textContent = o.kbd || '';
    if (o.danger) b.className = 'danger';
    b.disabled = !!o.disabled;
    b.onclick = () => { hideMenu(); fn(); };
    menu.appendChild(b);
  }
  if (!menu.matches(':popover-open')) menu.showPopover();
  const r = menu.getBoundingClientRect();
  menu.style.left = `${Math.max(4, Math.min(x, innerWidth - r.width - 6))}px`;
  menu.style.top = `${Math.max(4, Math.min(y, innerHeight - r.height - 6))}px`;
}
function hideMenu() { const m = $('#ctx'); if (m.matches(':popover-open')) m.hidePopover(); }
$('#ctx').addEventListener('keydown', e => {
  if (e.key !== 'ArrowDown' && e.key !== 'ArrowUp') return;
  const bs = [...$('#ctx').querySelectorAll('button:not(:disabled)')]; if (!bs.length) return;
  const i = bs.indexOf(document.activeElement);
  bs[(i + (e.key === 'ArrowDown' ? 1 : bs.length - 1)) % bs.length].focus();
  e.preventDefault();
});

const clip = {
  copy: t => navigator.clipboard.writeText(t).catch(() => { }),
  read: () => navigator.clipboard.readText().catch(() => ''),
  // Images du presse-papiers (menu « Coller ») ; [] si refusé ou sans image.
  async images() {
    try {
      const out = [];
      for (const item of await navigator.clipboard.read()) {
        const type = item.types.find(t => t.startsWith('image/'));
        if (type) out.push(new File([await item.getType(type)], `image.${type.split('/')[1].replace('jpeg', 'jpg')}`, { type }));
      }
      return out;
    } catch { return []; }
  },
};

const hasFiles = dt => !!dt && [...dt.types].includes('Files');

let pickTarget = null;
function pickFiles(id) { pickTarget = id; $('#fileInput').value = ''; $('#fileInput').click(); }
$('#fileInput').onchange = () => { const f = [...$('#fileInput').files]; if (f.length && pickTarget) attachFiles(pickTarget, f); };
$('#btnAttach').onclick = () => active && pickFiles(active);

async function uploadFile(file) {
  const r = await fetch('/api/upload', {
    method: 'POST', body: file,
    headers: { 'X-CSM-Token': TOKEN, 'X-Filename': encodeURIComponent(file.name || 'image.png'), 'Content-Type': 'application/octet-stream' },
  });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(j.error || r.statusText);
  return j.path;
}

// Colle les chemins comme le ferait un terminal après un glisser-déposer : l'agent détecte les images et les attache.
async function attachFiles(id, files) {
  const t = terms.get(id); if (!t) return;
  toast(`Envoi de ${files.length > 1 ? `${files.length} fichiers` : `« ${files[0].name || 'image'} »`}…`);
  try {
    const paths = [];
    for (const f of files) paths.push(await uploadFile(f));
    const quoted = paths.map(p => (/\s/.test(p) ? `"${p}"` : p));
    t.term.paste(quoted.join(' ') + ' ');
    toast(files.length > 1 ? `${files.length} fichiers ajoutés` : 'Ajouté — il sera envoyé avec ton message');
  } catch (e) { toast(`Échec : ${e.message}`, true); }
  t.term.focus();
}

let toastTimer = null;
function toast(msg, error) {
  const el = $('#toast');
  el.textContent = msg; el.className = `toast show${error ? ' error' : ''}`;
  clearTimeout(toastTimer); toastTimer = setTimeout(() => { el.className = 'toast'; }, error ? 5000 : 2500);
}
window.toast = toast;

// Déposer un fichier ailleurs que sur un terminal ne doit pas faire quitter la page.
window.addEventListener('dragover', e => { if (hasFiles(e.dataTransfer)) e.preventDefault(); });
window.addEventListener('drop', e => {
  if (!hasFiles(e.dataTransfer)) return;
  e.preventDefault();
  if (active && !e.target.closest('.term')) attachFiles(active, [...e.dataTransfer.files]);
});

/**
 * Bascule la session vers l'autre agent en transmettant le contexte.
 * Le serveur reconstruit un briefing depuis le transcript courant, le reprend comme
 * premier prompt de l'agent cible et, si cette session avait déjà utilisé cet agent,
 * reprend aussi sa conversation précédente : les deux historiques s'accumulent.
 */
async function switchAgent(id, model) {
  const s = sessions.get(id); if (!s) return;
  if (s.switching) return;
  const prev = s.agent || 'kilo';
  const to = getNextAgent(prev);
  sessions.set(id, { ...s, agent: to, switching: true });
  render(); if (id === active) renderBar();
  try {
    const body = { to };
    if (model !== undefined && model !== null) body.model = model;
    const r = await api('POST', `/api/sessions/${id}/switch`, body);
    sessions.set(id, { ...sessions.get(id), ...(r && r.session), switching: false });
    render(); if (id === active) renderBar();
    toast(`${AGENT_LABEL[prev]} → ${AGENT_LABEL[to]}`);
  } catch (e) {
    sessions.set(id, { ...sessions.get(id), agent: prev, switching: false });
    render(); if (id === active) renderBar();
    toast(`${t('Bascule impossible')} : ${e.message}`, true);
  }
}

/** Bascule en choisissant explicitement le modèle de l'agent cible (utile si un quota est épuisé). */
function switchWithModel(id, to) {
  const list = AGENT_MODELS[to] || AGENT_MODELS.kilo;
  const items = list.map(m => [m.label || m.value, () => switchAgent(id, m.value)]);
  items.push('-', [t('Basculer sans changer de modèle'), () => switchAgent(id)]);
  showMenu(items, ...lastMenuPos);
}

const tBasculer = (s, to) => t('Basculer vers ') + AGENT_LABEL[to]
  + (s.switches?.length ? ` (${s.switches.length}×)` : '');

function sessionItems(id) {
  const s = sessions.get(id); if (!s) return [];
  const curAgent = s.agent || 'kilo';
  const to = getNextAgent(curAgent);
  return [
    ['Renommer', () => renameSession(id), { kbd: id === active ? `${MOD}+Alt+R` : '' }],
    [t('Changer de modèle…'), () => pickSessionModel(id)],
    [t('Redémarrer'), () => api('POST', `/api/sessions/${id}/restart`)],
    [t('Arrêter'), () => api('POST', `/api/sessions/${id}/kill`), { disabled: !s.alive }],
    [t('Ouvrir dans…'), () => showMenu(openItems(id), ...lastMenuPos)],
    [t('Copier le chemin'), () => clip.copy(s.cwd)],
    '-',
    [tBasculer(s, to), () => switchAgent(id), { kbd: id === active ? `${MOD}+Alt+S` : '' }],
    ...moreItems(id).slice(0, -1),
    '-',
    [t('Fermer'), () => closeSession(id), { danger: true, kbd: id === active ? `${MOD}+Alt+W` : '' }],
  ];
}
/** Montre le briefing qui serait transmis si l'on basculait maintenant. */
async function previewHandoff(id) {
  const s = sessions.get(id); if (!s) return;
  toast(t('Analyse du transcript…'));
  let r;
  try { r = await api('GET', `/api/sessions/${id}/handoff`); }
  catch (e) { return toast(e.message, true); }
  const curAgent = s.agent || 'kilo';
  const to = getNextAgent(curAgent);
  const name = `transfert-${s.agent}-vers-${to}`;
  const md = r.markdown + `\n\n---\n_${r.stats.turns} tours · ${r.stats.users} messages utilisateur · `
    + `${r.stats.agents} réponses · ${r.stats.written} fichiers modifiés · ${r.stats.chars} caractères_\n`;
  showMenu([
    [`${t('Copier le briefing')} (${Math.round(r.stats.chars / 100) / 10}k car.)`, () => clip.copy(md).then(() => toast(t('Copié')))],
    [t('Enregistrer en Markdown (.md)'), () => window.csmFeatures.download(`${name}.md`, md, 'text/markdown')],
    '-',
    [t('Basculer maintenant'), () => switchAgent(id)],
  ], ...lastMenuPos);
}

// Menu clic droit sur une session de la liste.
function sessionMenu(id, x, y) { showMenu(sessionItems(id), x, y); }
function terminalItems(id) {
  const t = terms.get(id); if (!t) return [];
  const { term } = t;
  return [
    ['Copier', () => { clip.copy(term.getSelection()); term.clearSelection(); term.focus(); }, { disabled: !term.hasSelection(), kbd: IS_MAC ? '⌘C' : 'Ctrl+C' }],
    ['Coller', async () => {
      const imgs = await clip.images();
      if (imgs.length) return attachFiles(id, imgs);
      const txt = await clip.read(); if (txt) term.paste(txt); term.focus();
    }, { kbd: IS_MAC ? '⌘V' : 'Ctrl+V' }],
    ['Joindre un fichier…', () => pickFiles(id)],
    ['Tout sélectionner', () => term.selectAll()],
    ['Effacer l’écran', () => { term.clear(); term.focus(); }],
    '-',
    ['Zoom avant', () => zoom('+'), { kbd: `${MOD}+=` }],
    ['Zoom arrière', () => zoom('-'), { kbd: `${MOD}+-` }],
    ['Taille normale', () => zoom('0'), { kbd: `${MOD}+0` }],
    '-',
    ...sessionItems(id),
  ];
}

function fieldItems(el) {
  const ro = el.readOnly || el.disabled;
  const a = el.selectionStart ?? el.value.length, b = el.selectionEnd ?? el.value.length;
  const put = txt => { el.focus(); el.setRangeText(txt, a, b, 'end'); el.dispatchEvent(new Event('input', { bubbles: true })); };
  return [
    ['Couper', () => { clip.copy(el.value.slice(a, b)); put(''); }, { disabled: ro || b <= a, kbd: `${MOD}+X` }],
    ['Copier', () => { clip.copy(el.value.slice(a, b)); el.focus(); }, { disabled: b <= a, kbd: `${MOD}+C` }],
    ['Coller', async () => put(await clip.read()), { disabled: ro, kbd: `${MOD}+V` }],
    '-',
    ['Tout sélectionner', () => { el.focus(); el.select(); }, { kbd: `${MOD}+A` }],
  ];
}

function appItems() {
  return [
    ['Nouvelle session', openNew, { kbd: `${MOD}+Alt+N` }],
    ['Historique', openHistory, { kbd: `${MOD}+Alt+H` }],
    '-',
    ['Recharger la fenêtre', () => location.reload(), { kbd: 'F5' }],
  ];
}

document.addEventListener('contextmenu', e => {
  e.preventDefault();
  if (e.target.closest('#ctx')) return;
  const x = e.clientX, y = e.clientY, tg = e.target;
  const field = tg.closest('input, textarea');
  if (field && !['checkbox', 'radio', 'button', 'submit'].includes(field.type)) return showMenu(fieldItems(field), x, y);
  const termEl = tg.closest('.term');
  if (termEl) { const id = [...terms].find(([, t]) => t.el === termEl)?.[0]; if (id) return showMenu(terminalItems(id), x, y); }
  const sel = String(getSelection() || '');
  const pageCopy = sel ? [['Copier', () => clip.copy(sel), { kbd: `${MOD}+C` }], '-'] : [];
  if (tg.closest('dialog')) { if (sel) showMenu(pageCopy, x, y); else hideMenu(); return; }
  if (tg.closest('#bar') && active) return showMenu([...pageCopy, ...sessionItems(active)], x, y);
  showMenu([...pageCopy, ...appItems()], x, y);
});

// Entrée dans un champ = bouton principal (sinon le navigateur valide le 1er bouton du formulaire : « Annuler »).
document.addEventListener('keydown', e => {
  if (e.key !== 'Enter' || e.shiftKey || e.isComposing || e.target.tagName !== 'INPUT') return;
  const form = e.target.closest('dialog form');
  const ok = form && form.querySelector('button.primary[value]');
  if (!ok) return;
  e.preventDefault();
  form.requestSubmit(ok); // respecte la validation (ex. dossier obligatoire)
}, true);
document.addEventListener('mousedown', e => { if (!$('#ctx').contains(e.target)) hideMenu(); }, true);
// Échap ferme le menu sans fermer la boîte de dialogue en dessous.
document.addEventListener('keydown', e => { if (e.key === 'Escape' && $('#ctx').matches(':popover-open')) { hideMenu(); e.stopPropagation(); e.preventDefault(); } }, true);
window.addEventListener('blur', hideMenu);
window.addEventListener('resize', hideMenu);
for (const d of document.querySelectorAll('dialog')) d.addEventListener('close', hideMenu);

/** Échappement HTML : delegate à panel.js quand il est chargé. */
const escHtml = s => (window.csmFeatures && window.csmFeatures.esc ? window.csmFeatures.esc(s)
  : String(s ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]));

async function openQuotaDialog(force = false) {
  const dlg = $('#dlgQuota');
  const box = $('#quotaContent');
  dlg.showModal();
  const cur = sessions.get(active);
  const main = cur && (cur.agent === 'opencode' || cur.agent === 'openrouter') ? cur.agent : 'kilo';
  if (box.dataset.mainAgent !== main) {
    delete box.dataset.loaded;
  }
  if (!force && box.dataset.loaded) return;
  box.dataset.mainAgent = main;
  const title = $('#quotaTitle');
  if (title) {
    const titles = {
      kilo: '⚡ Statut & Quotas Kilo Free',
      opencode: '💻 Statut & Quotas OpenCode',
      openrouter: '🌐 Statut & Quotas OpenRouter Free'
    };
    title.textContent = titles[main] || '⚡ Free Session Manager';
  }
  box.innerHTML = `<p class="hint">${t('Chargement des quotas…')}</p>`;
  const draw = (agent, res) => {
    const cards = window.csmFeatures?.renderQuotaCards
      ? window.csmFeatures.renderQuotaCards(res.quotas, res.updatedAt)
      : `<pre>${JSON.stringify(res.quotas, null, 2)}</pre>`;
    if (!res.quotas || !res.quotas.length) {
      return `<p class="hint">${t('Aucun quota disponible.')}${res.error ? '<br><span class="err">' + escHtml(res.error) + '</span>' : ''}</p>`;
    }
    const agentLabels = {
      kilo: '⚡ Kilo Free',
      opencode: '💻 OpenCode',
      openrouter: '🌐 OpenRouter Free'
    };
    const head = `<h3 class="quota-agent-head is-${agent}">${agentLabels[agent] || agent}</h3>`;
    return head + cards;
  };
  try {
    const q = force ? '?force=true' : '';
    const res = await api('GET', `/api/agents/${main}/quota${q}`).catch(e => ({ quotas: [], error: e.message }));
    box.innerHTML = draw(main, res);
    box.dataset.loaded = '1';
  } catch (e) {
    box.innerHTML = `<p class="err">${t('Échec de la récupération des quotas :')} ${escHtml(e.message)}</p>`;
  }
}
$('#btnQuota').onclick = () => openQuotaDialog();
$('#quotaClose').onclick = () => $('#dlgQuota').close();
$('#btnRefreshQuota').onclick = () => openQuotaDialog(true);

$('#btnRestart').onclick = () => active && api('POST', `/api/sessions/${active}/restart`);
$('#btnSwitch').onclick = () => active && switchAgent(active);
function openItems(id) {
  return [
    [t('Dans l’éditeur'), () => openIn(id, 'editor'), { kbd: `${MOD}+Alt+E` }],
    [IS_MAC ? t('Dans le Finder') : t('Dans l’Explorateur'), () => openIn(id, 'folder')],
    [t('Dans un terminal'), () => openIn(id, 'terminal')],
  ];
}
async function openIn(id, target) { try { await api('POST', `/api/sessions/${id}/open`, { target }); } catch (e) { toast(e.message, true); } }
const at = el => { const r = el.getBoundingClientRect(); return [r.left, r.bottom + 4]; };
$('#btnOpen').onclick = e => active && showMenu(openItems(active), ...at(e.currentTarget));
$('#btnMore').onclick = e => active && showMenu(moreItems(active), ...at(e.currentTarget));
$('#emptyNew').onclick = () => openNew();
$('#btnCompact').onclick = () => saveSettings({ compactSidebar: !SETTINGS.compactSidebar });
document.querySelectorAll('[data-layout]').forEach(b => { b.onclick = () => setLayout(b.dataset.layout); });
function moreItems(id) {
  const s = sessions.get(id); if (!s) return [];
  const to = getNextAgent(s.agent || 'kilo');
  return [
    [t('Redémarrer la session'), () => api('POST', `/api/sessions/${id}/restart`)],
    [tBasculer(s, to), () => switchAgent(id), { kbd: `${MOD}+Alt+S` }],
    [t('Basculer en choisissant le modèle…'), () => switchWithModel(id, to)],
    [t('Aperçu du transfert de contexte…'), () => previewHandoff(id), { disabled: !(s.conversationId || s.claudeSessionId) }],
    '-',
    [t('File d’attente…'), () => window.csmFeatures.openQueue(id), { kbd: `${MOD}+Alt+Q` }],
    [t('Insérer un prompt…'), () => window.csmFeatures.openPrompts(id)],
    [t('Envoyer à plusieurs sessions…'), () => window.csmFeatures.openBroadcast(), { kbd: `${MOD}+Alt+B` }],
    '-',
    [t('Modifications'), () => window.csmFeatures.showPanel('changes'), { kbd: `${MOD}+Alt+G` }],
    [t('Chronologie'), () => window.csmFeatures.showPanel('timeline')],
    [t('Consommation'), () => window.csmFeatures.showPanel('usage')],
    [t('Exporter la conversation…'), () => window.csmFeatures.exportConversation(s), { disabled: !(s.conversationId || s.claudeSessionId) }],
    [t('Enregistrer comme modèle…'), () => saveSessionAsTemplate(id)],
    '-',
    [t('Groupe…'), () => window.csmFeatures.setGroup(id)],
    [s.pinned ? t('Désépingler') : t('Épingler en haut'), () => api('POST', `/api/sessions/${id}/meta`, { pinned: !s.pinned })],
    ...(window.csmFeatures.lockItems?.(id) || []),
    [s.alerts?.mute ? t('Réactiver les alertes') : t('Couper les alertes de cette session'), () => api('POST', `/api/sessions/${id}/meta`, { alerts: { mute: !s.alerts?.mute } })],
    '-',
    [t('Arrêter'), () => api('POST', `/api/sessions/${id}/kill`), { disabled: !s.alive }],
  ];
}
$('#btnKill').onclick = () => active && api('POST', `/api/sessions/${active}/kill`);
$('#btnClose').onclick = () => closeSession(active);
async function closeSession(id) {
  const s = sessions.get(id); if (!s) return;
  if (s.worktree) {
    $('#cwTitle').textContent = `${t('Fermer')} « ${s.name} »`;
    $('#cwInfo').textContent = `${t('Cette session travaille dans le worktree')} ${s.worktree.path} (${t('branche')} ${s.worktree.branch}, ${t('base')} ${s.worktree.base}).`;
    const dlg = $('#dlgCloseWt'); dlg.returnValue = ''; dlg.showModal();
    const choice = await new Promise(r => dlg.addEventListener('close', () => r(dlg.returnValue), { once: true }));
    try {
      if (choice === 'keep') await api('DELETE', `/api/sessions/${id}`);
      else if (choice === 'merge') {
        await api('POST', `/api/sessions/${id}/worktree/merge`);
        await api('POST', `/api/sessions/${id}/worktree/remove`, { deleteBranch: true });
        toast(`${t('Fusionné dans')} ${s.worktree.base}`);
      } else if (choice === 'remove') {
        if (!confirm(`${t('Supprimer définitivement le worktree et la branche')} ${s.worktree.branch} ?`)) return;
        await api('POST', `/api/sessions/${id}/worktree/remove`, { deleteBranch: true, force: true });
      }
    } catch (e) { alert(e.message); }
    return;
  }
  if (s.alive && !confirm(`${t('Fermer')} « ${s.name} » ? ${t("Le processus sera arrêté (la conversation reste reprenable depuis l'historique).")}`)) return;
  api('DELETE', `/api/sessions/${id}`);
}

async function loadHistory() {
  try { historyCache = await api('GET', '/api/history'); } catch { historyCache = []; }
  const dirs = [...new Set([...sessions.values()].map(s => s.cwd).concat(historyCache.map(h => h.cwd)).filter(Boolean))];
  $('#dirs').innerHTML = '';
  for (const d of dirs.slice(0, 60)) { const o = document.createElement('option'); o.value = d; $('#dirs').appendChild(o); }
}

let templates = [];
async function saveSessionAsTemplate(id) {
  const s = sessions.get(id); if (!s) return;
  const parts = (s.args || '').match(/"[^"]*"|\S+/g) || [];
  let model = '', mode = ''; const extra = [];
  for (let i = 0; i < parts.length; i++) {
    if (parts[i] === '--model') model = parts[++i] || '';
    else if (parts[i] === '--permission-mode') mode = parts[++i] || '';
    else extra.push(parts[i]);
  }
  const name = await askName(t('Nom du modèle'), s.name, t('Reprend le dossier, le groupe, le modèle et le mode de cette session. Retrouvable dans « Nouvelle session » et la palette (Ctrl+K).'), true);
  if (!name) return;
  const list = await loadTemplates();
  list.push({ name, cwd: s.worktree ? s.worktree.repo : s.cwd, model, mode, extra: extra.join(' '), worktree: !!s.worktree, prompt: '', group: s.group || '' });
  try { await api('PUT', '/api/templates', list); toast(`${t('Modèle enregistré')} : ${name}`); } catch (e) { toast(e.message, true); }
}

// Fonction (et non constante) : les libellés sont traduits à l'affichage, après le chargement de la langue.
function agentModes(agent) {
  if (agent === 'opencode') {
    return [
      { value: '', label: t('Par défaut') },
      { value: 'auto', label: t('Mode automatique (--auto)') },
    ];
  }
  return [
    { value: '', label: t('Par défaut') },
    { value: 'dangerously-skip-permissions', label: t('Approbation auto (skip permissions)') },
  ];
}

function formatModelLabel(agent, model, effort) {
  const ag = agent || 'kilo';
  const m = String(model || '').trim();

  if (!m) {
    if (ag === 'opencode') return '💻 Nemotron 3 Ultra Free';
    if (ag === 'openrouter') return '🌐 OpenRouter Free (Auto)';
    return '⚡ Nemotron 3 Super 120B (Free)';
  }

  const list = AGENT_MODELS[ag] || AGENT_MODELS.kilo;
  const found = list.find(x => x.value === m);
  if (found && found.label && found.value) {
    return found.label;
  }

  return m;
}

function pickSessionModel(id, triggerEl) {
  const s = sessions.get(id);
  if (!s) return;
  const ag = s.agent || 'kilo';
  const list = AGENT_MODELS[ag] || AGENT_MODELS.kilo;
  const curModel = s.model || '';

  const items = list.map(m => {
    const isCur = m.value === curModel || (!m.value && !curModel);
    const label = m.label || m.value || (AGENT_LABEL[ag] ? `Défaut ${AGENT_LABEL[ag]}` : 'Défaut');
    return [
      (isCur ? '✓ ' : '   ') + label,
      () => setSessionModel(id, m.value)
    ];
  });

  if (triggerEl) {
    const r = triggerEl.getBoundingClientRect();
    showMenu(items, r.left, r.bottom + 4);
  } else {
    showMenu(items, ...lastMenuPos);
  }
}

async function setSessionModel(id, newModel) {
  const s = sessions.get(id);
  if (!s) return;
  const label = formatModelLabel(s.agent, newModel, s.effort);
  try {
    await api('POST', `/api/sessions/${id}/model`, { model: newModel });
    s.model = newModel;
    render();
    if (id === active) renderBar();
    toast(`${t('Modèle actif')} : ${label}`);
    if (s.alive) {
      if (confirm(`${t('Redémarrer la session')} pour appliquer immédiatement « ${label} » ?`)) {
        await api('POST', `/api/sessions/${id}/restart`);
      }
    }
  } catch (e) {
    toast(e.message, true);
  }
}

function syncAgentForm(agent) {
  const f = $('#formNew');
  if (!f) return;
  agent = agent || 'kilo';
  
  f.querySelectorAll('.agent-choice-btn').forEach(btn => {
    const isThis = btn.dataset.agent === agent;
    btn.classList.toggle('active', isThis);
    const radio = btn.querySelector('input[type="radio"]');
    if (radio) radio.checked = isThis;
  });

  const modelList = AGENT_MODELS[agent] || AGENT_MODELS.kilo;
  const sel = $('#selModel');
  sel.dataset.agent = agent;
  sel.innerHTML = modelList.map(m => `<option value="${m.value}">${m.label}</option>`).join('');
  if (agent === 'kilo') {
    sel.value = 'kilo/nvidia/nemotron-3-super-120b-a12b:free';
  } else if (agent === 'opencode') {
    sel.value = 'opencode/nemotron-3-ultra-free';
  } else if (agent === 'openrouter') {
    sel.value = 'openrouter/openrouter/free';
  }

  const modeList = agentModes(agent);
  $('#selMode').innerHTML = modeList.map(m => `<option value="${m.value}">${m.label}</option>`).join('');
  $('#selMode').value = SETTINGS.defaultMode || '';

  syncEffortForAgent(agent, $('#selModel').value);

  const lblExtra = $('#lblExtraText');
  if (lblExtra) {
    const name = agent === 'kilo' ? 'Kilo' : (agent === 'opencode' ? 'OpenCode' : 'OpenRouter');
    lblExtra.textContent = t(`Arguments supplémentaires pour ${name}`);
  }
}

function syncEffortForAgent(agent, modelVal) {
  const effortSelect = $('#selEffort');
  const effortRow = $('#lblEffort');
  if (!effortSelect) return;
  effortSelect.innerHTML = `<option value="">${t('Non applicable (Modèle Gratuit)')}</option>`;
  effortSelect.disabled = true;
  if (effortRow) effortRow.hidden = true;
}

function syncEffortOptions(modelVal, effortSelect, effortRow) {
  const currentAgent = $('#formNew')?.querySelector('input[name="agent"]:checked')?.value || 'kilo';
  syncEffortForAgent(currentAgent, modelVal);
}
window.syncEffortOptions = syncEffortOptions;

async function loadTemplates() { try { templates = await api('GET', '/api/templates'); } catch { templates = []; } return templates; }
window.addEventListener('csm:templates', e => { templates = e.detail; });

function openNew(tpl) {
  if (tpl && !tpl.id) tpl = null;
  const f = $('#formNew');
  f.reset();
  const cur = sessions.get(active);
  const agent = tpl?.agent || cur?.agent || SETTINGS.defaultAgent || 'kilo';
  syncAgentForm(agent);

  if (tpl?.model) f.model.value = tpl.model;
  if (tpl?.mode) f.mode.value = tpl.mode;
  if (tpl?.effort && f.effort && !f.effort.disabled) f.effort.value = tpl.effort;

  f.cwd.value = LS.get('csm.lastCwd', '') || (cur?.worktree ? cur.worktree.repo : cur?.cwd) || '';
  f.group.value = cur?.group || '';
  f.worktree.checked = !!SETTINGS.worktreeDefault;
  loadHistory();
  loadTemplates().then(list => {
    $('#tplRow').hidden = false;
    f.template.innerHTML = `<option value="">${list.length ? t('— aucun —') : t('— aucun modèle : « Enregistrer comme modèle » en bas —')}</option>` + list.map(x => `<option value="${x.id}"></option>`).join('');
    list.forEach((x, i) => { f.template.options[i + 1].textContent = x.name; });
    if (tpl) { f.template.value = tpl.id; applyTemplate(tpl); }
  });
  $('#dlgNew').showModal();
  checkRepo();
  f.cwd.select();
}

function applyTemplate(x) {
  const f = $('#formNew');
  if (!x) return;
  if (x.agent) syncAgentForm(x.agent);
  if (x.cwd) f.cwd.value = x.cwd;
  f.name.value = x.name || '';
  if (x.model) f.model.value = x.model;
  const currentAgent = f.querySelector('input[name="agent"]:checked')?.value || 'kilo';
  syncEffortForAgent(currentAgent, f.model.value);
  if (x.mode) f.mode.value = x.mode;
  if (x.effort && f.effort && !f.effort.disabled) f.effort.value = x.effort;
  f.extra.value = x.extra || ''; f.prompt.value = x.prompt || ''; f.group.value = x.group || '';
  f.worktree.checked = !!x.worktree;
  if (x.prompt) f.querySelector('details').open = true;
  checkRepo();
}

$('#formNew').querySelectorAll('.agent-choice-btn').forEach(btn => {
  btn.onclick = () => syncAgentForm(btn.dataset.agent);
});
$('#selModel').onchange = e => {
  const currentAgent = $('#formNew').querySelector('input[name="agent"]:checked')?.value || 'kilo';
  syncEffortForAgent(currentAgent, e.target.value);
};
if ($('#formNew')?.template) $('#formNew').template.onchange = e => applyTemplate(templates.find(x => x.id === e.target.value));

// Worktree : proposé seulement dans un dépôt git ; nom de branche suggéré depuis le nom de la session.
let repoTimer = null;
function checkRepo() {
  clearTimeout(repoTimer);
  repoTimer = setTimeout(async () => {
    const f = $('#formNew');
    if (!f) return;
    const cwd = f.cwd?.value?.trim() || ''; if (!cwd) { if ($('#wtBox')) $('#wtBox').hidden = true; return; }
    try {
      const r = await api('GET', `/api/git/suggest-branch?cwd=${encodeURIComponent(cwd)}&name=${encodeURIComponent(f.name?.value || cwd.split(/[\\/]/).filter(Boolean).pop() || 'session')}`);
      if ($('#wtBox')) $('#wtBox').hidden = !r.repo;
      if (!r.repo) { if (f.worktree) f.worktree.checked = false; return; }
      if (f.branch && !f.branch.dataset.touched) f.branch.value = r.branch;
      if ($('#wtHint')) $('#wtHint').textContent = f.worktree?.checked ? `${t('Dossier')} : ${r.root}.worktrees/… · ${t('base')} : ${r.base}` : '';
    } catch { if ($('#wtBox')) $('#wtBox').hidden = true; }
    if ($('#wtBranchRow')) $('#wtBranchRow').hidden = !f.worktree?.checked;
  }, 250);
}
for (const n of ['cwd', 'name']) $('#formNew')?.[n]?.addEventListener?.('input', checkRepo);
$('#formNew')?.worktree?.addEventListener?.('change', checkRepo);
$('#formNew')?.branch?.addEventListener?.('input', e => { e.target.dataset.touched = '1'; });
$('#btnSaveTpl').onclick = async () => {
  const f = $('#formNew');
  const agent = f.querySelector('input[name="agent"]:checked')?.value || 'kilo';
  const name = await askName(t('Nom du modèle'), f.name.value || f.cwd.value.split(/[\\/]/).filter(Boolean).pop() || t('Modèle'), t('Retrouvable dans « Modèle de session » et la palette (Ctrl+K).'), true);
  if (!name) return $('#dlgNew').showModal();
  const list = await loadTemplates();
  list.push({ agent, name, cwd: f.cwd.value.trim(), model: f.model.value, mode: f.mode.value, effort: f.effort?.value || '', extra: f.extra.value.trim(), worktree: f.worktree.checked, prompt: f.prompt.value, group: f.group.value.trim() });
  try { await api('PUT', '/api/templates', list); toast(`${t('Modèle enregistré')} : ${name}`); } catch (e) { toast(e.message, true); }
  if (!$('#dlgNew').open) $('#dlgNew').showModal();
};
$('#btnNew').onclick = () => openNew();
$('#btnBrowse').onclick = async () => {
  const f = $('#formNew'), btn = $('#btnBrowse');
  btn.disabled = true; btn.textContent = t('Ouverture…');
  try {
    const initial = f.cwd.value.trim();
    const path = window.smNative?.pickFolder ? await window.smNative.pickFolder(initial) : (window.asmNative?.pickFolder ? await window.asmNative.pickFolder(initial) : (window.csmNative ? await window.csmNative.pickFolder(initial) : (await api('POST', '/api/pick-folder', { initial })).path));
    if (path) {
      f.cwd.value = path;
      if (!f.name.value.trim()) f.name.placeholder = path.split(/[\\/]/).filter(Boolean).pop() || '(nom du dossier)';
    }
  } catch (e) { alert(t('Sélecteur indisponible : ') + e.message); }
  finally { btn.disabled = false; btn.textContent = t('Parcourir…'); f.cwd.focus(); }
};
$('#dlgNew').addEventListener('close', async () => {
  if ($('#dlgNew').returnValue !== 'ok') return;
  const f = $('#formNew');
  const agent = f.querySelector('input[name="agent"]:checked')?.value || 'kilo';
  const m = f.model.value.trim();
  const eff = f.effort && !f.effort.disabled ? f.effort.value.trim() : '';
  const args = [
    m && `--model ${m}`,
    eff && `--effort ${eff}`,
    f.mode.value && (f.mode.value === 'dangerously-skip-permissions' ? '--dangerously-skip-permissions' : (f.mode.value === 'auto' ? '--auto' : `--mode ${f.mode.value}`)),
    f.extra.value.trim()
  ].filter(Boolean).join(' ');
  const cwd = f.cwd.value.trim().replace(/^"|"$/g, '');
  LS.set('csm.lastCwd', cwd);
  const body = {
    agent, cwd, name: f.name.value.trim() || undefined,
    model: m, effort: eff, mode: f.mode.value,
    args, group: f.group.value.trim() || undefined,
    initialPrompt: f.prompt.value.trim() || undefined
  };
  try {
    const s = f.worktree.checked && !$('#wtBox').hidden
      ? await api('POST', '/api/worktree/session', { ...body, branch: f.branch.value.trim() })
      : await api('POST', '/api/sessions', body);
    sessions.set(s.id, s); ensureTerm(s.id); select(s.id);
  } catch (e) { alert(`${t('Création impossible')} : ${e.message}`); return; }
  delete f.branch.dataset.touched;
  askNotify();
});

// ------------------------------------------------------------------ historique
let histSel = 0;
let histFilter = 'all';

function setupHistFilters() {
  const bar = $('#histFilterBar');
  if (!bar) return;
  bar.querySelectorAll('.flt-btn').forEach(btn => {
    btn.classList.toggle('active', btn.dataset.filter === histFilter);
    btn.onclick = () => {
      histFilter = btn.dataset.filter;
      bar.querySelectorAll('.flt-btn').forEach(b => b.classList.toggle('active', b === btn));
      renderHistory();
    };
  });
}

function renderHistory() {
  const q = $('#histSearch').value.toLowerCase().trim();
  const filtered = historyCache.filter(h => {
    if (histFilter !== 'all' && (h.agent || 'kilo') !== histFilter) return false;
    if (q && !`${h.title} ${h.cwd} ${h.lastPrompt} ${h.branch || ''}`.toLowerCase().includes(q)) return false;
    return true;
  });
  const items = filtered.slice(0, 200);
  histSel = Math.min(histSel, Math.max(0, items.length - 1));
  const ul = $('#histList'); ul.innerHTML = '';
  items.forEach((h, i) => {
    const li = document.createElement('li');
    if (i === histSel) li.classList.add('sel');
    const isOpencode = h.agent === 'opencode';
    const isOpenrouter = h.agent === 'openrouter';
    const badgeClass = isOpencode ? 'badge-opencode' : (isOpenrouter ? 'badge-openrouter' : 'badge-kilo');
    const badgeText = isOpencode ? '💻 OpenCode' : (isOpenrouter ? '🌐 OpenRouter' : '⚡ Kilo');
    const badgeHtml = `<span class="agent-badge ${badgeClass}">${badgeText}</span>`;
    li.innerHTML = `<span class="t"></span>${badgeHtml}<span class="d"></span><span class="c"></span><span class="d"></span><span class="p"></span>`;
    // « el » et non « t » : le nom t masquerait la fonction de traduction dans cette portée.
    const [el, , d1, c, d2, p] = li.children;
    el.textContent = h.title;
    if (h.managed) el.insertAdjacentHTML('beforeend', `<span class="tag">${t('ouverte')}</span>`);
    const ren = document.createElement('button');
    ren.className = 'ren'; ren.textContent = '✎'; ren.title = t('Renommer');
    ren.onclick = e => { e.stopPropagation(); renameHistory(h); };
    el.prepend(ren);
    d1.textContent = new Date(h.mtime).toLocaleString(window.csmFeatures.locale?.() || 'fr-FR', { dateStyle: 'short', timeStyle: 'short' });
    c.textContent = h.cwd || '';
    d2.textContent = h.branch || '';
    p.textContent = h.lastPrompt;
    li.onclick = () => resumeHistory(h);
    li.oncontextmenu = e => {
      e.preventDefault(); e.stopPropagation();
      histSel = i; [...ul.children].forEach((x, j) => x.classList.toggle('sel', j === i));
      showMenu([
        [h.managed ? 'Afficher' : 'Reprendre', () => resumeHistory(h), { kbd: 'Entrée' }],
        ['Renommer', () => renameHistory(h)],
        '-',
        ['Copier le chemin', () => clip.copy(h.cwd || ''), { disabled: !h.cwd }],
        ['Copier l’identifiant de session', () => clip.copy(h.id)],
      ], e.clientX, e.clientY);
    };
    ul.appendChild(li);
  });
  ul.children[histSel]?.scrollIntoView({ block: 'nearest' });
  return items;
}
async function renameHistory(h) {
  const name = await askName(t('Renommer la conversation'), h.title);
  $('#histSearch').focus();
  if (!name) return;
  try { await api('POST', `/api/history/${h.id}/rename`, { name }); h.title = name; renderHistory(); }
  catch (err) { alert(t('Renommage impossible : ') + err.message); }
}
async function openHistory() {
  $('#histSearch').value = ''; histSel = 0;
  $('#histList').innerHTML = '<li><span class="t">Chargement…</span></li>';
  setupHistFilters();
  $('#dlgHistory').showModal();
  $('#histSearch').focus();
  await loadHistory();
  renderHistory();
}
async function resumeHistory(h) {
  $('#dlgHistory').close();
  const existing = [...sessions.values()].find(s => (s.conversationId || s.claudeSessionId) === h.id);
  if (existing) { select(existing.id); if (!existing.alive) api('POST', `/api/sessions/${existing.id}/restart`); return; }
  const s = await api('POST', '/api/sessions', {
    cwd: h.cwd, name: h.title.slice(0, 40), resume: h.id,
    agent: h.agent || 'kilo'
  });
  sessions.set(s.id, s); ensureTerm(s.id); select(s.id);
}
$('#btnHistory').onclick = openHistory;
$('#histClose').onclick = () => $('#dlgHistory').close();
$('#histSearch').oninput = () => { histSel = 0; renderHistory(); };
$('#histSearch').onkeydown = e => {
  if (e.key === 'ArrowDown') { histSel++; renderHistory(); e.preventDefault(); }
  else if (e.key === 'ArrowUp') { histSel = Math.max(0, histSel - 1); renderHistory(); e.preventDefault(); }
  else if (e.key === 'Enter') { const it = renderHistory()[histSel]; if (it) resumeHistory(it); }
};
$('#dlgHistory').addEventListener('close', () => terms.get(active)?.term.focus());

// ------------------------------------------------------------------ raccourcis
function globalShortcut(e) {
  if (document.querySelector('dialog[open]')) return false; // pas de raccourci pendant une saisie
  const k = e.key.toLowerCase();
  const list = sorted();
  const idx = list.findIndex(s => s.id === active);
  if (k === 'n') { openNew(); return true; }
  if (k === 'h') { openHistory(); return true; }
  if (k === 'r') { startRename(); return true; }
  if (k === 's' && active) { switchAgent(active); return true; }
  if (k === 'w') { $('#btnClose').click(); return true; }
  // Chiffres par touche physique (AZERTY : 1 = « & »). Un caractère AltGr (@ # { [ | \ ^ ] }) n'est pas un raccourci.
  const digit = /^Digit[1-9]$/.test(e.code) && (/^[0-9&é"'(\-è_çà]$/.test(e.key)) ? +e.code.slice(5) : 0;
  if (digit) { if (list[digit - 1]) select(list[digit - 1].id); return true; }
  if (e.key === 'ArrowDown' && list.length) { select(list[(idx + 1) % list.length].id); return true; }
  if (e.key === 'ArrowUp' && list.length) { select(list[(idx - 1 + list.length) % list.length].id); return true; }
  if (k === 'a') { const a = list.find(s => s.status === 'attention' && s.id !== active); if (a) select(a.id); return true; }
  if (k === 'g') { window.csmFeatures.togglePanel('changes'); return true; }
  if (k === 'e' && active) { openIn(active, 'editor'); return true; }
  if (k === 'q' && active) { window.csmFeatures.openQueue(active); return true; }
  if (k === 'b') { window.csmFeatures.openBroadcast(); return true; }
  if (k === 'f') { document.body.classList.toggle('focusmode'); requestAnimationFrame(() => fitAll(true)); return true; }
  if (e.key === 'ArrowRight' || e.key === 'ArrowLeft') {
    const vis = panes.slice(0, LAYOUTS[layout] || 1);
    if (vis.length > 1) { let i = focusedPane; do { i = (i + (e.key === 'ArrowRight' ? 1 : vis.length - 1)) % vis.length; } while (!vis[i] && i !== focusedPane); if (vis[i]) select(vis[i]); }
    return true;
  }
  return false;
}
document.addEventListener('keydown', e => { if (isModAlt(e) && globalShortcut(e)) e.preventDefault(); });
// Ctrl+K / Cmd+K : palette ; Ctrl+, : réglages ; Ctrl+Maj+F : recherche dans les sessions.
document.addEventListener('keydown', e => {
  const mod = IS_MAC ? e.metaKey : e.ctrlKey;
  if (!mod || e.altKey) return;
  const k = e.key.toLowerCase();
  if (k === 'k' && !e.shiftKey) { e.preventDefault(); e.stopPropagation(); window.csmFeatures.openPalette(); }
  else if (e.key === ',') { e.preventDefault(); window.csmFeatures.openSettings(); }
  else if (k === 'f' && e.shiftKey) { e.preventDefault(); window.csmFeatures.openSearch(); }
}, true);

function askNotify() {
  if ('Notification' in window && Notification.permission === 'default') Notification.requestPermission();
}
document.addEventListener('click', askNotify, { once: true });

// Actions venant du menu de l'application (barre des tâches / de menus).
window.csmNative?.onAction(a => {
  if (a === 'new') openNew(); else if (a === 'history') openHistory(); else if (a === 'settings') window.csmFeatures.openSettings();
  else if (a.startsWith('select:') && sessions.has(a.slice(7))) select(a.slice(7)); // depuis le menu de l'icône
});

window.csmFeatures = window.csmFeatures || {}; // rempli par panel.js, settings.js, palette.js
publishLocale();
loadSettings().finally(() => { setupFilters(); connect(); setLayout(layout); window.dispatchEvent(new Event('csm:ready')); document.documentElement.dataset.ready = '1'; }); // réglages et langue définitifs (repère pour les tests)

const UI_VERSION = document.querySelector('meta[name="sm-version"]')?.content || document.querySelector('meta[name="asm-version"]')?.content || document.querySelector('meta[name="csm-version"]')?.content || '';
async function checkServerVersion() {
  let server = '';
  try { server = (await api('GET', '/api/version')).version; } catch { server = ''; }
  const native = window.smNative || window.asmNative || window.csmNative;
  const expected = native?.appVersion?.() || UI_VERSION;
  const stale = !server || (expected && server !== expected);
  $('#stale').hidden = !stale;
  if (!stale) return;

  const isAppMismatch = native && expected && server && expected !== server;
  if (isAppMismatch) {
    $('#staleMsg').textContent = `L’application (${expected}) et le serveur (${server}) n’ont pas la même version. Redémarrer le serveur applique la mise à jour ; les sessions reviennent toutes seules.`;
    $('#btnStale').hidden = false;
    $('#btnStale').textContent = t('Redémarrer le serveur');
  } else {
    $('#staleMsg').textContent = `Le serveur tourne ${server ? 'la version ' + server : 'une ancienne version'}${expected ? ' (application : ' + expected + ')' : ''} : certaines fonctions ne marchent pas. Redémarrer le relance avec le bon code ; les sessions ouvertes reviennent toutes seules.`;
    $('#btnStale').hidden = !native?.restartServer;
    $('#btnStale').textContent = t('Redémarrer le serveur');
    if (!native) $('#staleMsg').textContent += ' Commande : fsm restart';
  }
}
$('#btnStale').onclick = async () => {
  $('#btnStale').disabled = true; $('#btnStale').textContent = t('Redémarrage…');
  const native = window.smNative || window.asmNative || window.csmNative;
  // Le serveur survit à la relance de l'app : c'est lui qu'il faut redémarrer.
  if (!native?.restartServer && native?.relaunchApp) {
    await native.relaunchApp();
    return;
  }
  const ok = await native?.restartServer?.();
  if (!ok) {
    $('#btnStale').disabled = false;
    $('#btnStale').textContent = t('Redémarrer');
    toast(t('Le serveur ne redémarre pas — voir le journal'), true);
  } else {
    location.reload();
  }
};
