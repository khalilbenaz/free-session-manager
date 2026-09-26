'use strict';
// node-pty (macOS) : l'archive npm peut perdre le bit exécutable de spawn-helper → « posix_spawnp failed ».
const fs = require('fs');
const path = require('path');
if (process.platform !== 'darwin') process.exit(0);
let base;
try { base = path.dirname(require.resolve('node-pty/package.json')); } catch { process.exit(0); }
for (const dir of ['prebuilds/darwin-arm64', 'prebuilds/darwin-x64', 'build/Release']) {
  const f = path.join(base, dir, 'spawn-helper');
  try { fs.chmodSync(f, 0o755); } catch { }
}

// Antigravity CLI (agy) ne s'installe PLUS automatiquement ici : exécuter un script distant
// (`curl | bash`) lors d'un simple `npm install` est un risque supply-chain et une surprise
// pour l'utilisateur. L'installation reste opt-in : via l'app (Réglages › À propos & Agents)
// ou la CLI (`sm`), qui appellent lib/agents.js installAgy().
