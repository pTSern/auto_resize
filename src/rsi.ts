#!/usr/bin/env node

import { spawn } from 'child_process';

console.log('====================================================');
console.log('       AUTO RESIZE VIDEO - INSTALLER LAUNCHER (rsi)');
console.log('====================================================');

// Spawn powershell to run the online installer command interactively
const child = spawn('powershell', [
  '-NoProfile',
  '-ExecutionPolicy',
  'Bypass',
  '-Command',
  'irm https://raw.githubusercontent.com/pTSern/auto_resize/master/install.ps1 | iex'
], {
  stdio: 'inherit',
  shell: true
});

child.on('exit', (code) => {
  process.exit(code || 0);
});
