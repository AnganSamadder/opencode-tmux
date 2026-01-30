import { spawn, spawnSync, execSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import type { TmuxConfig, TmuxLayout } from '../config';
import { log } from './logger';

let tmuxPath: string | null = null;
let tmuxChecked = false;

let storedConfig: TmuxConfig | null = null;

let serverAvailable: boolean | null = null;
let serverCheckUrl: string | null = null;

interface SpawnResult {
  exitCode: number;
  stdout: string;
  stderr: string;
}

export async function spawnAsync(
  command: string[],
  options?: { ignoreOutput?: boolean; env?: NodeJS.ProcessEnv },
): Promise<SpawnResult> {
  return new Promise((resolve) => {
    const [cmd, ...args] = command;
    const proc = spawn(cmd, args, {
      stdio: 'pipe',
      env: options?.env ?? process.env,
    });

    let stdout = '';
    let stderr = '';

    if (!options?.ignoreOutput) {
      proc.stdout?.on('data', (data: Buffer) => {
        stdout += data.toString();
      });
      proc.stderr?.on('data', (data: Buffer) => {
        stderr += data.toString();
      });
    }

    proc.on('close', (code) => {
      resolve({
        exitCode: code ?? 1,
        stdout,
        stderr,
      });
    });

    proc.on('error', () => {
      resolve({
        exitCode: 1,
        stdout,
        stderr,
      });
    });
  });
}

async function isServerRunning(serverUrl: string): Promise<boolean> {
  if (serverCheckUrl === serverUrl && serverAvailable === true) {
    return true;
  }

  const healthUrl = new URL('/health', serverUrl).toString();
  const timeoutMs = 3000;
  const maxAttempts = 2;

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), timeoutMs);

    let response: Response | null = null;
    try {
      response = await fetch(healthUrl, { signal: controller.signal }).catch(
        () => null,
      );
    } finally {
      clearTimeout(timeout);
    }

    const available = response?.ok ?? false;
    if (available) {
      serverCheckUrl = serverUrl;
      serverAvailable = true;
      log('[tmux] isServerRunning: checked', { serverUrl, available, attempt });
      return true;
    }

    if (attempt < maxAttempts) {
      await new Promise((r) => setTimeout(r, 250));
    }
  }

  log('[tmux] isServerRunning: checked', { serverUrl, available: false });
  return false;
}

export function resetServerCheck(): void {
  serverAvailable = null;
  serverCheckUrl = null;
}

async function findTmuxPath(): Promise<string | null> {
  const isWindows = process.platform === 'win32';
  const cmd = isWindows ? 'where' : 'which';

  try {
    const result = await spawnAsync([cmd, 'tmux']);

    if (result.exitCode !== 0) {
      log("[tmux] findTmuxPath: 'which tmux' failed", {
        exitCode: result.exitCode,
      });
      return null;
    }

    const path = result.stdout.trim().split('\n')[0];
    if (!path) {
      log('[tmux] findTmuxPath: no path in output');
      return null;
    }

    const verifyResult = await spawnAsync([path, '-V']);
    if (verifyResult.exitCode !== 0) {
      log('[tmux] findTmuxPath: tmux -V failed', {
        path,
        verifyExit: verifyResult.exitCode,
      });
      return null;
    }

    log('[tmux] findTmuxPath: found tmux', { path });
    return path;
  } catch (err) {
    log('[tmux] findTmuxPath: exception', { error: String(err) });
    return null;
  }
}

export async function getTmuxPath(): Promise<string | null> {
  if (tmuxChecked) {
    return tmuxPath;
  }

  tmuxPath = await findTmuxPath();
  tmuxChecked = true;
  log('[tmux] getTmuxPath: initialized', { tmuxPath });
  return tmuxPath;
}

export function isInsideTmux(): boolean {
  return !!process.env.TMUX;
}

async function applyLayout(
  tmux: string,
  layout: TmuxLayout | string,
  mainPaneSize: number,
): Promise<void> {
  try {
    // If it's a dynamic layout placeholder, we can't apply it directly via tmux select-layout
    // (unless it's a raw string starting with checksum)
    if (layout === 'dynamic-vertical') {
       return; 
    }

    await spawnAsync([tmux, 'select-layout', layout]);

    if (layout === 'main-horizontal' || layout === 'main-vertical') {
      const sizeOption =
        layout === 'main-horizontal' ? 'main-pane-height' : 'main-pane-width';

      await spawnAsync([
        tmux,
        'set-window-option',
        sizeOption,
        `${mainPaneSize}%`,
      ]);
      await spawnAsync([tmux, 'select-layout', layout]);
    }

    log('[tmux] applyLayout: applied', { layout, mainPaneSize });
  } catch (err) {
    log('[tmux] applyLayout: exception', { error: String(err) });
  }
}

export interface SpawnPaneResult {
  success: boolean;
  paneId?: string;
}

export async function spawnTmuxPane(
  sessionId: string,
  description: string,
  config: TmuxConfig,
  serverUrl: string,
): Promise<SpawnPaneResult> {
  log('[tmux] spawnTmuxPane called', {
    sessionId,
    description,
    config,
    serverUrl,
  });

  if (!config.enabled) {
    log('[tmux] spawnTmuxPane: config.enabled is false, skipping');
    return { success: false };
  }

  if (!isInsideTmux()) {
    log('[tmux] spawnTmuxPane: not inside tmux, skipping');
    return { success: false };
  }

  const serverRunning = await isServerRunning(serverUrl);
  if (!serverRunning) {
    const defaultPort = process.env.OPENCODE_PORT ?? '4096';
    log('[tmux] spawnTmuxPane: OpenCode server not running, skipping', {
      serverUrl,
      hint: `Start opencode with --port ${defaultPort}`,
    });
    return { success: false };
  }

  const tmux = await getTmuxPath();
  if (!tmux) {
    log('[tmux] spawnTmuxPane: tmux binary not found, skipping');
    return { success: false };
  }

  storedConfig = config;

  try {
    const opencodeCmd = `opencode attach ${serverUrl} --session ${sessionId}`;

    const args = [
      'split-window',
      '-h',
      '-d',
      '-P',
      '-F',
      '#{pane_id}',
      opencodeCmd,
    ];

    const env = {
      ...process.env,
      OPENCODE_HIDE_SUBAGENT_HEADER: '1',
    };

    log('[tmux] spawnTmuxPane: executing', { tmux, args, opencodeCmd, env });

    const result = await spawnAsync([tmux, ...args], { env });
    const paneId = result.stdout.trim();

    log('[tmux] spawnTmuxPane: split result', {
      exitCode: result.exitCode,
      paneId,
      stderr: result.stderr.trim(),
    });

    if (result.exitCode === 0 && paneId) {
      await spawnAsync(
        [tmux, 'select-pane', '-t', paneId, '-T', description.slice(0, 30)],
        { ignoreOutput: true },
      );

      const layout = config.layout ?? 'main-vertical';
      const mainPaneSize = config.main_pane_size ?? 60;
      await applyLayout(tmux, layout, mainPaneSize);

      log('[tmux] spawnTmuxPane: SUCCESS, pane created and layout applied', {
        paneId,
        layout,
      });
      return { success: true, paneId };
    }

    return { success: false };
  } catch (err) {
    log('[tmux] spawnTmuxPane: exception', { error: String(err) });
    return { success: false };
  }
}

export async function closeTmuxPane(paneId: string): Promise<boolean> {
  log('[tmux] closeTmuxPane called', { paneId });

  if (!paneId) {
    log('[tmux] closeTmuxPane: no paneId provided');
    return false;
  }

  const tmux = await getTmuxPath();
  if (!tmux) {
    log('[tmux] closeTmuxPane: tmux binary not found');
    return false;
  }

  try {
    const result = await spawnAsync([tmux, 'kill-pane', '-t', paneId]);

    log('[tmux] closeTmuxPane: result', {
      exitCode: result.exitCode,
      stderr: result.stderr.trim(),
    });

    if (result.exitCode === 0) {
      log('[tmux] closeTmuxPane: SUCCESS, pane closed', { paneId });

      if (storedConfig) {
        const layout = storedConfig.layout ?? 'main-vertical';
        const mainPaneSize = storedConfig.main_pane_size ?? 60;
        await applyLayout(tmux, layout, mainPaneSize);
        log('[tmux] closeTmuxPane: layout reapplied', { layout });
      }

      return true;
    }

    log('[tmux] closeTmuxPane: failed (pane may already be closed)', {
      paneId,
    });
    return false;
  } catch (err) {
    log('[tmux] closeTmuxPane: exception', { error: String(err) });
    return false;
  }
}

export function killTmuxSessionSync(): boolean {
  let tmux = tmuxPath;
  log('[tmux] killTmuxSessionSync starting', { tmuxPath: tmux });

  if (!tmux) {
    try {
      tmux = execSync('which tmux', { encoding: 'utf-8' }).trim();
      log('[tmux] killTmuxSessionSync resolved via which', { tmux });
    } catch {
      tmux = '/usr/local/bin/tmux';
      if (!existsSync(tmux)) {
        tmux = '/opt/homebrew/bin/tmux';
      }
      log('[tmux] killTmuxSessionSync using fallback', { tmux });
    }
  }

  try {
    let sessionName = '';
    try {
      sessionName = execSync(`${tmux} display-message -p '#S'`, { encoding: 'utf-8' }).trim();
      log('[tmux] killTmuxSessionSync target session identified', { sessionName });
    } catch {
      log('[tmux] killTmuxSessionSync could not identify session name, using default');
    }

    log('[tmux] killTmuxSessionSync executing kill-session', { tmux, sessionName });
    const args = sessionName ? ['kill-session', '-t', sessionName] : ['kill-session'];
    const result = spawnSync(tmux, args);
    
    log('[tmux] killTmuxSessionSync result', {
      status: result.status,
      error: result.error?.message,
      stderr: result.stderr?.toString().trim()
    });
    return result.status === 0;
  } catch (err) {
    log('[tmux] killTmuxSessionSync exception', { error: String(err) });
    return false;
  }
}

export async function killTmuxSession(): Promise<boolean> {
  const tmux = await getTmuxPath();
  if (!tmux) {
    log('[tmux] killTmuxSession: tmux binary not found');
    return false;
  }

  try {
    log('[tmux] killTmuxSession: killing current session');
    // Use spawnSync to ensure it's executed before the process can be killed
    const result = spawnSync(tmux, ['kill-session']);

    log('[tmux] killTmuxSession: result', {
      status: result.status,
      stderr: result.stderr?.toString().trim(),
    });
    return result.status === 0;
  } catch (err) {
    log('[tmux] killTmuxSession: exception', { error: String(err) });
    return false;
  }
}

export function startTmuxCheck(): void {
  if (!tmuxChecked) {
    getTmuxPath().catch(() => {});
  }
}
