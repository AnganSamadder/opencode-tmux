import { test, expect, beforeEach, afterEach, mock } from 'bun:test';
import {
  spawnTmuxPane,
  setSpawnAsyncFn,
  resetSpawnAsyncFn,
  resetServerCheck,
  resetTmuxPathCache,
  type SpawnPaneResult,
} from '../utils/tmux';
import type { TmuxConfig } from '../config';

interface SpawnResult {
  exitCode: number;
  stdout: string;
  stderr: string;
}

type MockSpawnFn = (
  command: string[],
  options?: { ignoreOutput?: boolean },
) => Promise<SpawnResult>;

function createMockSpawnFn(): {
  fn: MockSpawnFn;
  calls: Array<{ command: string[]; options?: { ignoreOutput?: boolean } }>;
  results: SpawnResult[];
} {
  const calls: Array<{ command: string[]; options?: { ignoreOutput?: boolean } }> = [];
  const results: SpawnResult[] = [];

  const fn: MockSpawnFn = async (command, options) => {
    calls.push({ command, options });
    const result = results.shift();
    if (!result) {
      throw new Error('No more mock results configured');
    }
    return result;
  };

  return { fn, calls, results };
}

function createTestConfig(overrides: Partial<TmuxConfig> = {}): TmuxConfig {
  return {
    enabled: true,
    layout: 'main-vertical',
    main_pane_size: 60,
    spawn_delay_ms: 300,
    max_retry_attempts: 2,
    layout_debounce_ms: 150,
    max_agents_per_column: 3,
    ...overrides,
  };
}

const originalEnv = process.env.TMUX;
let mockData: ReturnType<typeof createMockSpawnFn>;

beforeEach(() => {
  process.env.TMUX = '/tmp/tmux-1000/default,12345,0';
  resetServerCheck();
  resetTmuxPathCache();
  resetSpawnAsyncFn();
  mockData = createMockSpawnFn();
});

afterEach(() => {
  if (originalEnv) {
    process.env.TMUX = originalEnv;
  } else {
    delete process.env.TMUX;
  }
  resetSpawnAsyncFn();
});

test('spawnTmuxPane succeeds on first attempt', async () => {
  mockData.results.push(
    { exitCode: 0, stdout: '/usr/bin/tmux\n', stderr: '' },
    { exitCode: 0, stdout: 'tmux 3.3\n', stderr: '' },
    { exitCode: 0, stdout: '%5\n', stderr: '' },
    { exitCode: 0, stdout: '', stderr: '' },
    { exitCode: 0, stdout: '', stderr: '' },
    { exitCode: 0, stdout: '', stderr: '' },
    { exitCode: 0, stdout: '', stderr: '' },
  );

  setSpawnAsyncFn(mockData.fn);

  const mockFetch = mock(async () => new Response('ok', { status: 200 }));
  const originalFetch = globalThis.fetch;
  globalThis.fetch = mockFetch as unknown as typeof fetch;

  try {
    const config = createTestConfig();
    const result = await spawnTmuxPane('session-1', 'Test Task', config, 'http://localhost:4096');

    expect(result.success).toBe(true);
    expect(result.paneId).toBe('%5');

    const splitWindowCall = mockData.calls.find((c) =>
      c.command.includes('split-window'),
    );
    expect(splitWindowCall).toBeDefined();
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('spawnTmuxPane retries on failure with exponential backoff', async () => {
  mockData.results.push(
    { exitCode: 0, stdout: '/usr/bin/tmux\n', stderr: '' },
    { exitCode: 0, stdout: 'tmux 3.3\n', stderr: '' },
    { exitCode: 1, stdout: '', stderr: 'split failed' },
    { exitCode: 1, stdout: '', stderr: 'split failed again' },
    { exitCode: 0, stdout: '%7\n', stderr: '' },
    { exitCode: 0, stdout: '', stderr: '' },
    { exitCode: 0, stdout: '', stderr: '' },
    { exitCode: 0, stdout: '', stderr: '' },
    { exitCode: 0, stdout: '', stderr: '' },
  );

  const timestamps: number[] = [];
  const wrappedFn: MockSpawnFn = async (command, options) => {
    if (command.includes('split-window')) {
      timestamps.push(Date.now());
    }
    return mockData.fn(command, options);
  };

  setSpawnAsyncFn(wrappedFn);

  const mockFetch = mock(async () => new Response('ok', { status: 200 }));
  const originalFetch = globalThis.fetch;
  globalThis.fetch = mockFetch as unknown as typeof fetch;

  try {
    const config = createTestConfig({ max_retry_attempts: 2 });
    const result = await spawnTmuxPane('session-2', 'Retry Task', config, 'http://localhost:4096');

    expect(result.success).toBe(true);
    expect(result.paneId).toBe('%7');
    expect(timestamps.length).toBe(3);

    const delay1 = timestamps[1] - timestamps[0];
    const delay2 = timestamps[2] - timestamps[1];

    expect(delay1).toBeGreaterThanOrEqual(240);
    expect(delay1).toBeLessThan(400);
    expect(delay2).toBeGreaterThanOrEqual(490);
    expect(delay2).toBeLessThan(700);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('spawnTmuxPane returns failure after max retries exhausted', async () => {
  mockData.results.push(
    { exitCode: 0, stdout: '/usr/bin/tmux\n', stderr: '' },
    { exitCode: 0, stdout: 'tmux 3.3\n', stderr: '' },
    { exitCode: 1, stdout: '', stderr: 'fail 1' },
    { exitCode: 1, stdout: '', stderr: 'fail 2' },
    { exitCode: 1, stdout: '', stderr: 'fail 3' },
  );

  let splitCallCount = 0;
  const wrappedFn: MockSpawnFn = async (command, options) => {
    if (command.includes('split-window')) {
      splitCallCount++;
    }
    return mockData.fn(command, options);
  };

  setSpawnAsyncFn(wrappedFn);

  const mockFetch = mock(async () => new Response('ok', { status: 200 }));
  const originalFetch = globalThis.fetch;
  globalThis.fetch = mockFetch as unknown as typeof fetch;

  try {
    const config = createTestConfig({ max_retry_attempts: 2 });
    const result = await spawnTmuxPane('session-3', 'Fail Task', config, 'http://localhost:4096');

    expect(result.success).toBe(false);
    expect(result.paneId).toBeUndefined();
    expect(splitCallCount).toBe(3);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('spawnTmuxPane retries when exitCode is 0 but paneId is empty', async () => {
  mockData.results.push(
    { exitCode: 0, stdout: '/usr/bin/tmux\n', stderr: '' },
    { exitCode: 0, stdout: 'tmux 3.3\n', stderr: '' },
    { exitCode: 0, stdout: '', stderr: '' },
    { exitCode: 0, stdout: '%9\n', stderr: '' },
    { exitCode: 0, stdout: '', stderr: '' },
    { exitCode: 0, stdout: '', stderr: '' },
    { exitCode: 0, stdout: '', stderr: '' },
    { exitCode: 0, stdout: '', stderr: '' },
  );

  setSpawnAsyncFn(mockData.fn);

  const mockFetch = mock(async () => new Response('ok', { status: 200 }));
  const originalFetch = globalThis.fetch;
  globalThis.fetch = mockFetch as unknown as typeof fetch;

  try {
    const config = createTestConfig({ max_retry_attempts: 2 });
    const result = await spawnTmuxPane('session-4', 'Empty PaneId', config, 'http://localhost:4096');

    expect(result.success).toBe(true);
    expect(result.paneId).toBe('%9');
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('spawnTmuxPane with max_retry_attempts=0 does not retry', async () => {
  mockData.results.push(
    { exitCode: 0, stdout: '/usr/bin/tmux\n', stderr: '' },
    { exitCode: 0, stdout: 'tmux 3.3\n', stderr: '' },
    { exitCode: 1, stdout: '', stderr: 'immediate fail' },
  );

  let splitCallCount = 0;
  const wrappedFn: MockSpawnFn = async (command, options) => {
    if (command.includes('split-window')) {
      splitCallCount++;
    }
    return mockData.fn(command, options);
  };

  setSpawnAsyncFn(wrappedFn);

  const mockFetch = mock(async () => new Response('ok', { status: 200 }));
  const originalFetch = globalThis.fetch;
  globalThis.fetch = mockFetch as unknown as typeof fetch;

  try {
    const config = createTestConfig({ max_retry_attempts: 0 });
    const result = await spawnTmuxPane('session-5', 'No Retry', config, 'http://localhost:4096');

    expect(result.success).toBe(false);
    expect(splitCallCount).toBe(1);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('spawnTmuxPane returns early when config.enabled is false', async () => {
  const config = createTestConfig({ enabled: false });
  const result = await spawnTmuxPane('session-6', 'Disabled', config, 'http://localhost:4096');

  expect(result.success).toBe(false);
  expect(mockData.calls.length).toBe(0);
});

test('spawnTmuxPane returns early when not inside tmux', async () => {
  delete process.env.TMUX;

  const config = createTestConfig();
  const result = await spawnTmuxPane('session-7', 'No Tmux', config, 'http://localhost:4096');

  expect(result.success).toBe(false);
  expect(mockData.calls.length).toBe(0);
});
