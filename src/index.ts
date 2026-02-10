import type { ChildProcess } from 'node:child_process';
import type { Plugin, PluginOutput } from './types';
import { loadConfig } from './utils/config-loader';
import { log } from './utils';
import { defaultSocketPath, execGoBinary, resolveGoBinary, spawnGoBinary } from './utils/go-runtime';

function detectServerUrl(): string {
  if (process.env.OPENCODE_PORT) {
    return `http://localhost:${process.env.OPENCODE_PORT}`;
  }

  return 'http://localhost:4096';
}

let isInitialized = false;
let goDaemonProcess: ChildProcess | null = null;
let goSocketPath: string | null = null;
let usingGoCore = false;
let fallbackOutputPromise: Promise<PluginOutput> | null = null;

async function getLegacyOutput(ctx: Parameters<Plugin>[0]): Promise<PluginOutput> {
  if (!fallbackOutputPromise) {
    fallbackOutputPromise = import('./legacy-plugin').then((mod) => mod.default(ctx));
  }
  return fallbackOutputPromise;
}

async function initGoCore(ctx: Parameters<Plugin>[0], serverUrl: string): Promise<boolean> {
  const daemon = resolveGoBinary('opentmuxd');
  const ctl = resolveGoBinary('opentmuxctl');

  if (!daemon || !ctl) {
    log('[plugin-go-shim] go runtime missing, falling back to TS', { daemon, ctl });
    return false;
  }

  goSocketPath = process.env.OPENTMUXD_SOCKET_PATH ?? defaultSocketPath();

  goDaemonProcess = spawnGoBinary(daemon, ['--socket', goSocketPath], {
    detached: false,
    stdio: 'ignore',
  });

  const started = await execGoBinary(ctl, [
    'init',
    '--socket',
    goSocketPath,
    '--directory',
    ctx.directory,
    '--server-url',
    serverUrl,
  ]);

  if (!started.success) {
    log('[plugin-go-shim] go init failed, falling back to TS', {
      code: started.code,
      stderr: started.stderr,
      error: started.error,
    });
    goDaemonProcess?.kill();
    goDaemonProcess = null;
    goSocketPath = null;
    return false;
  }

  const cleanup = async (reason: string) => {
    if (!goSocketPath) return;
    await execGoBinary(ctl, ['shutdown', '--socket', goSocketPath, '--reason', reason]);
    goDaemonProcess?.kill();
    goDaemonProcess = null;
    goSocketPath = null;
  };

  process.once('SIGINT', () => {
    void cleanup('SIGINT');
  });
  process.once('SIGTERM', () => {
    void cleanup('SIGTERM');
  });
  process.once('beforeExit', () => {
    void cleanup('beforeExit');
  });

  usingGoCore = true;
  return true;
}

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
  const serverUrl = ctx.serverUrl?.toString() || detectServerUrl();

  log('[plugin-go-shim] initialization', {
    directory: ctx.directory,
    serverUrl,
    enabled: config.enabled,
  });

  const goOk = await initGoCore(ctx, serverUrl);
  if (!goOk) {
    return getLegacyOutput(ctx);
  }

  return {
    name: 'opentmux',
    event: async (input) => {
      if (!goSocketPath) {
        return;
      }
      const ctl = resolveGoBinary('opentmuxctl');
      if (!ctl) {
        return;
      }

      const event = input.event as {
        type: string;
        properties?: {
          info?: { id?: string; parentID?: string; title?: string };
        };
      };

      const info = event.properties?.info;
      if (!usingGoCore) {
        const legacy = await getLegacyOutput(ctx);
        if (legacy.event) {
          await legacy.event(input);
        }
        return;
      }

      await execGoBinary(ctl, [
        'session-created',
        '--socket',
        goSocketPath,
        '--type',
        event.type,
        '--id',
        info?.id ?? '',
        '--parent-id',
        info?.parentID ?? '',
        '--title',
        info?.title ?? 'Subagent',
      ]);
    },
  };
};

export default OpencodeAgentTmux;

export type { PluginConfig, TmuxConfig, TmuxLayout } from './config';
