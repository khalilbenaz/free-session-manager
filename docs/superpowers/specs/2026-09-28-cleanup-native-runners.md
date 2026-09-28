# Spec — Nettoyage legacy + runners natifs Kilo / OpenCode

Date : 2026-09-28 · Branche : feat/cleanup-native-runners

## Objectif
1. Les sessions `kilo` et `opencode` n'exigent plus les CLI `kilo` / `opencode` : elles
   parlent directement aux API (comme `openrouter` via `bin/openrouter-agent.js`).
2. Supprimer les restes Claude Code / Antigravity (agy) / sm / asm devenus morts ou faux.
3. `npm test` vert avec de nouveaux tests ; app reconstruite et réinstallée dans /Applications.

## Constats API (vérifiés le 2026-09-28)
- Kilo Gateway `https://api.kilo.ai/api/gateway/chat/completions` (OpenAI-compatible) :
  modèles gratuits appelables **anonymement** (sans Authorization). Clé optionnelle `KILO_API_KEY`.
- OpenCode Zen `https://opencode.ai/zen/v1/chat/completions` : le free tier refuse les clients
  tiers (`FreeTierError: OpenCode's free tier can only be used from within OpenCode`).
  Utilisable directement seulement avec une clé Zen `OPENCODE_API_KEY`.

## Conception
- `lib/direct-providers.js` : table des fournisseurs `{ openrouter, kilo, opencode }`
  (baseURL, variable(s) d'env de clé, clé requise ?, en-têtes, préfixes à retirer, défaut),
  `normalizeModel(provider, model)`, `resolveProvider(provider, env)` qui renvoie la cible
  effective (repli OpenCode → Kilo Gateway si pas de clé, avec mapping de modèle équivalent).
- `bin/direct-agent.js --provider <p>` : runner générique (code actuel d'openrouter-agent.js
  généralisé : streaming SSE, transcripts, commandes /help /models /model /clear /ls /read !cmd,
  hooks /api/hook). `bin/openrouter-agent.js` devient un wrapper fin (compat).
- `server.js` : les trois agents se lancent via `NODE_BIN bin/direct-agent.js --provider <agent>`.
  Plus de dépendance à `KILO`/`OPENCODE` pour lancer une session. Clés injectées dans l'env.
- Statut des agents (`/api/agents/status`) : kilo/opencode « natif » (installed: true).

## Nettoyage legacy
- settings : `defaultAgent` ∈ {kilo, opencode, openrouter}, défaut `kilo` ; cleanTemplate idem.
- server : repli `'claude'` → `'kilo'`, AGENT_NAMES complet (palette plus « undefined »),
  suppression hooks agy / routes install-claude / update-agy / quotas claude & agy.
- Suppression `bin/asm.js`, `lib/agy-cli.js` ; `bin/sm.js` : aide et commandes Claude/agy retirées, port 7898.
- config : resolveClaude/resolveAgy/hasClaude/hasAgy retirés, chemin `.env` codé en dur retiré.
- hook.js : repli `kilo`. usage.js : getAgyQuota/getClaudeQuota retirés si plus utilisés.
- public : handlers morts settings.js, clés i18n panel (casse), indications `fsm restart`.
- updater : titre « Free Session Manager » ; sans dépôt configuré, ne pas afficher d'erreur.
- pickFolder AppleScript : échapper `\` et `"`.

## Hors périmètre
Pas d'outils/tool-calling ajoutés aux runners (parité avec openrouter-agent actuel).
Pas de push/merge.
