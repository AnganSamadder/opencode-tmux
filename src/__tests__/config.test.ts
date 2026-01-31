import { test, expect } from "bun:test";
import { TmuxConfigSchema } from "../config";

test("TmuxConfigSchema has new config fields", () => {
  const config = TmuxConfigSchema.parse({});
  expect(config.spawn_delay_ms).toBe(300);
  expect(config.max_retry_attempts).toBe(2);
  expect(config.layout_debounce_ms).toBe(150);
  expect(config.max_agents_per_column).toBe(3);
});

test("TmuxConfigSchema accepts custom values", () => {
  const config = TmuxConfigSchema.parse({
    spawn_delay_ms: 500,
    max_retry_attempts: 3,
    layout_debounce_ms: 200,
    max_agents_per_column: 4,
  });
  expect(config.spawn_delay_ms).toBe(500);
  expect(config.max_retry_attempts).toBe(3);
  expect(config.layout_debounce_ms).toBe(200);
  expect(config.max_agents_per_column).toBe(4);
});

test("TmuxConfigSchema validates min/max constraints", () => {
  expect(() => TmuxConfigSchema.parse({ spawn_delay_ms: 10 })).toThrow();
  expect(() => TmuxConfigSchema.parse({ spawn_delay_ms: 3000 })).toThrow();
  expect(() => TmuxConfigSchema.parse({ max_agents_per_column: 0 })).toThrow();
  expect(() => TmuxConfigSchema.parse({ max_agents_per_column: 15 })).toThrow();
});
