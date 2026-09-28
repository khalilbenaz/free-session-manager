#!/usr/bin/env node
'use strict';

/**
 * Wrapper de compatibilité : bin/openrouter-agent.js reste présent pour ne
 * rien casser (chemin résolu par lib/config.js#resolveOpenrouter, scripts
 * externes, habitudes) mais délègue intégralement au runner générique
 * bin/direct-agent.js avec --provider openrouter.
 *
 * Le comportement observable (arguments --model/--prompt/--session/--once,
 * commandes REPL /help /models /model /clear /ls /read !cmd, streaming SSE,
 * hooks /api/hook) est strictement identique à avant : direct-agent.js en
 * mode openrouter reproduit exactement l'ancienne implémentation.
 */

const path = require('path');
const { spawn } = require('child_process');

const args = process.argv.slice(2);
const hasProvider = args.some(a => a === '--provider' || a.startsWith('--provider='));
const finalArgs = hasProvider ? args : ['--provider', 'openrouter', ...args];

const child = spawn(process.execPath, [path.join(__dirname, 'direct-agent.js'), ...finalArgs], {
  stdio: 'inherit',
  env: process.env,
});

child.on('exit', (code, signal) => {
  if (signal) {
    process.kill(process.pid, signal);
  } else {
    process.exit(code == null ? 0 : code);
  }
});

child.on('error', (err) => {
  console.error(`Erreur au lancement de direct-agent.js : ${err.message}`);
  process.exit(1);
});
