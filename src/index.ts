import type { Plugin } from './types';
import { type TmuxConfig } from './config';
import { TmuxSessionManager } from './tmux-session-manager';
import { log, startTmuxCheck } from './utils';
import { loadConfig } from './utils/config-loader';

function detectServerUrl(): string {
  if (process.env.OPENCODE_PORT) {
    return `http://localhost:${process.env.OPENCODE_PORT}`;
  }

  return 'http://localhost:4096';
}

let isInitialized = false;

const OpencodeAgentTmux: Plugin = async (ctx) => {
  if (isInitialized) {
    log('[plugin] duplicate initialization detected, skipping', {
      directory: ctx.directory,
    });
    return {
      name: 'opentmux',
      event: async () => {},
    };
  }
  isInitialized = true;

  const config = loadConfig(ctx.directory);

  const tmuxConfig: TmuxConfig = {
    enabled: config.enabled,
    layout: config.layout,
    main_pane_size: config.main_pane_size,
    spawn_delay_ms: config.spawn_delay_ms,
    max_retry_attempts: config.max_retry_attempts,
    layout_debounce_ms: config.layout_debounce_ms,
    max_agents_per_column: config.max_agents_per_column,
    reaper_enabled: config.reaper_enabled,
    reaper_interval_ms: config.reaper_interval_ms,
    reaper_min_zombie_checks: config.reaper_min_zombie_checks,
    reaper_grace_period_ms: config.reaper_grace_period_ms,
    reaper_auto_self_destruct: config.reaper_auto_self_destruct,
    reaper_self_destruct_timeout_ms: config.reaper_self_destruct_timeout_ms,
    rotate_port: config.rotate_port,
    max_ports: config.max_ports,
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
