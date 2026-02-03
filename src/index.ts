import type { Plugin } from './types';
import * as fs from 'node:fs';
import * as path from 'node:path';
import {
  PluginConfigSchema,
  type PluginConfig,
  type TmuxConfig,
} from './config';
import { TmuxSessionManager } from './tmux-session-manager';
import { log, startTmuxCheck } from './utils';

function detectServerUrl(): string {
  if (process.env.OPENCODE_PORT) {
    return `http://localhost:${process.env.OPENCODE_PORT}`;
  }

  return 'http://localhost:4096';
}

function loadConfig(directory: string): PluginConfig {
  const configPaths = [
    path.join(directory, 'opentmux.json'),
    path.join(directory, 'opencode-agent-tmux.json'), // Fallback
    path.join(
      process.env.HOME ?? '',
      '.config',
      'opencode',
      'opentmux.json',
    ),
  ];

  for (const configPath of configPaths) {
    try {
      if (fs.existsSync(configPath)) {
        const content = fs.readFileSync(configPath, 'utf-8');
        const parsed = JSON.parse(content);
        const result = PluginConfigSchema.safeParse(parsed);
        if (result.success) {
          log('[plugin] loaded config', { configPath, config: result.data });
          return result.data;
        }
        log('[plugin] config parse error', {
          configPath,
          error: result.error.message,
        });
      }
    } catch (err) {
      log('[plugin] config load error', { configPath, error: String(err) });
    }
  }

  const defaultConfig = PluginConfigSchema.parse({});
  log('[plugin] using default config', { config: defaultConfig });
  return defaultConfig;
}

const OpencodeAgentTmux: Plugin = async (ctx) => {
  const config = loadConfig(ctx.directory);

  const tmuxConfig: TmuxConfig = {
    enabled: config.enabled,
    layout: config.layout,
    main_pane_size: config.main_pane_size,
    spawn_delay_ms: config.spawn_delay_ms,
    max_retry_attempts: config.max_retry_attempts,
    layout_debounce_ms: config.layout_debounce_ms,
    max_agents_per_column: config.max_agents_per_column,
  };

  const serverUrl = ctx.serverUrl?.toString() || detectServerUrl();

  log('[plugin] initialized', {
    tmuxConfig,
    directory: ctx.directory,
    serverUrl,
  });

  if (tmuxConfig.enabled) {
    startTmuxCheck();
  }

  const tmuxSessionManager = new TmuxSessionManager(ctx, tmuxConfig, serverUrl);

  return {
    name: 'opentmux',

    event: async (input) => {
      await tmuxSessionManager.onSessionCreated(
        input.event as {
          type: string;
          properties?: {
            info?: { id?: string; parentID?: string; title?: string };
          };
        },
      );
    },
  };
};

export default OpencodeAgentTmux;

export type { PluginConfig, TmuxConfig, TmuxLayout } from './config';
