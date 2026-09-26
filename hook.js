'use strict';
// Hook unifié Sessions Manager : Claude Code & Antigravity (agy).
// Ne doit jamais bloquer ni faire échouer la session de l'agent.
const http = require('http');
const [, , rawEvent] = process.argv;

const SM_ID = process.env.SM_ID || process.env.ASM_ID || process.env.CSM_ID;
const SM_PORT = process.env.SM_PORT || process.env.ASM_PORT || process.env.CSM_PORT || '7895';
const SM_TOKEN = process.env.SM_TOKEN || process.env.ASM_TOKEN || process.env.CSM_TOKEN || '';

let input = '';
process.stdin.setEncoding('utf8');
process.stdin.on('data', c => { input += c; });
process.stdin.on('end', send);
setTimeout(send, 3000); // Filet de sécurité si stdin ne se ferme pas

let sent = false;
function send() {
  if (sent) return; sent = true;
  let data = {};
  try { data = JSON.parse(input || '{}'); } catch { }

  let event = rawEvent || 'working';
  if (rawEvent === 'PreInvocation' || rawEvent === 'PreToolUse') event = 'working';
  else if (rawEvent === 'Stop') event = 'idle';
  else if (rawEvent === 'SessionStart') event = 'start';

  const toolName = data.toolCall?.name || data.tool_name || '';
  const conversationId = data.conversationId || data.session_id || '';
  const agent = process.env.SM_AGENT || (rawEvent?.startsWith('Pre') || rawEvent === 'Stop' ? '' : 'claude');

  const body = JSON.stringify({
    id: SM_ID || conversationId,
    agent,
    sm: SM_ID || conversationId,
    asm: SM_ID || conversationId,
    csm: SM_ID || conversationId,
    event,
    data: {
      conversationId,
      session_id: conversationId,
      message: data.message || '',
      tool_name: toolName
    },
  });

  const req = http.request({
    host: '127.0.0.1', port: Number(SM_PORT), path: '/api/hook', method: 'POST', timeout: 4000,
    headers: {
      'Content-Type': 'application/json',
      'Content-Length': Buffer.byteLength(body),
      'X-SM-Token': SM_TOKEN,
      'X-ASM-Token': SM_TOKEN,
      'X-CSM-Token': SM_TOKEN,
      Host: `127.0.0.1:${SM_PORT}`
    },
  }, res => {
    res.resume();
    res.on('end', finish);
  });
  req.on('error', finish);
  req.on('timeout', () => { req.destroy(); finish(); });
  req.end(body);
}

function finish() {
  // Répond au contrat JSON attendu par agy ou claude
  if (rawEvent === 'PreToolUse') {
    process.stdout.write(JSON.stringify({ decision: 'allow' }) + '\n');
  } else {
    process.stdout.write('{}\n');
  }
  process.exit(0);
}
