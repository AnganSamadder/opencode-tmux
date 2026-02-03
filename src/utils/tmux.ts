import { spawn } from 'node:child_process';
import type { TmuxConfig, TmuxLayout } from '../config';
import {
  buildMainVerticalMultiColumnLayoutString,
  groupAgentsByColumn,
  mainPanePercentForColumns,
} from '../layout';
import { log } from './logger';

const BASE_BACKOFF_MS = 250;

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

async function spawnAsync(
  command: string[],
  options?: { ignoreOutput?: boolean },
): Promise<SpawnResult> {
  return new Promise((resolve) => {
    const [cmd, ...args] = command;
    const proc = spawn(cmd, args, { stdio: 'pipe' });

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

export function resetTmuxPathCache(): void {
  tmuxPath = null;
  tmuxChecked = false;
}

async function findTmuxPath(): Promise<string | null> {
  const isWindows = process.platform === 'win32';
  const cmd = isWindows ? 'where' : 'which';

  try {
    const result = await spawnAsyncFn([cmd, 'tmux']);

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

    const verifyResult = await spawnAsyncFn([path, '-V']);
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
  layout: TmuxLayout,
  mainPaneSize: number,
): Promise<void> {
  try {
    await spawnAsyncFn([tmux, 'select-layout', layout]);

    if (layout === 'main-horizontal' || layout === 'main-vertical') {
      const sizeOption =
        layout === 'main-horizontal' ? 'main-pane-height' : 'main-pane-width';

      await spawnAsyncFn([
        tmux,
        'set-window-option',
        sizeOption,
        `${mainPaneSize}%`,
      ]);
      await spawnAsyncFn([tmux, 'select-layout', layout]);
    }

    log('[tmux] applyLayout: applied', { layout, mainPaneSize });
  } catch (err) {
    log('[tmux] applyLayout: exception', { error: String(err) });
  }
}

async function getCurrentPaneId(tmux: string): Promise<string | null> {
  const result = await spawnAsyncFn([tmux, 'display-message', '-p', '#{pane_id}']);
  const paneId = result.stdout.trim();
  return paneId ? paneId : null;
}

async function getWindowSize(
  tmux: string,
): Promise<{ width: number; height: number } | null> {
  const result = await spawnAsyncFn([
    tmux,
    'display-message',
    '-p',
    '#{window_width} #{window_height}',
  ]);
  const parts = result.stdout.trim().split(/\s+/);
  if (parts.length < 2) return null;
  const width = Number(parts[0]);
  const height = Number(parts[1]);
  if (!Number.isFinite(width) || !Number.isFinite(height)) return null;
  return { width, height };
}

async function listPaneIds(tmux: string): Promise<string[]> {
  const result = await spawnAsyncFn([tmux, 'list-panes', '-F', '#{pane_id}']);
  return result.stdout
    .split('\n')
    .map((l) => l.trim())
    .filter(Boolean);
}

function paneWpId(paneId: string): number | null {
  if (!paneId.startsWith('%')) return null;
  const n = Number(paneId.slice(1));
  return Number.isFinite(n) ? n : null;
}

async function tryApplyMainVerticalMultiColumnLayout(
  tmux: string,
  maxAgentsPerColumn: number,
): Promise<boolean> {
  const size = await getWindowSize(tmux);
  if (!size) return false;

  const currentPaneId = await getCurrentPaneId(tmux);
  if (!currentPaneId) return false;

  const panesBefore = await listPaneIds(tmux);
  if (panesBefore.length < 2) return false;

  if (panesBefore[0] && panesBefore[0] !== currentPaneId) {
    await spawnAsyncFn([tmux, 'swap-pane', '-s', currentPaneId, '-t', panesBefore[0]]);
  }

  const panes = await listPaneIds(tmux);
  if (panes.length < 2) return false;

  const mainPaneId = panes[0] ?? currentPaneId;
  const agentPaneIds = panes.slice(1);
  const columns = groupAgentsByColumn(agentPaneIds, maxAgentsPerColumn);
  if (columns.length <= 1) {
    return false;
  }

  const mainPanePercent = mainPanePercentForColumns(columns.length);
  const mainWp = paneWpId(mainPaneId);
  if (mainWp === null) return false;

  const wpColumns: number[][] = [];
  for (const col of columns) {
    const wpIds: number[] = [];
    for (const paneId of col) {
      const wpId = paneWpId(paneId);
      if (wpId !== null) {
        wpIds.push(wpId);
      }
    }
    if (wpIds.length > 0) {
      wpColumns.push(wpIds);
    }
  }
  if (wpColumns.length <= 1) return false;

  const layoutString = buildMainVerticalMultiColumnLayoutString({
    windowWidth: size.width,
    windowHeight: size.height,
    mainPaneWpId: mainWp,
    columns: wpColumns,
    mainPanePercent,
  });

  const result = await spawnAsyncFn([tmux, 'select-layout', layoutString]);
  if (result.exitCode === 0) {
    log('[tmux] applyTmuxLayout: applied multi-column layout', {
      columns: wpColumns.length,
      mainPanePercent,
    });
    return true;
  }

  log('[tmux] applyTmuxLayout: multi-column layout failed', {
    exitCode: result.exitCode,
    stderr: result.stderr.trim(),
  });
  return false;
}

/**
 * Applies tmux layout using the stored config.
 * Exported for deferred layout after spawn queue drains.
 * Falls back to tmux built-in layout on failure.
 */
export async function applyTmuxLayout(): Promise<void> {
  if (!storedConfig) {
    log('[tmux] applyTmuxLayout: no stored config, skipping');
    return;
  }

  const tmux = await getTmuxPath();
  if (!tmux) {
    log('[tmux] applyTmuxLayout: tmux binary not found');
    return;
  }

  const layout = storedConfig.layout ?? 'main-vertical';
  const maxAgentsPerColumn = storedConfig.max_agents_per_column ?? 3;
  const mainPaneSize =
    layout === 'main-vertical' ? mainPanePercentForColumns(1) : (storedConfig.main_pane_size ?? 60);

  try {
    if (layout === 'main-vertical') {
      const applied = await tryApplyMainVerticalMultiColumnLayout(
        tmux,
        maxAgentsPerColumn,
      );
      if (applied) {
        return;
      }
    }
    await applyLayout(tmux, layout, mainPaneSize);
  } catch (err) {
    log('[tmux] applyTmuxLayout: failed, falling back to built-in layout', {
      error: String(err),
    });
    try {
      await spawnAsyncFn([tmux, 'select-layout', layout === 'tiled' ? 'tiled' : 'main-vertical']);
    } catch (fallbackErr) {
      log('[tmux] applyTmuxLayout: fallback also failed', { error: String(fallbackErr) });
    }
  }
}

export interface SpawnPaneResult {
  success: boolean;
  paneId?: string;
}

// For testing: allows mocking spawnAsync
export let spawnAsyncFn: typeof spawnAsync = spawnAsync;

export function setSpawnAsyncFn(fn: typeof spawnAsync): void {
  spawnAsyncFn = fn;
}

export function resetSpawnAsyncFn(): void {
  spawnAsyncFn = spawnAsync;
}

async function attemptSpawnPane(
  sessionId: string,
  description: string,
  config: TmuxConfig,
  tmux: string,
  serverUrl: string,
): Promise<SpawnPaneResult> {
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

  log('[tmux] attemptSpawnPane: executing', { tmux, args, opencodeCmd });

  const result = await spawnAsyncFn([tmux, ...args]);
  const paneId = result.stdout.trim();

  log('[tmux] attemptSpawnPane: split result', {
    exitCode: result.exitCode,
    paneId,
    stderr: result.stderr.trim(),
  });

  if (result.exitCode === 0 && paneId) {
    await spawnAsyncFn(
      [tmux, 'select-pane', '-t', paneId, '-T', description.slice(0, 30)],
      { ignoreOutput: true },
    );

    log('[tmux] attemptSpawnPane: SUCCESS, pane created', {
      paneId,
    });
    return { success: true, paneId };
  }

  return { success: false };
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

  const maxRetries = config.max_retry_attempts ?? 2;
  let attempt = 0;
  let lastResult: SpawnPaneResult = { success: false };

  while (attempt <= maxRetries) {
    try {
      lastResult = await attemptSpawnPane(sessionId, description, config, tmux, serverUrl);

      if (lastResult.success) {
        return lastResult;
      }

      log('[tmux] spawnTmuxPane: attempt failed', {
        attempt: attempt + 1,
        maxRetries,
      });
    } catch (err) {
      log('[tmux] spawnTmuxPane: exception on attempt', {
        attempt: attempt + 1,
        error: String(err),
      });
      lastResult = { success: false };
    }

    attempt++;
    if (attempt <= maxRetries) {
      const backoffMs = BASE_BACKOFF_MS * Math.pow(2, attempt - 1);
      log('[tmux] spawnTmuxPane: waiting before retry', { backoffMs, attempt });
      await new Promise((resolve) => setTimeout(resolve, backoffMs));
    }
  }

  log('[tmux] spawnTmuxPane: all retries exhausted', { attempts: attempt });
  return lastResult;
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

      await applyTmuxLayout();

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

export function startTmuxCheck(): void {
  if (!tmuxChecked) {
    getTmuxPath().catch(() => {});
  }
}
