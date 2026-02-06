import * as fs from 'node:fs';
import * as path from 'node:path';
import { PluginConfigSchema, type PluginConfig } from '../config';

function log(message: string, data?: unknown) {
  // Simple logger for config loading
  // In real app, might want to use the unified logger
}

export function loadConfig(directory?: string): PluginConfig {
  const configPaths: string[] = [];

  if (directory) {
    configPaths.push(
      path.join(directory, 'opentmux.json'),
      path.join(directory, 'opencode-agent-tmux.json')
    );
  }

  configPaths.push(
    path.join(
      process.env.HOME ?? '',
      '.config',
      'opencode',
      'opentmux.json',
    )
  );

  for (const configPath of configPaths) {
    try {
      if (fs.existsSync(configPath)) {
        const content = fs.readFileSync(configPath, 'utf-8');
        const parsed = JSON.parse(content);
        const result = PluginConfigSchema.safeParse(parsed);
        if (result.success) {
          return result.data;
        }
      }
    } catch (err) {
      // ignore
    }
  }

  return PluginConfigSchema.parse({});
}
