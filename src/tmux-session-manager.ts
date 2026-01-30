import type { PluginInput } from './types';
import {
  POLL_INTERVAL_MS,
  SESSION_MISSING_GRACE_MS,
  SESSION_TIMEOUT_MS,
  type TmuxConfig,
} from './config';
import {
  closeTmuxPane,
  getTmuxPath,
  isInsideTmux,
  killTmuxSession,
  killTmuxSessionSync,
  log,
  spawnTmuxPane,
  type SpawnPaneResult,
} from './utils';
import { generateLayoutString } from './utils/layout';

type OpencodeClient = PluginInput['client'];

interface TrackedSession {
  sessionId: string;
  paneId: string;
  parentId: string;
  title: string;
  createdAt: number;
  lastSeenAt: number;
  missingSince?: number;
}

interface SessionCreatedEvent {
  type: string;
  properties?: { info?: { id?: string; parentID?: string; title?: string } };
}

export class TmuxSessionManager {
  private client: OpencodeClient;
  private tmuxConfig: TmuxConfig;
  private serverUrl: string;
  private sessions = new Map<string, TrackedSession>();
  private pollInterval?: ReturnType<typeof setInterval>;
  private enabled = false;
  private shuttingDown = false;
  private mainPaneId: string | null = null;
  private readyPromise: Promise<void> | null = null;

  constructor(ctx: PluginInput, tmuxConfig: TmuxConfig, serverUrl: string) {
    this.client = ctx.client;
    this.tmuxConfig = tmuxConfig;
    this.serverUrl = serverUrl;
    this.enabled = tmuxConfig.enabled && isInsideTmux();

    log('[tmux-session-manager] initialized', {
      enabled: this.enabled,
      tmuxConfig: this.tmuxConfig,
      serverUrl: this.serverUrl,
    });

    if (this.enabled) {
      this.readyPromise = this.initMainPaneId();
      this.registerShutdownHandlers();
    }
  }

  private async initMainPaneId() {
    try {
      const tmux = await getTmuxPath();
      if (!tmux) return;
      
      const { execSync } = await import('node:child_process');
      // We are inside tmux, so we can just ask for the current pane id?
      // But the plugin runs in the background. Does it share the pane?
      // Usually the plugin runs in the "main" pane where opencode started.
      // Let's assume the pane where this process is running is the main pane.
      // But wait, opencode might be running in a background process?
      // If opencode started in a pane, TMUX env var is set.
      // We want the pane ID of the pane where opencode is running.
      
      // Attempt to get pane ID from tmux
      const result = execSync(`${tmux} display-message -p "#{pane_id}"`, { encoding: 'utf-8' }).trim();
      if (result.startsWith('%')) {
        this.mainPaneId = result;
        log('[tmux-session-manager] identified main pane', { mainPaneId: this.mainPaneId });
      }
    } catch (err) {
      log('[tmux-session-manager] failed to identify main pane', { error: String(err) });
    }
  }

  async onSessionCreated(event: SessionCreatedEvent): Promise<void> {
    if (this.readyPromise) {
      await this.readyPromise;
    }
    if (!this.enabled) return;
    if (event.type !== 'session.created') return;

    const info = event.properties?.info;
    if (!info?.id || !info?.parentID) {
      return;
    }

    const sessionId = info.id;
    const parentId = info.parentID;
    const title = info.title ?? 'Subagent';

    if (this.sessions.has(sessionId)) {
      log('[tmux-session-manager] session already tracked', { sessionId });
      return;
    }

    log('[tmux-session-manager] child session created, spawning pane', {
      sessionId,
      parentId,
      title,
    });

    const paneResult = await spawnTmuxPane(
      sessionId,
      title,
      this.tmuxConfig,
      this.serverUrl,
    ).catch((err) => {
      log('[tmux-session-manager] failed to spawn pane', {
        error: String(err),
      });
      return { success: false, paneId: undefined };
    });

    if (paneResult.success && paneResult.paneId) {
      const now = Date.now();
      this.sessions.set(sessionId, {
        sessionId,
        paneId: paneResult.paneId,
        parentId,
        title,
        createdAt: now,
        lastSeenAt: now,
      });

      log('[tmux-session-manager] pane spawned', {
        sessionId,
        paneId: paneResult.paneId,
      });

      this.startPolling();
      void this.recalculateLayout();
    }
  }

  private async recalculateLayout(): Promise<void> {
    if (this.tmuxConfig.layout !== 'dynamic-vertical') return;
    if (!this.mainPaneId) return;

    const tmux = await getTmuxPath();
    if (!tmux) return;

    try {
      // Get window dimensions
      const { execSync } = await import('node:child_process');
      const dims = execSync(`${tmux} display-message -p "#{window_width},#{window_height}"`, { encoding: 'utf-8' }).trim().split(',');
      const width = parseInt(dims[0], 10);
      const height = parseInt(dims[1], 10);

      if (isNaN(width) || isNaN(height)) return;

      // Collect subagent pane IDs (sorted by creation time for stability)
      const paneIds = Array.from(this.sessions.values())
        .sort((a, b) => a.createdAt - b.createdAt)
        .map(s => s.paneId)
        .filter(id => id !== this.mainPaneId);

      const layoutString = generateLayoutString({
        width,
        height,
        mainPaneSizePercent: this.tmuxConfig.main_pane_size ?? 60,
        paneIds,
        mainPaneId: this.mainPaneId,
        maxAgentsPerColumn: this.tmuxConfig.max_agents_per_column ?? 3,
      });

      if (layoutString) {
        const { spawnAsync } = await import('./utils/tmux'); 
        // Note: we need to export applyLayout or just use spawnAsync directly. 
        // Since applyLayout is not exported in the original file (I need to check), 
        // I'll check if it is exported. If not, I'll use spawnAsync.
        // Looking at my previous read of utils/index.ts, applyLayout IS NOT exported.
        // But I modified utils/tmux.ts to change applyLayout signature. 
        // I should have exported it.
        // Let's assume for now I will use spawnAsync directly here or modify utils/index.ts to export it.
        
        await spawnAsync([tmux, 'select-layout', layoutString]);
        log('[tmux-session-manager] applied dynamic layout', { layoutString });
      }
    } catch (err) {
      log('[tmux-session-manager] failed to recalculate layout', { error: String(err) });
    }
  }

  private startPolling(): void {
    if (this.pollInterval) return;

    this.pollInterval = setInterval(
      () => this.pollSessions(),
      POLL_INTERVAL_MS,
    );
    log('[tmux-session-manager] polling started');
  }

  private stopPolling(): void {
    if (this.pollInterval) {
      clearInterval(this.pollInterval);
      this.pollInterval = undefined;
      log('[tmux-session-manager] polling stopped');
    }
  }

  private async pollSessions(): Promise<void> {
    if (this.sessions.size === 0) {
      this.stopPolling();
      return;
    }

    try {
      const statusResult = await this.client.session.status();
      const allStatuses = (statusResult.data ?? {}) as Record<
        string,
        { type: string }
      >;

      const now = Date.now();
      const sessionsToClose: string[] = [];

      for (const [sessionId, tracked] of this.sessions.entries()) {
        const status = allStatuses[sessionId];

        const isIdle = status?.type === 'idle';

        if (status) {
          tracked.lastSeenAt = now;
          tracked.missingSince = undefined;
        } else if (!tracked.missingSince) {
          tracked.missingSince = now;
        }

        const missingTooLong =
          !!tracked.missingSince &&
          now - tracked.missingSince >= SESSION_MISSING_GRACE_MS;

        const isTimedOut = now - tracked.createdAt > SESSION_TIMEOUT_MS;

        if (isIdle || missingTooLong || isTimedOut) {
          sessionsToClose.push(sessionId);
        }
      }

      for (const sessionId of sessionsToClose) {
        await this.closeSession(sessionId);
      }
    } catch (err) {
      log('[tmux-session-manager] poll error', { error: String(err) });

      const serverAlive = await this.isServerAlive();
      if (!serverAlive) {
        await this.handleShutdown('server-unreachable');
      }
    }
  }

  private registerShutdownHandlers(): void {
    const handler = (reason: string) => {
      this.handleShutdown(reason);
    };

    // Use process.once for signals to avoid multiple triggers
    process.once('SIGINT', () => handler('SIGINT'));
    process.once('SIGTERM', () => handler('SIGTERM'));
    process.once('SIGHUP', () => handler('SIGHUP'));
    process.once('SIGQUIT', () => handler('SIGQUIT'));
    process.once('beforeExit', () => handler('beforeExit'));
  }

  private handleShutdown(reason: string): void {
    if (this.shuttingDown) return;
    this.shuttingDown = true;
    log('[tmux-session-manager] shutdown detected', { reason });

    // Only kill the entire tmux session on SIGINT (Ctrl+C).
    // SIGTERM is often used for graceful plugin reloads/stops,
    // so we shouldn't kill the whole session then.
    if (reason === 'SIGINT') {
      log('[tmux-session-manager] aggressive kill triggered (SIGINT)', { reason });
      const result = killTmuxSessionSync();
      log('[tmux-session-manager] killTmuxSessionSync result', { result });
      process.exit(0);
    }

    // For other reasons (SIGTERM, SIGHUP, etc.), just do a normal cleanup
    void this.cleanup().finally(() => {
      if (reason !== 'beforeExit') {
        process.exit(0);
      }
    });
  }

  private async isServerAlive(): Promise<boolean> {
    const healthUrl = new URL('/health', this.serverUrl).toString();
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 1500);

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

  private async closeSession(sessionId: string): Promise<void> {
    const tracked = this.sessions.get(sessionId);
    if (!tracked) return;

    log('[tmux-session-manager] closing session pane', {
      sessionId,
      paneId: tracked.paneId,
    });

    await closeTmuxPane(tracked.paneId);
    this.sessions.delete(sessionId);
    
    void this.recalculateLayout();

    if (this.sessions.size === 0) {
      this.stopPolling();
    }
  }

  createEventHandler(): (input: {
    event: { type: string; properties?: unknown };
  }) => Promise<void> {
    return async (input) => {
      await this.onSessionCreated(input.event as SessionCreatedEvent);
    };
  }

  async cleanup(): Promise<void> {
    this.stopPolling();

    if (this.sessions.size > 0) {
      log('[tmux-session-manager] closing all panes', {
        count: this.sessions.size,
      });
      const closePromises = Array.from(this.sessions.values()).map((s) =>
        closeTmuxPane(s.paneId).catch((err) =>
          log('[tmux-session-manager] cleanup error for pane', {
            paneId: s.paneId,
            error: String(err),
          }),
        ),
      );
      await Promise.all(closePromises);
      this.sessions.clear();
    }

    log('[tmux-session-manager] cleanup complete');
  }
}
