'use strict';
// Génère docs/guide.html (site GitHub Pages) à partir du README : une seule source pour le guide.
// Usage : npm run guide
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const md = fs.readFileSync(path.join(ROOT, 'README.md'), 'utf8').replace(/\r\n/g, '\n');
const version = require('../package.json').version;

// Sections du guide : de « 1. Installation » à la dernière section numérotée (hors licence / politiques en anglais).
const body = md.slice(md.indexOf('## 1. '), md.indexOf('## Licence'));

const esc = s => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const slug = s => s.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[`'’]/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');

// Mise en forme en ligne : code, gras, italique, liens ; les balises <kbd> du README sont conservées.
function inline(s) {
  const codes = [];
  s = s.replace(/`([^`]+)`/g, (_, c) => { codes.push(`<code>${esc(c)}</code>`); return `\u0000${codes.length - 1}\u0000`; });
  s = esc(s).replace(/&lt;(\/?)kbd&gt;/g, '<$1kbd>');
  s = s.replace(/\*\*([^*]+)\*\*/g, '<b>$1</b>').replace(/(^|[\s(])\*([^*]+)\*/g, '$1<i>$2</i>');
  s = s.replace(/\[([^\]]+)\]\(([^)]+)\)/g, (_, t, u) => {
    if (u.startsWith('#')) u = '#' + u.slice(1).replace(/^(\d+)-/, 'g$1-'); // ancres du README → ancres du guide
    const ext = /^https?:/.test(u) && !u.includes('khalilbenaz.github.io');
    return `<a href="${u}"${ext ? ' target="_blank" rel="noopener"' : ''}>${t}</a>`;
  });
  return s.replace(/\u0000(\d+)\u0000/g, (_, i) => codes[+i]);
}

const out = [], toc = [];
const lines = body.split('\n');
for (let i = 0; i < lines.length; i++) {
  const l = lines[i];
  if (/^---\s*$/.test(l) || !l.trim()) continue;
  let m;
  if (/^(<a id="[^"]+"><\/a>)+$/.test(l)) { out.push(l); continue; } // ancres de compatibilité
  if ((m = l.match(/^## (\d+)\. (.*)$/))) {
    const id = `g${m[1]}-${slug(m[2])}`;
    toc.push({ id, n: m[1], t: m[2] });
    if (out.length) out.push('</section>');
    out.push(`<section id="${id}"><h2><span class="num">${m[1]}</span>${inline(m[2])}</h2>`);
  } else if ((m = l.match(/^### (.*)$/))) out.push(`<h3>${inline(m[1])}</h3>`);
  else if (l.startsWith('```')) {
    const buf = []; i++;
    while (i < lines.length && !lines[i].startsWith('```')) buf.push(lines[i++]);
    out.push(`<pre class="${buf.some(x => /[┌│└]/.test(x)) ? 'schema' : 'cli'}">${esc(buf.join('\n'))}</pre>`);
  } else if (l.startsWith('|')) {
    const rows = [];
    while (i < lines.length && lines[i].startsWith('|')) rows.push(lines[i++]);
    i--;
    const cells = r => r.replace(/^\||\|$/g, '').split('|').map(c => c.trim());
    const [h, , ...rest] = rows;
    out.push(`<div class="tablebox"><table><thead><tr>${cells(h).map(c => `<th>${inline(c)}</th>`).join('')}</tr></thead><tbody>${rest.map(r => `<tr>${cells(r).map(c => `<td>${inline(c)}</td>`).join('')}</tr>`).join('')}</tbody></table></div>`);
  } else if (/^(\d+\.|-) /.test(l)) {
    const ordered = /^\d+\./.test(l); const items = [];
    while (i < lines.length && /^(\d+\.|-) /.test(lines[i])) items.push(lines[i++].replace(/^(\d+\.|-) /, ''));
    i--;
    out.push(`<${ordered ? 'ol' : 'ul'}>${items.map(x => `<li>${inline(x)}</li>`).join('')}</${ordered ? 'ol' : 'ul'}>`);
  } else if (l.startsWith('> ')) out.push(`<p class="note">${inline(l.slice(2))}</p>`);
  else out.push(`<p>${inline(l)}</p>`);
}
out.push('</section>');

const html = `<!doctype html>
<html lang="fr">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Guide — AGY Sessions</title>
<meta name="description" content="Guide complet de AGY Sessions : sessions, groupes, vue partagée, worktrees git, verrouillage, notifications, réglages, raccourcis.">
<link rel="icon" href="icon.svg">
<meta name="theme-color" content="#12161f">
<!-- Généré par scripts/build-guide.js à partir du README : ne pas modifier à la main. -->
<style>
:root { --bg: #10141d; --panel: #171d2a; --panel2: #1f2738; --line: #2b364c; --fg: #e8ecf4; --dim: #8fa0ba; --accent: #00d2b4; --mono: "Cascadia Mono", Consolas, "SF Mono", Menlo, monospace; }
@media (prefers-color-scheme: light) { :root { --bg: #f6f8fb; --panel: #ffffff; --panel2: #edf2f7; --line: #d8e2ec; --fg: #151d28; --dim: #5a6b82; --accent: #009982; } }
* { box-sizing: border-box; }
html { scroll-behavior: smooth; scroll-padding-top: 76px; }
body { margin: 0; background: var(--bg); color: var(--fg); font: 16px/1.65 -apple-system, "Segoe UI", system-ui, sans-serif; }
a { color: var(--accent); text-decoration: none; } a:hover { text-decoration: underline; }
header { position: sticky; top: 0; z-index: 10; background: color-mix(in srgb, var(--bg) 88%, transparent); backdrop-filter: blur(8px); border-bottom: 1px solid var(--line); }
header .in { max-width: 1180px; margin: 0 auto; padding: 0 20px; display: flex; align-items: center; gap: 16px; height: 60px; }
.brand { display: flex; align-items: center; gap: 10px; font-weight: 650; color: var(--fg); }
.brand img { width: 28px; height: 28px; }
header nav { margin-left: auto; display: flex; gap: 18px; font-size: 14px; }
header nav a { color: var(--dim); } header nav a.on, header nav a:hover { color: var(--fg); text-decoration: none; }
.layout { max-width: 1180px; margin: 0 auto; padding: 0 20px; display: grid; grid-template-columns: 250px minmax(0, 1fr); gap: 40px; overflow-x: clip; }
aside.toc { position: sticky; top: 76px; align-self: start; max-height: calc(100vh - 90px); overflow-y: auto; padding: 24px 0; font-size: 14px; }
aside.toc b { display: block; color: var(--dim); font-size: 12px; text-transform: uppercase; letter-spacing: .05em; margin-bottom: 8px; }
aside.toc a { display: flex; gap: 8px; padding: 4px 8px; border-radius: 6px; color: var(--dim); }
aside.toc a span { min-width: 18px; text-align: right; opacity: .7; }
aside.toc a:hover, aside.toc a.on { background: var(--panel2); color: var(--fg); text-decoration: none; }
main { padding: 28px 0 80px; min-width: 0; }
h1 { font-size: clamp(28px, 4vw, 38px); margin: 0 0 6px; letter-spacing: -.02em; }
.lead { color: var(--dim); margin: 0 0 28px; }
section { padding-top: 22px; border-top: 1px solid var(--line); margin-top: 26px; }
section:first-of-type { border-top: none; margin-top: 0; }
h2 { font-size: 24px; margin: 0 0 12px; display: flex; align-items: center; gap: 12px; }
h2 .num { display: inline-grid; place-items: center; min-width: 32px; height: 32px; border-radius: 50%; background: var(--accent); color: #0a1c17; font-size: 15px; font-weight: bold; }
h3 { font-size: 18px; margin: 22px 0 8px; }
p, li { color: color-mix(in srgb, var(--fg) 88%, var(--dim)); overflow-wrap: anywhere; }
td { overflow-wrap: anywhere; }
ul, ol { padding-left: 22px; } li { margin: 4px 0; }
code, kbd { font-family: var(--mono); font-size: .86em; background: var(--panel2); border: 1px solid var(--line); border-radius: 5px; padding: 1px 6px; }
kbd { border-bottom-width: 2px; }
.tablebox { background: var(--panel); border: 1px solid var(--line); border-radius: 12px; overflow-x: auto; margin: 12px 0; }
table { width: 100%; border-collapse: collapse; font-size: 15px; }
th, td { text-align: left; padding: 10px 12px; border-bottom: 1px solid var(--line); vertical-align: top; }
tr:last-child td { border-bottom: none; }
th { color: var(--dim); font-weight: 500; font-size: 13px; text-transform: uppercase; letter-spacing: .04em; }
pre { border: 1px solid var(--line); border-radius: 10px; padding: 14px 16px; overflow-x: auto; font: 13px/1.5 var(--mono); }
pre.cli { background: #0c0f16; color: #d6d9df; }
pre.schema { background: var(--panel); color: var(--fg); font-size: 12.5px; line-height: 1.35; }
.note { background: var(--panel2); border-left: 3px solid var(--accent); border-radius: 6px; padding: 10px 14px; font-size: 14px; }
footer { border-top: 1px solid var(--line); padding: 26px 20px 40px; color: var(--dim); font-size: 14px; text-align: center; }
@media (max-width: 860px) { .layout { grid-template-columns: minmax(0, 1fr); } aside.toc { display: none; } header nav { gap: 12px; } }
@media (max-width: 520px) { header nav a:not(.keep) { display: none; } }
</style>
</head>
<body>
<header><div class="in">
  <a class="brand" href="./"><img src="icon.svg" alt=""> AGY Sessions</a>
  <nav><a href="./">Accueil</a><a class="on keep" href="guide.html">Guide</a><a href="./#telecharger">Télécharger</a><a href="https://github.com/khalilbenaz/agy-sessions-manager" class="keep">GitHub</a></nav>
</div></header>
<div class="layout">
  <aside class="toc"><b>Sommaire</b>
${toc.map(x => `    <a href="#${x.id}"><span>${x.n}</span>${esc(x.t.replace(/`/g, ''))}</a>`).join('\n')}
  </aside>
  <main>
    <h1>Guide de AGY Sessions</h1>
    <p class="lead">Tout ce que fait l'application et comment s'en servir — version ${version}. Le même guide est dans le <a href="https://github.com/khalilbenaz/agy-sessions-manager#readme">README</a>.</p>
${out.join('\n')}
  </main>
</div>
<footer>© 2026 Khalil Benazzouz · <a href="https://github.com/khalilbenaz/agy-sessions-manager/blob/main/LICENSE">Licence MIT</a> · <a href="privacy.html">Confidentialité</a> · <a href="https://github.com/khalilbenaz/agy-sessions-manager/issues">Signaler un problème</a></footer>
<script>
// Section courante surlignée dans le sommaire.
const links = [...document.querySelectorAll('aside.toc a')];
const io = new IntersectionObserver(es => { for (const e of es) if (e.isIntersecting) links.forEach(a => a.classList.toggle('on', a.getAttribute('href') === '#' + e.target.id)); }, { rootMargin: '-80px 0px -70% 0px' });
document.querySelectorAll('main section').forEach(s => io.observe(s));
</script>
</body>
</html>
`;

fs.mkdirSync(path.join(ROOT, 'docs'), { recursive: true });
fs.writeFileSync(path.join(ROOT, 'docs', 'guide.html'), html);
console.log(`docs/guide.html : ${toc.length} sections`);
