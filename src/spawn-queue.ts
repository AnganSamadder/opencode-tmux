import { log } from './utils/logger';

export interface SpawnResult {
  success: boolean;
  paneId?: string;
}

export interface SpawnRequest {
  sessionId: string;
  title: string;
  timestamp: number;
  retryCount: number;
}

export type SpawnFn = (request: SpawnRequest) => Promise<SpawnResult>;

export interface SpawnQueueOptions {
  spawnFn: SpawnFn;
  spawnDelayMs?: number;
  maxRetries?: number;
  staleThresholdMs?: number;
  onQueueUpdate?: (pendingCount: number) => void;
  onQueueDrained?: () => void;
  /** Optional logger override for testing */
  logFn?: (message: string, data?: unknown) => void;
}

interface QueueItem {
  sessionId: string;
  title: string;
  enqueuedAt: number;
  resolve: (result: SpawnResult) => void;
}

const BASE_BACKOFF_MS = 250;
const DEFAULT_STALE_THRESHOLD_MS = 30_000;

export class SpawnQueue {
  private readonly queue: QueueItem[] = [];
  private readonly spawnFn: SpawnFn;
  private readonly spawnDelayMs: number;
  private readonly maxRetries: number;
  private readonly staleThresholdMs: number;
  private readonly onQueueUpdate?: (pendingCount: number) => void;
  private readonly onQueueDrained?: () => void;
  private readonly logFn: (message: string, data?: unknown) => void;
  private isProcessing = false;
  private hasItemInFlight = false;
  private isShutdown = false;

  /**
   * Map from sessionId to a pending promise for coalescing duplicate enqueues.
   * Contains both queued and in-flight items.
   */
  private readonly pendingPromises = new Map<
    string,
    { promise: Promise<SpawnResult>; resolve: (result: SpawnResult) => void }
  >();

  constructor(options: SpawnQueueOptions) {
    this.spawnFn = options.spawnFn;
    this.spawnDelayMs = options.spawnDelayMs ?? 300;
    this.maxRetries = options.maxRetries ?? 2;
    this.staleThresholdMs = options.staleThresholdMs ?? DEFAULT_STALE_THRESHOLD_MS;
    this.onQueueUpdate = options.onQueueUpdate;
    this.onQueueDrained = options.onQueueDrained;
    this.logFn = options.logFn ?? log;

    this.logFn('[spawn-queue] initialized', {
      spawnDelayMs: this.spawnDelayMs,
      maxRetries: this.maxRetries,
      staleThresholdMs: this.staleThresholdMs,
    });
  }

  enqueue(item: { sessionId: string; title: string }): Promise<SpawnResult> {
    // If shutdown, reject immediately
    if (this.isShutdown) {
      this.logFn('[spawn-queue] enqueue rejected (shutdown)', { sessionId: item.sessionId });
      return Promise.resolve({ success: false });
    }

    const existing = this.pendingPromises.get(item.sessionId);
    if (existing) {
      this.logFn('[spawn-queue] duplicate enqueue coalesced', {
        sessionId: item.sessionId,
        queueDepth: this.queue.length,
        pendingCount: this.getPendingCount(),
      });
      return existing.promise;
    }

    let resolveOuter!: (result: SpawnResult) => void;
    const promise = new Promise<SpawnResult>((resolve) => {
      resolveOuter = resolve;
    });

    this.pendingPromises.set(item.sessionId, { promise, resolve: resolveOuter });

    this.queue.push({
      sessionId: item.sessionId,
      title: item.title,
      enqueuedAt: Date.now(),
      resolve: resolveOuter,
    });

    this.logFn('[spawn-queue] enqueued', {
      sessionId: item.sessionId,
      queueDepth: this.queue.length,
      pendingCount: this.getPendingCount(),
    });

    this.notifyQueueUpdate();
    this.processQueue();

    return promise;
  }

  getPendingCount(): number {
    return this.queue.length + (this.hasItemInFlight ? 1 : 0);
  }

  /**
   * Shutdown the queue: stop processing new items and resolve all pending items as failed.
   */
  shutdown(): void {
    if (this.isShutdown) {
      return;
    }
    this.isShutdown = true;

    this.logFn('[spawn-queue] shutdown initiated', {
      queuedItems: this.queue.length,
      hasInFlight: this.hasItemInFlight,
    });

    while (this.queue.length > 0) {
      const item = this.queue.shift()!;
      this.logFn('[spawn-queue] shutdown - resolving queued item as failed', {
        sessionId: item.sessionId,
      });
      item.resolve({ success: false });
      this.pendingPromises.delete(item.sessionId);
    }

    this.notifyQueueUpdate();
    this.logFn('[spawn-queue] shutdown complete');
  }

  /**
   * Alias for shutdown() for interface consistency.
   */
  dispose(): void {
    this.shutdown();
  }

  private notifyQueueUpdate(): void {
    this.onQueueUpdate?.(this.queue.length);
  }

  private async processQueue(): Promise<void> {
    if (this.isProcessing || this.isShutdown) {
      return;
    }

    this.isProcessing = true;

    while (this.queue.length > 0 && !this.isShutdown) {
      const item = this.queue.shift()!;
      this.hasItemInFlight = true;
      this.notifyQueueUpdate();

      const waitTimeMs = Date.now() - item.enqueuedAt;
      if (waitTimeMs > this.staleThresholdMs) {
        this.logFn('[spawn-queue] stale item skipped', {
          sessionId: item.sessionId,
          waitTimeMs,
          thresholdMs: this.staleThresholdMs,
        });
        item.resolve({ success: false });
        this.pendingPromises.delete(item.sessionId);
        this.hasItemInFlight = false;
        continue;
      }

      this.logFn('[spawn-queue] processing start', {
        sessionId: item.sessionId,
        title: item.title,
      });

      const result = await this.processItem(item);
      item.resolve(result);
      this.pendingPromises.delete(item.sessionId);
      this.hasItemInFlight = false;

      if (this.queue.length > 0 && !this.isShutdown) {
        await this.delay(this.spawnDelayMs);
      }
    }

    this.notifyQueueUpdate();
    this.notifyQueueDrained();
    this.isProcessing = false;
  }

  private notifyQueueDrained(): void {
    if (this.queue.length === 0 && !this.hasItemInFlight) {
      this.logFn('[spawn-queue] queue drained');
      this.onQueueDrained?.();
    }
  }

  private async processItem(item: QueueItem): Promise<SpawnResult> {
    let retryCount = 0;
    let lastResult: SpawnResult = { success: false };

    while (retryCount <= this.maxRetries && !this.isShutdown) {
      const request: SpawnRequest = {
        sessionId: item.sessionId,
        title: item.title,
        timestamp: item.enqueuedAt,
        retryCount,
      };

      this.logFn('[spawn-queue] spawn attempt', {
        sessionId: item.sessionId,
        attempt: retryCount + 1,
        maxAttempts: this.maxRetries + 1,
      });

      try {
        lastResult = await this.spawnFn(request);
      } catch {
        lastResult = { success: false };
      }

      if (lastResult.success) {
        this.logFn('[spawn-queue] success', {
          sessionId: item.sessionId,
          paneId: lastResult.paneId,
          attempts: retryCount + 1,
        });
        return lastResult;
      }

      retryCount++;
      if (retryCount <= this.maxRetries && !this.isShutdown) {
        const backoffMs = BASE_BACKOFF_MS * Math.pow(2, retryCount - 1);
        this.logFn('[spawn-queue] retry wait', {
          sessionId: item.sessionId,
          backoffMs,
          nextAttempt: retryCount + 1,
        });
        await this.delay(backoffMs);
      }
    }

    this.logFn('[spawn-queue] final failure', {
      sessionId: item.sessionId,
      attempts: retryCount,
    });

    return lastResult;
  }

  private delay(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
}
