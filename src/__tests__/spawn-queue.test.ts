import { test, expect, beforeEach, mock } from 'bun:test';
import { SpawnQueue, type SpawnRequest, type SpawnResult } from '../spawn-queue';

// Helper to create controlled promises for test synchronization
function createControlledPromise<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

// Helper to wait for a condition with timeout
async function waitFor(
  conditionFn: () => boolean,
  timeoutMs = 1000,
): Promise<void> {
  const start = Date.now();
  while (!conditionFn()) {
    if (Date.now() - start > timeoutMs) {
      throw new Error('waitFor timed out');
    }
    await new Promise((r) => setTimeout(r, 10));
  }
}

test('SpawnQueue processes items sequentially', async () => {
  const executionOrder: string[] = [];
  const ctrl1 = createControlledPromise<SpawnResult>();
  const ctrl2 = createControlledPromise<SpawnResult>();

  let callCount = 0;
  const spawnFn = mock(async (req: SpawnRequest): Promise<SpawnResult> => {
    callCount++;
    executionOrder.push(`start:${req.sessionId}`);
    if (req.sessionId === 'session-1') {
      const result = await ctrl1.promise;
      executionOrder.push(`end:${req.sessionId}`);
      return result;
    }
    const result = await ctrl2.promise;
    executionOrder.push(`end:${req.sessionId}`);
    return result;
  });

  const queue = new SpawnQueue({ spawnFn, spawnDelayMs: 0 });

  queue.enqueue({ sessionId: 'session-1', title: 'Task 1' });
  queue.enqueue({ sessionId: 'session-2', title: 'Task 2' });

  // Wait for first item to start processing
  await waitFor(() => callCount === 1);

  // Second item should NOT have started yet
  expect(executionOrder).toEqual(['start:session-1']);

  // Complete first item
  ctrl1.resolve({ success: true, paneId: '%1' });
  await waitFor(() => callCount === 2);

  // Now second should be processing
  expect(executionOrder).toContain('end:session-1');
  expect(executionOrder).toContain('start:session-2');

  // Complete second
  ctrl2.resolve({ success: true, paneId: '%2' });
  await waitFor(() => queue.getPendingCount() === 0);

  expect(executionOrder).toEqual([
    'start:session-1',
    'end:session-1',
    'start:session-2',
    'end:session-2',
  ]);
});

test('SpawnQueue retries failures with exponential backoff', async () => {
  const attempts: number[] = [];
  const timestamps: number[] = [];

  const spawnFn = mock(async (_req: SpawnRequest): Promise<SpawnResult> => {
    attempts.push(attempts.length + 1);
    timestamps.push(Date.now());
    // Fail first 2 attempts, succeed on 3rd
    if (attempts.length < 3) {
      return { success: false };
    }
    return { success: true, paneId: '%1' };
  });

  const queue = new SpawnQueue({ spawnFn, spawnDelayMs: 0, maxRetries: 2 });

  queue.enqueue({ sessionId: 'retry-test', title: 'Retry Test' });
  await waitFor(() => queue.getPendingCount() === 0);

  // Should have attempted 1 + 2 retries = 3 total
  expect(attempts.length).toBe(3);

  // Verify exponential backoff timing (250ms, 500ms)
  const delay1 = timestamps[1] - timestamps[0];
  const delay2 = timestamps[2] - timestamps[1];

  // Allow 50ms tolerance for timing
  expect(delay1).toBeGreaterThanOrEqual(240);
  expect(delay1).toBeLessThan(350);
  expect(delay2).toBeGreaterThanOrEqual(490);
  expect(delay2).toBeLessThan(600);
});

test('SpawnQueue stops after maxRetries exhausted', async () => {
  const attempts: number[] = [];

  const spawnFn = mock(async (_req: SpawnRequest): Promise<SpawnResult> => {
    attempts.push(attempts.length + 1);
    return { success: false }; // Always fail
  });

  const queue = new SpawnQueue({ spawnFn, spawnDelayMs: 0, maxRetries: 2 });

  queue.enqueue({ sessionId: 'fail-test', title: 'Fail Test' });
  await waitFor(() => queue.getPendingCount() === 0);

  // Should stop after 1 + 2 = 3 attempts
  expect(attempts.length).toBe(3);
});

test('SpawnQueue applies spawnDelayMs between items', async () => {
  const timestamps: number[] = [];

  const spawnFn = mock(async (_req: SpawnRequest): Promise<SpawnResult> => {
    timestamps.push(Date.now());
    return { success: true, paneId: '%1' };
  });

  const queue = new SpawnQueue({ spawnFn, spawnDelayMs: 100 });

  queue.enqueue({ sessionId: 's1', title: 'T1' });
  queue.enqueue({ sessionId: 's2', title: 'T2' });
  queue.enqueue({ sessionId: 's3', title: 'T3' });

  await waitFor(() => queue.getPendingCount() === 0);

  expect(timestamps.length).toBe(3);

  // Check delays between items (spawnDelayMs applies AFTER each item)
  const delay1 = timestamps[1] - timestamps[0];
  const delay2 = timestamps[2] - timestamps[1];

  expect(delay1).toBeGreaterThanOrEqual(95);
  expect(delay2).toBeGreaterThanOrEqual(95);
});

test('SpawnQueue getPendingCount reflects queue state', async () => {
  const ctrl = createControlledPromise<SpawnResult>();

  const spawnFn = mock(async (_req: SpawnRequest): Promise<SpawnResult> => {
    return ctrl.promise;
  });

  const queue = new SpawnQueue({ spawnFn, spawnDelayMs: 0 });

  expect(queue.getPendingCount()).toBe(0);

  queue.enqueue({ sessionId: 's1', title: 'T1' });
  queue.enqueue({ sessionId: 's2', title: 'T2' });

  // First is processing (in-flight), second is pending = 2 total
  await waitFor(() => queue.getPendingCount() === 2);

  queue.enqueue({ sessionId: 's3', title: 'T3' });
  expect(queue.getPendingCount()).toBe(3);

  ctrl.resolve({ success: true, paneId: '%1' });
});

test('SpawnQueue calls onQueueUpdate callback', async () => {
  const updates: number[] = [];
  const ctrl = createControlledPromise<SpawnResult>();

  const spawnFn = mock(async (_req: SpawnRequest): Promise<SpawnResult> => {
    return ctrl.promise;
  });

  const onQueueUpdate = mock((pending: number) => {
    updates.push(pending);
  });

  const queue = new SpawnQueue({ spawnFn, spawnDelayMs: 0, onQueueUpdate });

  queue.enqueue({ sessionId: 's1', title: 'T1' });
  queue.enqueue({ sessionId: 's2', title: 'T2' });

  await waitFor(() => updates.length >= 2);

  // Should have been called with pending counts as items are enqueued
  expect(updates).toContain(0); // After first starts processing
  expect(updates).toContain(1); // After second enqueued

  ctrl.resolve({ success: true, paneId: '%1' });
  await waitFor(() => queue.getPendingCount() === 0);
});

test('SpawnQueue adds timestamp to request', async () => {
  let receivedRequest: SpawnRequest | null = null;
  const beforeEnqueue = Date.now();

  const spawnFn = mock(async (req: SpawnRequest): Promise<SpawnResult> => {
    receivedRequest = req;
    return { success: true, paneId: '%1' };
  });

  const queue = new SpawnQueue({ spawnFn, spawnDelayMs: 0 });
  queue.enqueue({ sessionId: 's1', title: 'T1' });

  await waitFor(() => receivedRequest !== null);

  expect(receivedRequest!.timestamp).toBeGreaterThanOrEqual(beforeEnqueue);
  expect(receivedRequest!.timestamp).toBeLessThanOrEqual(Date.now());
  expect(receivedRequest!.retryCount).toBe(0);
});

test('SpawnQueue increments retryCount on retries', async () => {
  const retryCounts: number[] = [];

  const spawnFn = mock(async (req: SpawnRequest): Promise<SpawnResult> => {
    retryCounts.push(req.retryCount);
    if (retryCounts.length < 3) {
      return { success: false };
    }
    return { success: true, paneId: '%1' };
  });

  const queue = new SpawnQueue({ spawnFn, spawnDelayMs: 0, maxRetries: 2 });
  queue.enqueue({ sessionId: 's1', title: 'T1' });

  await waitFor(() => queue.getPendingCount() === 0);

  expect(retryCounts).toEqual([0, 1, 2]);
});

test('SpawnQueue handles empty queue gracefully', () => {
  const spawnFn = mock(async (_req: SpawnRequest): Promise<SpawnResult> => {
    return { success: true, paneId: '%1' };
  });

  const queue = new SpawnQueue({ spawnFn, spawnDelayMs: 0 });

  expect(queue.getPendingCount()).toBe(0);
  // No errors should occur
});

test('SpawnQueue processes new items added during processing', async () => {
  const processed: string[] = [];
  const ctrl1 = createControlledPromise<SpawnResult>();

  let callCount = 0;
  const spawnFn = mock(async (req: SpawnRequest): Promise<SpawnResult> => {
    callCount++;
    if (req.sessionId === 's1') {
      return ctrl1.promise;
    }
    processed.push(req.sessionId);
    return { success: true, paneId: '%' + callCount };
  });

  const queue = new SpawnQueue({ spawnFn, spawnDelayMs: 0 });

  queue.enqueue({ sessionId: 's1', title: 'T1' });

  await waitFor(() => callCount === 1);

  // Add more while first is processing (in-flight = 1, pending = 2, total = 3)
  queue.enqueue({ sessionId: 's2', title: 'T2' });
  queue.enqueue({ sessionId: 's3', title: 'T3' });

  expect(queue.getPendingCount()).toBe(3);

  ctrl1.resolve({ success: true, paneId: '%1' });
  await waitFor(() => queue.getPendingCount() === 0);

  expect(processed).toEqual(['s2', 's3']);
});

test('SpawnQueue.enqueue returns Promise that resolves on success', async () => {
  const spawnFn = mock(async (_req: SpawnRequest): Promise<SpawnResult> => {
    return { success: true, paneId: '%42' };
  });

  const queue = new SpawnQueue({ spawnFn, spawnDelayMs: 0 });

  const result = await queue.enqueue({ sessionId: 's1', title: 'T1' });

  expect(result).toEqual({ success: true, paneId: '%42' });
});

test('SpawnQueue.enqueue returns Promise that resolves on final failure', async () => {
  const spawnFn = mock(async (_req: SpawnRequest): Promise<SpawnResult> => {
    return { success: false };
  });

  const queue = new SpawnQueue({ spawnFn, spawnDelayMs: 0, maxRetries: 2 });

  const result = await queue.enqueue({ sessionId: 's1', title: 'T1' });

  expect(result).toEqual({ success: false });
});

test('SpawnQueue.enqueue returns correct result for each item', async () => {
  let callCount = 0;
  const spawnFn = mock(async (req: SpawnRequest): Promise<SpawnResult> => {
    callCount++;
    if (req.sessionId === 's1') {
      return { success: true, paneId: '%1' };
    }
    if (req.sessionId === 's2') {
      return { success: false };
    }
    return { success: true, paneId: '%3' };
  });

  const queue = new SpawnQueue({ spawnFn, spawnDelayMs: 0, maxRetries: 0 });

  const promise1 = queue.enqueue({ sessionId: 's1', title: 'T1' });
  const promise2 = queue.enqueue({ sessionId: 's2', title: 'T2' });
  const promise3 = queue.enqueue({ sessionId: 's3', title: 'T3' });

  const [result1, result2, result3] = await Promise.all([promise1, promise2, promise3]);

  expect(result1).toEqual({ success: true, paneId: '%1' });
  expect(result2).toEqual({ success: false });
  expect(result3).toEqual({ success: true, paneId: '%3' });
});

test('SpawnQueue.enqueue resolves with success after retry succeeds', async () => {
  let attempts = 0;
  const spawnFn = mock(async (_req: SpawnRequest): Promise<SpawnResult> => {
    attempts++;
    if (attempts < 3) {
      return { success: false };
    }
    return { success: true, paneId: '%recovered' };
  });

  const queue = new SpawnQueue({ spawnFn, spawnDelayMs: 0, maxRetries: 2 });

  const result = await queue.enqueue({ sessionId: 's1', title: 'T1' });

  expect(attempts).toBe(3);
  expect(result).toEqual({ success: true, paneId: '%recovered' });
});

test('SpawnQueue.enqueue handles spawnFn exceptions gracefully', async () => {
  let callCount = 0;
  const spawnFn = mock(async (_req: SpawnRequest): Promise<SpawnResult> => {
    callCount++;
    if (callCount < 3) {
      throw new Error('Simulated spawn error');
    }
    return { success: true, paneId: '%fixed' };
  });

  const queue = new SpawnQueue({ spawnFn, spawnDelayMs: 0, maxRetries: 2 });

  const result = await queue.enqueue({ sessionId: 's1', title: 'T1' });

  expect(callCount).toBe(3);
  expect(result).toEqual({ success: true, paneId: '%fixed' });
});

test('SpawnQueue.enqueue promise settles even when all retries throw', async () => {
  const spawnFn = mock(async (_req: SpawnRequest): Promise<SpawnResult> => {
    throw new Error('Always fails');
  });

  const queue = new SpawnQueue({ spawnFn, spawnDelayMs: 0, maxRetries: 1 });

  const result = await queue.enqueue({ sessionId: 's1', title: 'T1' });

  expect(result).toEqual({ success: false });
});

test('SpawnQueue coalesces duplicate sessionId enqueues', async () => {
  const ctrl = createControlledPromise<SpawnResult>();
  let callCount = 0;

  const spawnFn = mock(async (_req: SpawnRequest): Promise<SpawnResult> => {
    callCount++;
    return ctrl.promise;
  });

  const queue = new SpawnQueue({ spawnFn, spawnDelayMs: 0, logFn: () => {} });

  const promise1 = queue.enqueue({ sessionId: 'dup', title: 'T1' });
  const promise2 = queue.enqueue({ sessionId: 'dup', title: 'T2' });
  const promise3 = queue.enqueue({ sessionId: 'dup', title: 'T3' });

  expect(promise1).toBe(promise2);
  expect(promise2).toBe(promise3);

  ctrl.resolve({ success: true, paneId: '%1' });
  const [r1, r2, r3] = await Promise.all([promise1, promise2, promise3]);

  expect(r1).toEqual({ success: true, paneId: '%1' });
  expect(r2).toEqual({ success: true, paneId: '%1' });
  expect(r3).toEqual({ success: true, paneId: '%1' });
  expect(callCount).toBe(1);
});

test('SpawnQueue allows re-enqueue after first completes', async () => {
  let callCount = 0;
  const spawnFn = mock(async (_req: SpawnRequest): Promise<SpawnResult> => {
    callCount++;
    return { success: true, paneId: `%${callCount}` };
  });

  const queue = new SpawnQueue({ spawnFn, spawnDelayMs: 0, logFn: () => {} });

  const result1 = await queue.enqueue({ sessionId: 'x', title: 'T1' });
  const result2 = await queue.enqueue({ sessionId: 'x', title: 'T2' });

  expect(result1.paneId).toBe('%1');
  expect(result2.paneId).toBe('%2');
  expect(callCount).toBe(2);
});

test('SpawnQueue skips stale items', async () => {
  let callCount = 0;
  const ctrl = createControlledPromise<SpawnResult>();

  const spawnFn = mock(async (req: SpawnRequest): Promise<SpawnResult> => {
    callCount++;
    if (req.sessionId === 's1') {
      return ctrl.promise;
    }
    return { success: true, paneId: '%ok' };
  });

  const queue = new SpawnQueue({
    spawnFn,
    spawnDelayMs: 0,
    staleThresholdMs: 50,
    logFn: () => {},
  });

  const promise1 = queue.enqueue({ sessionId: 's1', title: 'T1' });
  const promise2 = queue.enqueue({ sessionId: 's2', title: 'T2' });

  await waitFor(() => callCount === 1);

  await new Promise((r) => setTimeout(r, 100));

  ctrl.resolve({ success: true, paneId: '%1' });

  const [r1, r2] = await Promise.all([promise1, promise2]);

  expect(r1).toEqual({ success: true, paneId: '%1' });
  expect(r2).toEqual({ success: false });
  expect(callCount).toBe(1);
});

test('SpawnQueue shutdown resolves queued items as failed', async () => {
  const ctrl = createControlledPromise<SpawnResult>();
  let callCount = 0;

  const spawnFn = mock(async (_req: SpawnRequest): Promise<SpawnResult> => {
    callCount++;
    return ctrl.promise;
  });

  const queue = new SpawnQueue({ spawnFn, spawnDelayMs: 0, logFn: () => {} });

  const promise1 = queue.enqueue({ sessionId: 's1', title: 'T1' });
  const promise2 = queue.enqueue({ sessionId: 's2', title: 'T2' });
  const promise3 = queue.enqueue({ sessionId: 's3', title: 'T3' });

  await waitFor(() => callCount === 1);

  queue.shutdown();

  ctrl.resolve({ success: true, paneId: '%1' });

  const [r1, r2, r3] = await Promise.all([promise1, promise2, promise3]);

  expect(r1.success).toBe(true);
  expect(r2).toEqual({ success: false });
  expect(r3).toEqual({ success: false });
});

test('SpawnQueue rejects enqueues after shutdown', async () => {
  const spawnFn = mock(async (_req: SpawnRequest): Promise<SpawnResult> => {
    return { success: true, paneId: '%1' };
  });

  const queue = new SpawnQueue({ spawnFn, spawnDelayMs: 0, logFn: () => {} });

  queue.shutdown();

  const result = await queue.enqueue({ sessionId: 's1', title: 'T1' });

  expect(result).toEqual({ success: false });
  expect(spawnFn).not.toHaveBeenCalled();
});

test('SpawnQueue dispose is alias for shutdown', async () => {
  const ctrl = createControlledPromise<SpawnResult>();

  const spawnFn = mock(async (_req: SpawnRequest): Promise<SpawnResult> => {
    return ctrl.promise;
  });

  const queue = new SpawnQueue({ spawnFn, spawnDelayMs: 0, logFn: () => {} });

  const promise1 = queue.enqueue({ sessionId: 's1', title: 'T1' });
  const promise2 = queue.enqueue({ sessionId: 's2', title: 'T2' });

  queue.dispose();

  ctrl.resolve({ success: true, paneId: '%1' });

  const r2 = await promise2;
  expect(r2).toEqual({ success: false });
});

test('SpawnQueue logs lifecycle events', async () => {
  const logs: Array<{ message: string; data?: unknown }> = [];
  const logFn = (message: string, data?: unknown) => {
    logs.push({ message, data });
  };

  const spawnFn = mock(async (_req: SpawnRequest): Promise<SpawnResult> => {
    return { success: true, paneId: '%1' };
  });

  const queue = new SpawnQueue({ spawnFn, spawnDelayMs: 0, logFn });

  await queue.enqueue({ sessionId: 's1', title: 'T1' });

  const messages = logs.map((l) => l.message);
  expect(messages).toContain('[spawn-queue] initialized');
  expect(messages).toContain('[spawn-queue] enqueued');
  expect(messages).toContain('[spawn-queue] processing start');
  expect(messages).toContain('[spawn-queue] spawn attempt');
  expect(messages).toContain('[spawn-queue] success');
  expect(messages).toContain('[spawn-queue] queue drained');
});

test('SpawnQueue logs retry wait and final failure', async () => {
  const logs: Array<{ message: string; data?: unknown }> = [];
  const logFn = (message: string, data?: unknown) => {
    logs.push({ message, data });
  };

  const spawnFn = mock(async (_req: SpawnRequest): Promise<SpawnResult> => {
    return { success: false };
  });

  const queue = new SpawnQueue({ spawnFn, spawnDelayMs: 0, maxRetries: 1, logFn });

  await queue.enqueue({ sessionId: 's1', title: 'T1' });

  const messages = logs.map((l) => l.message);
  expect(messages).toContain('[spawn-queue] retry wait');
  expect(messages).toContain('[spawn-queue] final failure');
});

test('SpawnQueue logs shutdown events', async () => {
  const logs: Array<{ message: string; data?: unknown }> = [];
  const logFn = (message: string, data?: unknown) => {
    logs.push({ message, data });
  };

  const ctrl = createControlledPromise<SpawnResult>();

  const spawnFn = mock(async (_req: SpawnRequest): Promise<SpawnResult> => {
    return ctrl.promise;
  });

  const queue = new SpawnQueue({ spawnFn, spawnDelayMs: 0, logFn });

  queue.enqueue({ sessionId: 's1', title: 'T1' });
  queue.enqueue({ sessionId: 's2', title: 'T2' });

  queue.shutdown();

  const messages = logs.map((l) => l.message);
  expect(messages).toContain('[spawn-queue] shutdown initiated');
  expect(messages).toContain('[spawn-queue] shutdown - resolving queued item as failed');
  expect(messages).toContain('[spawn-queue] shutdown complete');

  ctrl.resolve({ success: true, paneId: '%1' });
});

test('SpawnQueue logs duplicate coalesce events', async () => {
  const logs: Array<{ message: string; data?: unknown }> = [];
  const logFn = (message: string, data?: unknown) => {
    logs.push({ message, data });
  };

  const ctrl = createControlledPromise<SpawnResult>();

  const spawnFn = mock(async (_req: SpawnRequest): Promise<SpawnResult> => {
    return ctrl.promise;
  });

  const queue = new SpawnQueue({ spawnFn, spawnDelayMs: 0, logFn });

  queue.enqueue({ sessionId: 'dup', title: 'T1' });
  queue.enqueue({ sessionId: 'dup', title: 'T2' });

  const messages = logs.map((l) => l.message);
  expect(messages).toContain('[spawn-queue] duplicate enqueue coalesced');

  ctrl.resolve({ success: true, paneId: '%1' });
});

test('SpawnQueue logs stale item skip', async () => {
  const logs: Array<{ message: string; data?: unknown }> = [];
  const logFn = (message: string, data?: unknown) => {
    logs.push({ message, data });
  };

  const ctrl = createControlledPromise<SpawnResult>();

  const spawnFn = mock(async (req: SpawnRequest): Promise<SpawnResult> => {
    if (req.sessionId === 's1') {
      return ctrl.promise;
    }
    return { success: true, paneId: '%ok' };
  });

  const queue = new SpawnQueue({
    spawnFn,
    spawnDelayMs: 0,
    staleThresholdMs: 20,
    logFn,
  });

  queue.enqueue({ sessionId: 's1', title: 'T1' });
  queue.enqueue({ sessionId: 's2', title: 'T2' });

  await new Promise((r) => setTimeout(r, 50));

  ctrl.resolve({ success: true, paneId: '%1' });
  await waitFor(() => queue.getPendingCount() === 0);

  const messages = logs.map((l) => l.message);
  expect(messages).toContain('[spawn-queue] stale item skipped');
});
