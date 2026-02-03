import type { PluginInput } from './types';
import {
  POLL_INTERVAL_MS,
  SESSION_MISSING_GRACE_MS,
  SESSION_TIMEOUT_MS,
  type TmuxConfig,
} from './config';
import { SpawnQueue, type SpawnRequest } from './spawn-queue';
import { closeTmuxPane, isInsideTmux, log, spawnTmuxPane, applyTmuxLayout } from './utils';

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
  private spawnQueue: SpawnQueue;
  private layoutDebounceTimer?: ReturnType<typeof setTimeout>;

  constructor(ctx: PluginInput, tmuxConfig: TmuxConfig, serverUrl: string) {
    this.client = ctx.client;
    this.tmuxConfig = tmuxConfig;
    this.serverUrl = serverUrl;
    this.enabled = tmuxConfig.enabled && isInsideTmux();

    this.spawnQueue = new SpawnQueue({
      spawnFn: (request: SpawnRequest) =>
        spawnTmuxPane(request.sessionId, request.title, this.tmuxConfig, this.serverUrl),
      spawnDelayMs: tmuxConfig.spawn_delay_ms,
      maxRetries: 0,
      onQueueUpdate: (pendingCount: number) => {
        log('[tmux-session-manager] queue update', { pendingCount });
      },
      onQueueDrained: () => {
        this.scheduleDebouncedLayout();
      },
    });

    log('[tmux-session-manager] initialized', {
      enabled: this.enabled,
      tmuxConfig: this.tmuxConfig,
      serverUrl: this.serverUrl,
    });

    if (this.enabled) {
      this.registerShutdownHandlers();
    }
  }

  async onSessionCreated(event: SessionCreatedEvent): Promise<void> {
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

    const paneResult = await this.spawnQueue.enqueue({ sessionId, title });

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
    } else {
      log('[tmux-session-manager] failed to spawn pane', { sessionId });
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

  private scheduleDebouncedLayout(): void {
    if (this.layoutDebounceTimer) {
      clearTimeout(this.layoutDebounceTimer);
    }

    const debounceMs = this.tmuxConfig.layout_debounce_ms ?? 150;
    this.layoutDebounceTimer = setTimeout(() => {
      log('[tmux-session-manager] applying deferred layout after queue drain');
      void applyTmuxLayout();
    }, debounceMs);
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
      void this.handleShutdown(reason);
    };

    process.once('SIGINT', () => handler('SIGINT'));
    process.once('SIGTERM', () => handler('SIGTERM'));
    process.once('SIGHUP', () => handler('SIGHUP'));
    process.once('SIGQUIT', () => handler('SIGQUIT'));
    process.once('beforeExit', () => handler('beforeExit'));
  }

  private async handleShutdown(reason: string): Promise<void> {
    if (this.shuttingDown) return;
    this.shuttingDown = true;
    log('[tmux-session-manager] shutdown detected', { reason });
    await this.cleanup();
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
    this.spawnQueue.shutdown();

    if (this.layoutDebounceTimer) {
      clearTimeout(this.layoutDebounceTimer);
      this.layoutDebounceTimer = undefined;
    }

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
