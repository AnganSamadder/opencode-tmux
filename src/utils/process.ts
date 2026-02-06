import { execSync } from 'node:child_process';
import { platform } from 'node:os';

/**
 * Safely executes a shell command and returns the output.
 * Returns null if the command fails or throws.
 */
export function safeExec(command: string): string | null {
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

/**
 * Gets PIDs listening on a specific TCP port.
 */
export function getListeningPids(port: number): number[] {
  if (platform() === 'win32') return [];
  const output = safeExec(`lsof -nP -iTCP:${port} -sTCP:LISTEN -t`);
  if (!output) return [];

  return output
    .split('\n')
    .map((value) => Number.parseInt(value.trim(), 10))
    .filter((value) => Number.isFinite(value));
}

/**
 * Checks if a process with the given PID is currently running.
 */
export function isProcessAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

/**
 * Gets the start time of a process in milliseconds since epoch.
 */
export function getProcessStartTime(pid: number): number | null {
  // -o lstart gives "Wed Feb  5 14:00:00 2025"
  const output = safeExec(`ps -p ${pid} -o lstart=`);
  if (!output) return null;
  return Date.parse(output);
}

/**
 * Gets the command line string for a process.
 */
export function getProcessCommand(pid: number): string | null {
  const output = safeExec(`ps -p ${pid} -o command=`);
  return output && output.length > 0 ? output : null;
}

/**
 * Gets the immediate child PIDs of a process.
 */
export function getProcessChildren(pid: number): number[] {
  if (platform() === 'win32') return [];
  
  // Try pgrep -P first (MacOS/Linux)
  const output = safeExec(`pgrep -P ${pid}`);
  if (!output) return [];

  return output
    .split('\n')
    .map((value) => Number.parseInt(value.trim(), 10))
    .filter((value) => Number.isFinite(value));
}

/**
 * Safely sends a signal to a process.
 * Returns true if the signal was sent (or process is already dead), false on error.
 */
export function safeKill(pid: number, signal: NodeJS.Signals | number = 'SIGTERM'): boolean {
  try {
    process.kill(pid, signal);
    return true;
  } catch (err: any) {
    // If error is ESRCH (No such process), consider it a success (already dead)
    if (err.code === 'ESRCH') return true;
    return false;
  }
}

/**
 * Waits for a process to exit within a given timeout.
 * Returns true if process exited, false if timeout reached.
 */
export async function waitForProcessExit(pid: number, timeoutMs: number = 2000): Promise<boolean> {
  const start = Date.now();
  
  while (Date.now() - start < timeoutMs) {
    if (!isProcessAlive(pid)) return true;
    await new Promise(resolve => setTimeout(resolve, 100));
  }
  
  return !isProcessAlive(pid);
}

/**
 * Finds PIDs of processes matching a pattern (using pgrep -f).
 */
export function findProcessIds(pattern: string): number[] {
  if (platform() === 'win32') return [];
  
  // Use pgrep -f to match full command line
  // We sanitize the pattern to avoid command injection, though pgrep treats it as regex
  const output = safeExec(`pgrep -f "${pattern}"`);
  if (!output) return [];

  return output
    .split('\n')
    .map((value) => Number.parseInt(value.trim(), 10))
    .filter((value) => Number.isFinite(value));
}
