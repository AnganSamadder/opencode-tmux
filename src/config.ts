import { z } from 'zod';

export const TmuxLayoutSchema = z.enum([
  'main-horizontal',
  'main-vertical',
  'tiled',
  'even-horizontal',
  'even-vertical',
  'dynamic-vertical',
]);

export type TmuxLayout = z.infer<typeof TmuxLayoutSchema>;

export const TmuxConfigSchema = z.object({
  enabled: z.boolean().default(true),
  layout: TmuxLayoutSchema.default('dynamic-vertical'),
  main_pane_size: z.number().min(20).max(80).default(60),
  max_agents_per_column: z.number().min(0).max(10).default(3),
});

export type TmuxConfig = z.infer<typeof TmuxConfigSchema>;

export const PluginConfigSchema = z.object({
  enabled: z.boolean().default(true),
  port: z.number().default(4096),
  layout: TmuxLayoutSchema.default('dynamic-vertical'),
  main_pane_size: z.number().min(20).max(80).default(60),
  max_agents_per_column: z.number().min(0).max(10).default(3),
  auto_close: z.boolean().default(true),
});

export type PluginConfig = z.infer<typeof PluginConfigSchema>;

export const POLL_INTERVAL_MS = 2000;
export const SESSION_TIMEOUT_MS = 10 * 60 * 1000;
export const SESSION_MISSING_GRACE_MS = POLL_INTERVAL_MS * 3;
