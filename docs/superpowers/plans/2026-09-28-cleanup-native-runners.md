# Plan — cleanup + runners natifs (spec : ../specs/2026-09-28-cleanup-native-runners.md)

## T1 — Fournisseurs + runner générique (TDD)
- tests/direct-provider-tests.js (branché dans run-all-tests.js) : normalizeModel par provider,
  resolveProvider kilo sans clé (anonyme, baseURL gateway), opencode avec clé (Zen),
  opencode sans clé (repli kilo + modèle équivalent + flag fallback), openrouter sans clé (erreur claire).
- lib/direct-providers.js ; bin/direct-agent.js (--provider) ; bin/openrouter-agent.js → wrapper.
- server.js spawnSession : les 3 agents via NODE_BIN direct-agent.js --provider, env clés
  (KILO_API_KEY, OPENCODE_API_KEY, OPENROUTER_API_KEY). /api/agents/status : kilo/opencode natifs.
- Vérif manuelle : `node bin/direct-agent.js --provider kilo --model kilo/kilo-auto/free --prompt "dis bonjour" --once`.

## T2 — Nettoyage backend (TDD sur settings/AGENT_NAMES)
- lib/settings.js enums/défauts/cleanTemplate ; server.js replis 'claude', AGENT_NAMES, hooks agy,
  routes install-claude/update-agy/quotas agy/claude ; lib/agents.js fonctions claude/agy ;
  lib/config.js resolveClaude/Agy/has*, .env codé en dur ; hook.js ; lib/usage.js ;
  suppression bin/asm.js, lib/agy-cli.js ; bin/sm.js aide/commandes/port 7898 ; pickFolder échappement.

## T3 — Nettoyage frontend/electron
- public/settings.js handlers morts ; panel.js clés i18n ; 'sm restart'/'asm restart' → 'fsm restart' ;
  palette labels ; electron/updater.js titre + pas d'erreur sans REPO.

## T4 — Revue, vérification, build & install
- revue du diff ; npm test ; smoke test serveur (spawn session kilo native) ; npm run install:app ;
  vérifier Info.plist 1.0.1.
