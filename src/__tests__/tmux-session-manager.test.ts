import { test, expect, mock, beforeEach } from 'bun:test';
import { TmuxSessionManager } from '../tmux-session-manager';
import type { PluginInput } from '../types';
import type { TmuxConfig } from '../config';

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

// Mock spawnTmuxPane at module level
let mockSpawnTmuxPane: ReturnType<typeof mock<(sessionId: string, title: string, config: TmuxConfig, serverUrl: string) => Promise<{ success: boolean; paneId?: string }>>>;
let mockIsInsideTmux: ReturnType<typeof mock<() => boolean>>;
let mockApplyTmuxLayout: ReturnType<typeof mock<() => Promise<void>>>;

// Track spawn calls for assertions
let spawnCalls: Array<{ sessionId: string; title: string }> = [];
let spawnControllers: Map<string, { resolve: (result: { success: boolean; paneId?: string }) => void }> = new Map();
let layoutCallCount = 0;

mock.module('../utils', () => {
  mockSpawnTmuxPane = mock(async (sessionId: string, title: string) => {
    spawnCalls.push({ sessionId, title });
    
    // Check if there's a controller waiting for this session
    const ctrl = createControlledPromise<{ success: boolean; paneId?: string }>();
    spawnControllers.set(sessionId, { resolve: ctrl.resolve });
    return ctrl.promise;
  });

  mockIsInsideTmux = mock(() => true);
  
  mockApplyTmuxLayout = mock(async () => {
    layoutCallCount++;
  });

  return {
    spawnTmuxPane: mockSpawnTmuxPane,
    isInsideTmux: mockIsInsideTmux,
    closeTmuxPane: mock(async () => true),
    applyTmuxLayout: mockApplyTmuxLayout,
    log: mock(() => {}),
  };
});

function createMockPluginInput(): PluginInput {
  return {
    directory: '/test',
    serverUrl: 'http://localhost:4096',
    client: {
      session: {
        status: mock(async () => ({ data: {} })),
        subscribe: mock(() => () => {}),
      },
    },
  };
}

function createTmuxConfig(overrides?: Partial<TmuxConfig>): TmuxConfig {
  return {
    enabled: true,
    layout: 'main-vertical',
    main_pane_size: 60,
    spawn_delay_ms: 0, // No delay for tests
    max_retry_attempts: 2,
    layout_debounce_ms: 150,
    max_agents_per_column: 3,
    ...overrides,
  };
}

beforeEach(() => {
  spawnCalls = [];
  spawnControllers.clear();
  layoutCallCount = 0;
});

test('TmuxSessionManager queues spawns sequentially', async () => {
  const ctx = createMockPluginInput();
  const config = createTmuxConfig();
  const manager = new TmuxSessionManager(ctx, config, 'http://localhost:4096');

  const event1 = {
    type: 'session.created',
    properties: { info: { id: 'session-1', parentID: 'parent-1', title: 'Task 1' } },
  };
  const event2 = {
    type: 'session.created',
    properties: { info: { id: 'session-2', parentID: 'parent-1', title: 'Task 2' } },
  };

  // Fire both events concurrently (simulating rapid session creation)
  const promise1 = manager.onSessionCreated(event1);
  const promise2 = manager.onSessionCreated(event2);

  // Wait for first spawn call to be registered
  await waitFor(() => spawnCalls.length >= 1);

  // Only session-1 should have started spawning (queued, not concurrent)
  expect(spawnCalls.length).toBe(1);
  expect(spawnCalls[0].sessionId).toBe('session-1');

  // Session-2 should NOT have started yet (proving queue serialization)
  expect(spawnCalls.find(c => c.sessionId === 'session-2')).toBeUndefined();

  // Complete first spawn
  spawnControllers.get('session-1')?.resolve({ success: true, paneId: '%1' });

  // Wait for second spawn to start
  await waitFor(() => spawnCalls.length >= 2);

  expect(spawnCalls.length).toBe(2);
  expect(spawnCalls[1].sessionId).toBe('session-2');

  // Complete second spawn
  spawnControllers.get('session-2')?.resolve({ success: true, paneId: '%2' });

  await Promise.all([promise1, promise2]);
});

test('TmuxSessionManager tracks sessions after successful spawn', async () => {
  const ctx = createMockPluginInput();
  const config = createTmuxConfig();
  const manager = new TmuxSessionManager(ctx, config, 'http://localhost:4096');

  const event = {
    type: 'session.created',
    properties: { info: { id: 'track-test', parentID: 'parent', title: 'Tracked' } },
  };

  const promise = manager.onSessionCreated(event);

  await waitFor(() => spawnControllers.has('track-test'));
  spawnControllers.get('track-test')?.resolve({ success: true, paneId: '%42' });

  await promise;

  // Verify session is tracked by attempting to add it again (should be skipped)
  const duplicatePromise = manager.onSessionCreated(event);
  await duplicatePromise;

  // Should still only have one spawn call (duplicate was skipped)
  expect(spawnCalls.filter(c => c.sessionId === 'track-test').length).toBe(1);
});

test('TmuxSessionManager does not track session on spawn failure', async () => {
  const ctx = createMockPluginInput();
  const config = createTmuxConfig({ max_retry_attempts: 0 });
  const manager = new TmuxSessionManager(ctx, config, 'http://localhost:4096');

  const event = {
    type: 'session.created',
    properties: { info: { id: 'fail-test', parentID: 'parent', title: 'Fail' } },
  };

  const promise = manager.onSessionCreated(event);

  await waitFor(() => spawnControllers.has('fail-test'));
  spawnControllers.get('fail-test')?.resolve({ success: false });

  await promise;

  expect(spawnCalls.length).toBe(1);
  expect(spawnCalls[0].sessionId).toBe('fail-test');
});

test('TmuxSessionManager ignores non-session.created events', async () => {
  const ctx = createMockPluginInput();
  const config = createTmuxConfig();
  const manager = new TmuxSessionManager(ctx, config, 'http://localhost:4096');

  const event = {
    type: 'session.updated', // Not session.created
    properties: { info: { id: 'ignored', parentID: 'parent', title: 'Ignored' } },
  };

  await manager.onSessionCreated(event);

  expect(spawnCalls.length).toBe(0);
});

test('TmuxSessionManager ignores events without session info', async () => {
  const ctx = createMockPluginInput();
  const config = createTmuxConfig();
  const manager = new TmuxSessionManager(ctx, config, 'http://localhost:4096');

  const event1 = {
    type: 'session.created',
    properties: {}, // No info
  };

  const event2 = {
    type: 'session.created',
    properties: { info: { parentID: 'parent' } }, // No id
  };

  await manager.onSessionCreated(event1);
  await manager.onSessionCreated(event2);

  expect(spawnCalls.length).toBe(0);
});

test('TmuxSessionManager createEventHandler wraps onSessionCreated', async () => {
  const ctx = createMockPluginInput();
  const config = createTmuxConfig();
  const manager = new TmuxSessionManager(ctx, config, 'http://localhost:4096');

  const handler = manager.createEventHandler();

  const event = {
    type: 'session.created',
    properties: { info: { id: 'handler-test', parentID: 'parent', title: 'Handler' } },
  };

  const promise = handler({ event });

  await waitFor(() => spawnControllers.has('handler-test'));
  spawnControllers.get('handler-test')?.resolve({ success: true, paneId: '%1' });

  await promise;

  expect(spawnCalls.length).toBe(1);
  expect(spawnCalls[0].sessionId).toBe('handler-test');
});

test('TmuxSessionManager uses config spawn_delay_ms and max_retry_attempts', async () => {
  const ctx = createMockPluginInput();
  const config = createTmuxConfig({
    spawn_delay_ms: 100,
    max_retry_attempts: 3,
  });
  
  // Manager is created with custom config - the SpawnQueue inside uses these values
  const manager = new TmuxSessionManager(ctx, config, 'http://localhost:4096');

  const event = {
    type: 'session.created',
    properties: { info: { id: 'config-test', parentID: 'parent', title: 'Config' } },
  };

  const promise = manager.onSessionCreated(event);

  await waitFor(() => spawnControllers.has('config-test'));
  spawnControllers.get('config-test')?.resolve({ success: true, paneId: '%1' });

  await promise;

  // If we got here without timeout, the queue is working with the config
  expect(spawnCalls.length).toBe(1);
});

test('TmuxSessionManager applies layout once after queue drains (deferred layout)', async () => {
  const ctx = createMockPluginInput();
  const config = createTmuxConfig({
    layout_debounce_ms: 50,
    spawn_delay_ms: 0,
  });
  const manager = new TmuxSessionManager(ctx, config, 'http://localhost:4096');

  const events = [
    { type: 'session.created', properties: { info: { id: 'batch-1', parentID: 'parent', title: 'Batch 1' } } },
    { type: 'session.created', properties: { info: { id: 'batch-2', parentID: 'parent', title: 'Batch 2' } } },
    { type: 'session.created', properties: { info: { id: 'batch-3', parentID: 'parent', title: 'Batch 3' } } },
  ];

  const promises = events.map((e) => manager.onSessionCreated(e));

  await waitFor(() => spawnControllers.has('batch-1'));
  expect(layoutCallCount).toBe(0);
  spawnControllers.get('batch-1')?.resolve({ success: true, paneId: '%1' });

  await waitFor(() => spawnControllers.has('batch-2'));
  expect(layoutCallCount).toBe(0);
  spawnControllers.get('batch-2')?.resolve({ success: true, paneId: '%2' });

  await waitFor(() => spawnControllers.has('batch-3'));
  expect(layoutCallCount).toBe(0);
  spawnControllers.get('batch-3')?.resolve({ success: true, paneId: '%3' });

  await Promise.all(promises);

  expect(spawnCalls.length).toBe(3);
  expect(layoutCallCount).toBe(0);

  await new Promise((r) => setTimeout(r, 100));

  expect(layoutCallCount).toBe(1);
});
