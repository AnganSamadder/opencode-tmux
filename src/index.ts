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
  const home = process.env.HOME ?? '';
  const configPaths = [
    {
      path: path.join(directory, 'opencode-tmux.json'),
      legacy: false,
    },
    {
      path: path.join(directory, 'opencode-agent-tmux.json'),
      legacy: true,
    },
    {
      path: path.join(home, '.config', 'opencode', 'opencode-tmux.json'),
      legacy: false,
    },
    {
      path: path.join(home, '.config', 'opencode', 'opencode-agent-tmux.json'),
      legacy: true,
    },
  ];

  for (const { path: configPath, legacy } of configPaths) {
    try {
      if (fs.existsSync(configPath)) {
        if (legacy) {
          console.warn(
            'Deprecation: Using legacy opencode-agent-tmux config. Please update to @angansamadder/opencode-tmux',
          );
        }
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

const OpencodeTmux: Plugin = async (ctx) => {
  const config = loadConfig(ctx.directory);

  const tmuxConfig: TmuxConfig = {
    enabled: config.enabled,
    layout: config.layout,
    main_pane_size: config.main_pane_size,
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
    name: 'opencode-tmux',

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

export default OpencodeTmux;

export type { PluginConfig, TmuxConfig, TmuxLayout } from './config';
