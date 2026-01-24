#!/usr/bin/env node

import { spawn, execSync } from 'node:child_process';
import { createServer } from 'node:net';
import { env, platform, exit, argv } from 'node:process';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { homedir } from 'node:os';

// Configuration
const OPENCODE_PORT_START = parseInt(env.OPENCODE_PORT || '4096', 10);
const OPENCODE_PORT_MAX = OPENCODE_PORT_START + 10;

function findOpencodeBin(): string | null {
  // 1. Try finding 'opencode' in PATH
  try {
    const cmd = platform === 'win32' ? 'where opencode' : 'which -a opencode';
    const output = execSync(cmd, { encoding: 'utf-8' }).trim().split('\n');
    
    // Filter out this script itself to avoid infinite recursion
    const currentScript = argv[1];
    
    for (const bin of output) {
      const normalizedBin = bin.trim();
      // Skip if it looks like our wrapper
      if (normalizedBin.includes('opencode-tmux') || normalizedBin === currentScript) continue;
      if (normalizedBin) return normalizedBin;
    }
  } catch (e) {
    // Ignore errors from 'which'/'where' if not found
  }

  // 2. Fallback to common install locations
  const commonPaths = [
    join(homedir(), '.opencode', 'bin', platform === 'win32' ? 'opencode.exe' : 'opencode'),
    join(homedir(), 'AppData', 'Local', 'opencode', 'bin', 'opencode.exe'), // Common Windows location
    '/usr/local/bin/opencode',
    '/usr/bin/opencode'
  ];

  for (const p of commonPaths) {
    if (existsSync(p)) return p;
  }

  return null;
}

function checkPort(port: number): Promise<boolean> {
  return new Promise((resolve) => {
    const server = createServer();
    server.listen(port, '127.0.0.1');
    server.on('listening', () => {
      server.close();
      resolve(true); // Available
    });
    server.on('error', () => {
      resolve(false); // In use
    });
  });
}

async function findAvailablePort(): Promise<number | null> {
  for (let port = OPENCODE_PORT_START; port <= OPENCODE_PORT_MAX; port++) {
    if (await checkPort(port)) return port;
  }
  return null;
}

function hasTmux(): boolean {
  try {
    execSync('tmux -V', { stdio: 'ignore' });
    return true;
  } catch (e) {
    return false;
  }
}

// --- Main Logic ---

async function main() {
  const opencodeBin = findOpencodeBin();
  if (!opencodeBin) {
    console.error("❌ Error: Could not find 'opencode' binary.");
    console.error("   Please ensure OpenCode is installed and in your PATH.");
    exit(1);
  }

  const port = await findAvailablePort();
  if (!port) {
    console.error("❌ No ports available in range " + OPENCODE_PORT_START + "-" + OPENCODE_PORT_MAX);
    exit(1);
  }

  if (port !== OPENCODE_PORT_START) {
    console.warn(`⚠️  Port ${OPENCODE_PORT_START} is in use, using port ${port} instead`);
  }

  env.OPENCODE_PORT = port.toString();

  // Pass-through arguments
  const args = argv.slice(2);
  // Construct arguments for the opencode binary
  const childArgs = ['--port', port.toString(), ...args];

  const inTmux = !!env.TMUX;
  const tmuxAvailable = hasTmux();

  if (inTmux || !tmuxAvailable) {
    // Case 1: Already in tmux
    // Case 2: Tmux not installed (e.g. pure Windows) -> Fallback to running directly
    
    const child = spawn(opencodeBin, childArgs, { stdio: 'inherit' });
    child.on('close', (code) => exit(code ?? 0));
    
    // Handle signals
    process.on('SIGINT', () => child.kill('SIGINT'));
    process.on('SIGTERM', () => child.kill('SIGTERM'));

  } else {
    // Case 3: Not in tmux, and tmux is available -> Launch new session
    console.log("🚀 Launching tmux session...");
    
    // Let's use a safe quoting strategy for the binary and args
    const safeCommand = [
      `"${opencodeBin}"`,
      `--port ${port}`,
      ...args.map(a => `"${a}"`)
    ].join(' ');

    // The shell command to run inside tmux
    const shellCommand = `${safeCommand} || { echo "Exit code: $?"; echo "Press Enter to close..."; read; }`;

    const tmuxArgs = [
      'new-session',
      shellCommand
    ];

    const child = spawn('tmux', tmuxArgs, { stdio: 'inherit' });
    child.on('close', (code) => exit(code ?? 0));
  }
}

main().catch(err => {
  console.error(err);
  exit(1);
});
