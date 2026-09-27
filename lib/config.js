'use strict';
// Emplacements et réglages communs au serveur et à la CLI, par OS.
const fs = require('fs');
const path = require('path');
const os = require('os');
const { execFileSync } = require('child_process');

const ROOT = path.join(__dirname, '..');
// --port=N ou SM_PORT / PORT
const argPort = (process.argv.find(a => a.startsWith('--port=')) || '').slice(7);
const PORT = Number(argPort || process.env.KILO_PORT || process.env.SM_PORT || 7898);
const IS_WIN = process.platform === 'win32';
const IS_MAC = process.platform === 'darwin';

function defaultDataDir() {
  if (IS_WIN) return path.join(process.env.APPDATA || path.join(os.homedir(), 'AppData', 'Roaming'), 'free-session-manager');
  if (IS_MAC) return path.join(os.homedir(), 'Library', 'Application Support', 'free-session-manager');
  return path.join(process.env.XDG_DATA_HOME || path.join(os.homedir(), '.local', 'share'), 'free-session-manager');
}

const DATA = process.env.FSM_DATA || process.env.SM_DATA || (PORT === 7898 ? defaultDataDir() : `${defaultDataDir()}-${PORT}`);
const LEGACY_DATA = path.join(ROOT, 'data');

// Charger les variables d'environnement (.env)
const envCandidates = [
  path.join(DATA, '.env'),
  path.join(ROOT, '.env'),
  path.join(os.homedir(), '.kilo', '.env'),
  '/Users/lilou/Projects/kilo-free-chat/.env'
];
for (const envFile of envCandidates) {
  if (fs.existsSync(envFile)) {
    try { require('dotenv').config({ path: envFile }); } catch { }
  }
}

if (!process.env.OPENROUTER_API_TOKEN && process.env.OPENROUTER_API_KEY) {
  process.env.OPENROUTER_API_TOKEN = process.env.OPENROUTER_API_KEY;
}

const SUFFIX = PORT === 7898 ? '' : ` ${PORT}`;
const TASK_NAME = `Free Session Manager${SUFFIX}`;
const LAUNCHD_LABEL = PORT === 7898 ? 'com.free-session-manager.server' : `com.free-session-manager.server.${PORT}`;
const APP_NAME = `Free Session Manager${SUFFIX}`;

// Répertoires des données
const KILO_DIR = path.join(os.homedir(), '.kilo');
const OPENCODE_DIR = path.join(os.homedir(), '.opencode');
const CLAUDE_DIR = path.join(os.homedir(), '.claude');
const CLAUDE_HISTORY_FILE = path.join(CLAUDE_DIR, 'history.jsonl');
const CLAUDE_PROJECTS_DIR = path.join(CLAUDE_DIR, 'projects');
const BRAIN_DIR = path.join(os.homedir(), '.gemini', 'antigravity-cli', 'brain');
const AGY_HISTORY_FILE = path.join(os.homedir(), '.gemini', 'antigravity-cli', 'history.jsonl');
const GEMINI_CONFIG_DIR = path.join(os.homedir(), '.gemini', 'config');

function which(cmd) {
  try {
    const out = execFileSync(IS_WIN ? 'where' : 'which', [cmd], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] });
    return out.split(/\r?\n/).map(s => s.trim()).find(Boolean) || null;
  } catch { return null; }
}

function stablePath(p) {
  if (!p || !/fnm_multishells/.test(p)) return p;
  try { return path.join(fs.realpathSync(path.dirname(p)), path.basename(p)); } catch { return p; }
}

// Résolution de Kilo CLI
function resolveKilo() {
  if (process.env.KILO_CLI || process.env.SM_KILO) return process.env.KILO_CLI || process.env.SM_KILO;
  const found = which('kilo');
  if (found) return stablePath(found);
  const home = os.homedir();
  const candidates = IS_WIN
    ? [path.join(home, '.kilo', 'bin', 'kilo.exe'), path.join(process.env.APPDATA || '', 'npm', 'kilo.cmd')]
    : [path.join(home, '.kilo', 'bin', 'kilo'), '/usr/local/bin/kilo', '/opt/homebrew/bin/kilo'];
  return candidates.find(p => { try { return fs.statSync(p).isFile(); } catch { return false; } }) || 'kilo';
}

function hasKilo() {
  const p = resolveKilo();
  try { return fs.existsSync(p) && fs.statSync(p).isFile(); } catch { return p !== 'kilo'; }
}

// Résolution de OpenCode CLI
function resolveOpencode() {
  if (process.env.OPENCODE_CLI || process.env.SM_OPENCODE) return process.env.OPENCODE_CLI || process.env.SM_OPENCODE;
  const found = which('opencode');
  if (found) return stablePath(found);
  const home = os.homedir();
  const candidates = IS_WIN
    ? [path.join(home, '.opencode', 'bin', 'opencode.exe'), path.join(process.env.APPDATA || '', 'npm', 'opencode.cmd')]
    : [path.join(home, '.opencode', 'bin', 'opencode'), '/usr/local/bin/opencode', '/opt/homebrew/bin/opencode'];
  return candidates.find(p => { try { return fs.statSync(p).isFile(); } catch { return false; } }) || 'opencode';
}

function hasOpencode() {
  const p = resolveOpencode();
  try { return fs.existsSync(p) && fs.statSync(p).isFile(); } catch { return p !== 'opencode'; }
}

// Résolution de Claude Code CLI
function resolveClaude() {
  if (process.env.SM_CLAUDE) return process.env.SM_CLAUDE;
  const found = which('claude');
  if (found) return stablePath(found);
  const home = os.homedir();
  const candidates = IS_WIN
    ? [path.join(home, '.local', 'bin', 'claude.exe'), path.join(process.env.APPDATA || '', 'npm', 'claude.cmd')]
    : [path.join(home, '.local', 'bin', 'claude'), path.join(home, '.claude', 'local', 'claude'),
      '/opt/homebrew/bin/claude', '/usr/local/bin/claude'];
  return candidates.find(p => { try { return fs.statSync(p).isFile(); } catch { return false; } }) || 'claude';
}

// Résolution d'Antigravity CLI (agy)
function resolveAgy() {
  if (process.env.SM_AGY) return process.env.SM_AGY;
  const found = which('agy');
  if (found) return stablePath(found);
  const home = os.homedir();
  const candidates = IS_WIN
    ? [path.join(process.env.LOCALAPPDATA || '', 'agy', 'bin', 'agy.exe'), path.join(home, '.local', 'bin', 'agy.exe'), path.join(process.env.APPDATA || '', 'npm', 'agy.cmd')]
    : [path.join(home, '.local', 'bin', 'agy'), '/opt/homebrew/bin/agy', '/usr/local/bin/agy'];
  return candidates.find(p => { try { return fs.statSync(p).isFile(); } catch { return false; } }) || 'agy';
}

function hasClaude() {
  const p = resolveClaude();
  try { return fs.existsSync(p) && fs.statSync(p).isFile(); } catch { return p !== 'claude'; }
}

function hasAgy() {
  const p = resolveAgy();
  try { return fs.existsSync(p) && fs.statSync(p).isFile(); } catch { return p !== 'agy'; }
}

// Résolution du binaire Node.js
function resolveNode() {
  const found = which(IS_WIN ? 'node.exe' : 'node');
  if (found) return stablePath(found);
  const candidates = IS_WIN
    ? [path.join(process.env.APPDATA || '', 'npm', 'node.exe')]
    : ['/opt/homebrew/bin/node', '/usr/local/bin/node', '/usr/bin/node'];
  for (const c of candidates) {
    try { if (fs.existsSync(c)) return c; } catch {}
  }
  return process.execPath;
}

// Résolution de l'agent OpenRouter Direct (100% natif, sans Kilo)
function resolveOpenrouter() {
  return path.join(ROOT, 'bin', 'openrouter-agent.js');
}

function hasOpenrouter() {
  return true;
}

module.exports = {
  stablePath, ROOT, PORT, IS_WIN, IS_MAC, DATA, LEGACY_DATA,
  TASK_NAME, LAUNCHD_LABEL, APP_NAME, which, resolveNode,
  resolveKilo, hasKilo,
  resolveOpencode, hasOpencode,
  resolveOpenrouter, hasOpenrouter,
  resolveClaude, resolveAgy, hasClaude, hasAgy,
  KILO_DIR, OPENCODE_DIR, CLAUDE_DIR, CLAUDE_HISTORY_FILE, CLAUDE_PROJECTS_DIR,
  BRAIN_DIR, AGY_HISTORY_FILE, GEMINI_CONFIG_DIR
};


