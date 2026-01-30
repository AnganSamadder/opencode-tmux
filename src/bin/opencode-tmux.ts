#!/usr/bin/env node

import { spawn, execSync } from 'node:child_process';
import { createServer } from 'node:net';
import { env, platform, exit, argv } from 'node:process';
import { existsSync, appendFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { homedir } from 'node:os';
import { fileURLToPath } from 'node:url';

const OPENCODE_PORT_START = parseInt(env.OPENCODE_PORT || '4096', 10);
const OPENCODE_PORT_MAX = OPENCODE_PORT_START + 10;
const LOG_FILE = '/tmp/opencode-tmux.log';
const HEALTH_TIMEOUT_MS = 1000;

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

function log(...args: unknown[]): void {
  const timestamp = new Date().toISOString();
  const message = `[${timestamp}] ${args.join(' ')}\n`;
  try {
    appendFileSync(LOG_FILE, message);
  } catch {}
}

function spawnPluginUpdater(): void {
  if (env.OPENCODE_TMUX_DISABLE_UPDATES === '1') return;

  const updaterPath = join(__dirname, '../scripts/update-plugins.js');
  if (!existsSync(updaterPath)) return;

  try {
    const child = spawn(
      process.execPath,
      [updaterPath],
      {
        stdio: 'ignore',
        detached: true,
        env: {
          ...process.env,
          OPENCODE_TMUX_UPDATE: '1'
        }
      }
    );
    child.unref();
  } catch (error) {}
}

function findOpencodeBin(): string | null {
  try {
    const cmd = platform === 'win32' ? 'where opencode' : 'which -a opencode';
    const output = execSync(cmd, { encoding: 'utf-8' }).trim().split('\n');
    
    const currentScript = argv[1];
    
    for (const bin of output) {
      const normalizedBin = bin.trim();
      if (normalizedBin.includes('opencode-tmux') || normalizedBin === currentScript) continue;
      if (normalizedBin) return normalizedBin;
    }
  } catch (e) {}

  const commonPaths = [
    join(homedir(), '.opencode', 'bin', platform === 'win32' ? 'opencode.exe' : 'opencode'),
    join(homedir(), 'AppData', 'Local', 'opencode', 'bin', 'opencode.exe'),
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
      resolve(true);
    });
    server.on('error', () => {
      resolve(false);
    });
  });
}

function isProcessAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

function safeExec(command: string): string | null {
  try {
    const output = execSync(command, {
      encoding: 'utf-8',
      stdio: ['ignore', 'pipe', 'ignore'],
    });
    return output.trim();
  } catch {
    return null;
  }
}

function getTmuxPanePids(): Set<number> {
  if (!hasTmux()) return new Set();

  const output = safeExec("tmux list-panes -a -F '#{pane_pid}'");
  if (!output) return new Set();

  const pids = output
    .split('\n')
    .map((value) => Number.parseInt(value.trim(), 10))
    .filter((value) => Number.isFinite(value));

  return new Set(pids);
}

async function isOpencodeHealthy(port: number): Promise<boolean> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), HEALTH_TIMEOUT_MS);
  const healthUrl = `http://127.0.0.1:${port}/health`;

  try {
    const response = await fetch(healthUrl, { signal: controller.signal }).catch(
      () => null,
    );
    return response?.ok ?? false;
  } catch {
    return false;
  } finally {
    clearTimeout(timeout);
  }
}

function getListeningPids(port: number): number[] {
  if (platform === 'win32') return [];
  const output = safeExec(`lsof -nP -iTCP:${port} -sTCP:LISTEN -t`);
  if (!output) return [];

  return output
    .split('\n')
    .map((value) => Number.parseInt(value.trim(), 10))
    .filter((value) => Number.isFinite(value));
}

function getProcessCommand(pid: number): string | null {
  const output = safeExec(`ps -p ${pid} -o command=`);
  return output && output.length > 0 ? output : null;
}

function getProcessStat(pid: number): string | null {
  const output = safeExec(`ps -p ${pid} -o stat=`);
  return output && output.length > 0 ? output.trim() : null;
}

function getProcessTty(pid: number): string | null {
  const output = safeExec(`ps -p ${pid} -o tty=`);
  return output && output.length > 0 ? output.trim() : null;
}

function getTtyProcessIds(tty: string): number[] {
  const output = safeExec(`ps -t ${tty} -o pid=`);
  if (!output) return [];
  return output
    .split('\n')
    .map((value) => Number.parseInt(value.trim(), 10))
    .filter((value) => Number.isFinite(value));
}

function hasOtherTtyProcesses(tty: string | null, pid: number): boolean {
  if (!tty || tty === '?' || tty === '??') return false;
  const ttyPids = getTtyProcessIds(tty);
  return ttyPids.some((ttyPid) => ttyPid !== pid);
}

function getParentPid(pid: number): number | null {
  const output = safeExec(`ps -p ${pid} -o ppid=`);
  if (!output) return null;
  const value = Number.parseInt(output.trim(), 10);
  return Number.isFinite(value) ? value : null;
}

function isDescendantOf(pid: number, ancestors: Set<number>): boolean {
  let current = pid;
  const visited = new Set<number>();

  while (current > 1 && !visited.has(current)) {
    if (ancestors.has(current)) return true;
    visited.add(current);

    const parent = getParentPid(current);
    if (!parent || parent <= 1) return false;
    current = parent;
  }

  return false;
}

function isForegroundProcess(pid: number): boolean {
  const stat = safeExec(`ps -p ${pid} -o stat=`);
  if (!stat) return false;
  return stat.includes('+');
}

function killZombieClients(): void {
  if (platform === 'win32') return;

  log('Scanning for zombie opencode clients...');
  const output = safeExec('ps -A -o pid,ppid,command');
  if (!output) return;

  const lines = output.split('\n').slice(1);
  const currentPid = process.pid;
  const parentPid = process.ppid;

  const wrapperCount = lines.filter(line => {
    const trimmed = line.trim();
    if (!trimmed) return false;
    const match = trimmed.match(/^(\d+)\s+(\d+)\s+(.+)$/);
    if (!match) return false;
    const command = match[3];
    return (command.includes('opencode-tmux.ts') || command.includes('bin/opencode-tmux')) && !command.includes('ps ');
  }).length;

  if (wrapperCount > 1) {
    log(`Active sessions detected (${wrapperCount} wrappers), skipping zombie cleanup.`);
    return;
  }

  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed) continue;

    const match = trimmed.match(/^(\d+)\s+(\d+)\s+(.+)$/);
    if (!match) continue;

    const pid = parseInt(match[1], 10);
    const ppid = parseInt(match[2], 10);
    const command = match[3];

    if (pid === currentPid || pid === parentPid) continue;

    if (
      command.includes('opencode') &&
      command.includes('attach') &&
      command.includes('--session')
    ) {
      if (command.includes('opencode-agent-tmux') || command.includes('opencode-tmux')) {
        continue;
      }

      log(`Found zombie client: PID ${pid}, PPID ${ppid}, CMD: ${command}`);
      log(`Sending SIGKILL to zombie PID ${pid}`);
      try {
        process.kill(pid, 'SIGKILL');
      } catch (err) {
        log(`Failed to kill PID ${pid}: ${err instanceof Error ? err.message : String(err)}`);
      }
    }
  }
}

async function getOpencodeSessionCount(port: number): Promise<number | null> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), HEALTH_TIMEOUT_MS);
  const statusUrl = `http://127.0.0.1:${port}/session/status`;

  try {
    const response = await fetch(statusUrl, { signal: controller.signal }).catch(
      () => null,
    );
    if (!response?.ok) return null;

    const payload = (await response.json().catch(() => null)) as unknown;
    if (!payload || typeof payload !== 'object') return null;

    const maybeData = (payload as { data?: unknown }).data;
    if (maybeData && typeof maybeData === 'object' && !Array.isArray(maybeData)) {
      return Object.keys(maybeData as Record<string, unknown>).length;
    }

    if (!Array.isArray(payload)) {
      return Object.keys(payload as Record<string, unknown>).length;
    }

    return payload.length;
  } catch {
    return null;
  } finally {
    clearTimeout(timeout);
  }
}

async function tryReclaimPort(
  port: number,
  tmuxPanePids: Set<number>,
): Promise<boolean> {
  if (platform === 'win32') return false;

  const healthy = await isOpencodeHealthy(port);
  if (healthy) return false;

  const pids = getListeningPids(port);

  log(
    'Port scan:',
    port.toString(),
    'healthy',
    String(healthy),
    'pids',
    pids.length > 0 ? pids.join(',') : 'none',
  );

  if (pids.length === 0) {
    return false;
  }

  let attemptedKill = false;
  for (const pid of pids) {
    const command = getProcessCommand(pid);
    const tty = getProcessTty(pid);
    const stat = getProcessStat(pid);
    const hasTtyPeers = hasOtherTtyProcesses(tty, pid);

    const inTmux = tmuxPanePids.size > 0 && isDescendantOf(pid, tmuxPanePids);
    log(
      'Port process:',
      port.toString(),
      'pid',
      pid.toString(),
      'tty',
      tty ?? 'unknown',
      'stat',
      stat ?? 'unknown',
      'tmux',
      String(inTmux),
      'ttyPeers',
      String(hasTtyPeers),
      'command',
      command ?? 'unknown',
    );

    if (command && command.includes('opencode')) {
      if (inTmux) {
        log('Port owned by tmux process, skipping:', port.toString(), pid.toString());
        continue;
      }

      if (hasTtyPeers) {
        log('Port owned by active tty process, skipping:', port.toString(), pid.toString());
        continue;
      }

      if (isForegroundProcess(pid)) {
        log('Port owned by potentially busy foreground process, skipping:', port.toString(), pid.toString());
        continue;
      }
    }

    log('Attempting to stop stale or non-opencode process:', port.toString(), pid.toString());
    attemptedKill = true;
    try {
      process.kill(pid, 'SIGTERM');
    } catch {}
  }

  if (!attemptedKill) return false;

  await new Promise((resolve) => setTimeout(resolve, 700));

  for (const pid of pids) {
    if (isProcessAlive(pid)) {
      log('Process still alive, sending SIGKILL:', port.toString(), pid.toString());
      try {
        process.kill(pid, 'SIGKILL');
      } catch {}
    }
  }

  await new Promise((resolve) => setTimeout(resolve, 400));
  return checkPort(port);
}

async function findAvailablePort(): Promise<number | null> {
  let tmuxPanePids: Set<number> | null = null;
  for (let port = OPENCODE_PORT_START; port <= OPENCODE_PORT_MAX; port++) {
    if (await checkPort(port)) return port;

    if (!tmuxPanePids) {
      tmuxPanePids = getTmuxPanePids();
    }

    const reclaimed = await tryReclaimPort(port, tmuxPanePids);
    if (reclaimed && (await checkPort(port))) return port;
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

async function main() {
  const args = argv.slice(2);
  const isCliCommand =
    args.length > 0 &&
    (['auth', 'config', 'plugins', 'update', 'completion', 'stats'].includes(args[0]) ||
      ['--version', '-v', '--help', '-h'].includes(args[0]) ||
      args.includes('--print-logs') ||
      args.includes('--log-level'));

  if (isCliCommand) {
    const opencodeBin = findOpencodeBin();
    if (!opencodeBin) {
      console.error(
        'Error: Could not find "opencode" binary in PATH or common locations.',
      );
      exit(1);
    }

    const bypassArgs = [...args];
    const hasPrintLogs = args.includes('--print-logs');
    if (!hasPrintLogs && !args.some((arg) => arg.startsWith('--log-level'))) {
      bypassArgs.push('--log-level', 'ERROR');
    }

    const child = spawn(opencodeBin, bypassArgs, {
      stdio: ['inherit', 'inherit', 'pipe'],
      env: process.env,
    });

    child.stderr?.on('data', (data) => {
      const lines = data.toString().split('\n');
      const filtered = lines.filter(
        (line: string) => !/^INFO\s+.*service=models\.dev.*refreshing/.test(line),
      );
      process.stderr.write(filtered.join('\n'));
    });

    child.on('close', (code) => {
      exit(code ?? 0);
    });
    return;
  }

  log('=== OpenCode Tmux Wrapper Started ===');
  log('Process argv:', JSON.stringify(argv));
  log('Current directory:', process.cwd());
  
  const opencodeBin = findOpencodeBin();
  log('Found opencode binary:', opencodeBin);
  
  if (!opencodeBin) {
    console.error('Error: Could not find "opencode" binary in PATH or common locations.');
    log('ERROR: opencode binary not found');
    exit(1);
  }

  spawnPluginUpdater();

  killZombieClients();

  const port = await findAvailablePort();
  log('Found available port:', port);
  
  if (!port) {
    console.error('Error: No available ports found in range 4096-4106.');
    log('ERROR: No available ports');
    exit(1);
  }

  const env2 = { ...process.env };
  env2.OPENCODE_PORT = port.toString();

  log('User args:', JSON.stringify(args));
  
  const childArgs = ['--port', port.toString(), ...args];
  log('Final childArgs:', JSON.stringify(childArgs));

  const inTmux = !!env2.TMUX;
  const tmuxAvailable = hasTmux();
  
  log('In tmux?', inTmux);
  log('Tmux available?', tmuxAvailable);

  if (inTmux || !tmuxAvailable) {
    log('Running directly (in tmux or no tmux available)');
    
    const child = spawn(opencodeBin, childArgs, { stdio: 'inherit', env: env2 });
    
    child.on('error', (err) => {
      log('ERROR spawning child:', err.message);
    });
    
    child.on('close', (code) => {
      log('Child exited with code:', code);
      exit(code ?? 0);
    });
    
    process.on('SIGINT', () => child.kill('SIGINT'));
    process.on('SIGTERM', () => child.kill('SIGTERM'));

  } else {
    console.log("🚀 Launching tmux session...");
    log('Launching tmux session');
    
    const escapedBin = opencodeBin.includes(' ') ? `'${opencodeBin}'` : opencodeBin;
    const escapedArgs = childArgs.map(arg => {
      if (arg.includes(' ') || arg.includes('"') || arg.includes("'")) {
        return `'${arg.replace(/'/g, "'\\''")}'`;
      }
      return arg;
    });

    // Run opencode - tmux will close automatically when it exits normally
    // Only show "Press Enter" prompt if there's an unexpected error (non-zero/non-signal exit)
    const shellCommand = `${escapedBin} ${escapedArgs.join(' ')}; EXIT_CODE=$?; if [ $EXIT_CODE -ne 0 ] && [ $EXIT_CODE -ne 130 ] && [ $EXIT_CODE -ne 133 ] && [ $EXIT_CODE -ne 143 ]; then echo "Exit code: $EXIT_CODE"; echo "Press Enter to close..."; read; fi`;
    
    log('Shell command for tmux:', shellCommand);

    const tmuxArgs = [
      'new-session',
      '-c', process.cwd(),  // Use current working directory
      shellCommand
    ];
    
    log('Tmux args:', JSON.stringify(tmuxArgs));

    const child = spawn('tmux', tmuxArgs, { stdio: 'inherit', env: env2 });
    
    child.on('error', (err) => {
      log('ERROR spawning tmux:', err.message);
    });
    
    child.on('close', (code) => {
      log('Tmux exited with code:', code);
      exit(code ?? 0);
    });
  }
}

main().catch(err => {
  log('FATAL ERROR:', err.message, err.stack);
  console.error(err);
  exit(1);
});
