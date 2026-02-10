#!/usr/bin/env bun

import { SpawnQueue } from '../../src/spawn-queue';

async function runTsBenchmark(iterations: number): Promise<number> {
  const started = performance.now();
  for (let i = 0; i < iterations; i++) {
    const queue = new SpawnQueue({
      spawnFn: async () => ({ success: true, paneId: '%1' }),
      spawnDelayMs: 0,
      maxRetries: 0,
      logFn: () => {},
    });

    const tasks = Array.from({ length: 100 }, (_, idx) =>
      queue.enqueue({ sessionId: `ses-${i}-${idx}`, title: 'task' }),
    );
    await Promise.all(tasks);
    queue.shutdown();
  }
  return performance.now() - started;
}

async function run(): Promise<void> {
  const iterations = Number(process.env.BENCH_ITERATIONS ?? '50');
  const tsMs = await runTsBenchmark(iterations);
  console.log(`TS benchmark (${iterations}x100): ${tsMs.toFixed(2)} ms`);

  const goBench = Bun.spawnSync(['go', 'test', './internal/spawnqueue', '-bench=BenchmarkQueueBurst100', '-benchmem', '-run=^$'], {
    stdout: 'pipe',
    stderr: 'pipe',
  });

  if (goBench.exitCode !== 0) {
    console.error(goBench.stderr.toString());
    process.exit(goBench.exitCode);
  }

  console.log(goBench.stdout.toString());
}

void run();
