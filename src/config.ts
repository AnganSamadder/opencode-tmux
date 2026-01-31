import { z } from 'zod';

export const TmuxLayoutSchema = z.enum([
  'main-horizontal',
  'main-vertical',
  'tiled',
  'even-horizontal',
  'even-vertical',
]);

export type TmuxLayout = z.infer<typeof TmuxLayoutSchema>;

export const TmuxConfigSchema = z.object({
  enabled: z.boolean().default(true),
  layout: TmuxLayoutSchema.default('main-vertical'),
  main_pane_size: z.number().min(20).max(80).default(60),
  spawn_delay_ms: z.number().min(50).max(2000).default(300),
  max_retry_attempts: z.number().min(0).max(5).default(2),
  layout_debounce_ms: z.number().min(50).max(1000).default(150),
  max_agents_per_column: z.number().min(1).max(10).default(3),
});

export type TmuxConfig = z.infer<typeof TmuxConfigSchema>;

export const PluginConfigSchema = z.object({
  enabled: z.boolean().default(true),
  port: z.number().default(4096),
  layout: TmuxLayoutSchema.default('main-vertical'),
  main_pane_size: z.number().min(20).max(80).default(60),
  auto_close: z.boolean().default(true),
  spawn_delay_ms: z.number().min(50).max(2000).default(300),
  max_retry_attempts: z.number().min(0).max(5).default(2),
  layout_debounce_ms: z.number().min(50).max(1000).default(150),
  max_agents_per_column: z.number().min(1).max(10).default(3),
});

export type PluginConfig = z.infer<typeof PluginConfigSchema>;

export const POLL_INTERVAL_MS = 2000;
export const SESSION_TIMEOUT_MS = 10 * 60 * 1000;
export const SESSION_MISSING_GRACE_MS = POLL_INTERVAL_MS * 3;
