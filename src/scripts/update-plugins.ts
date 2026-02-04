#!/usr/bin/env node

import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';

const HOME = os.homedir();
const CONFIG_PATH = path.join(HOME, '.config', 'opencode', 'opencode.json');
const STATE_DIR = path.join(HOME, '.config', 'opencode', 'opencode-agent-tmux');
const STATE_PATH = path.join(STATE_DIR, 'update-state.json');
const UPDATE_INTERVAL_HOURS = 12;

type OpencodeConfig = {
  plugin?: string[];
  plugins?: string[];
  [key: string]: unknown;
};

function ensureStateDir(): void {
  if (!fs.existsSync(STATE_DIR)) {
    fs.mkdirSync(STATE_DIR, { recursive: true });
  }
}

function shouldRunUpdate(): boolean {
  try {
    if (!fs.existsSync(STATE_PATH)) return true;
    const raw = fs.readFileSync(STATE_PATH, 'utf-8');
    const parsed = JSON.parse(raw) as { lastRun?: string };
    if (!parsed.lastRun) return true;
    const lastRun = new Date(parsed.lastRun).getTime();
    if (Number.isNaN(lastRun)) return true;
    const diffHours = (Date.now() - lastRun) / (1000 * 60 * 60);
    return diffHours >= UPDATE_INTERVAL_HOURS;
  } catch {
    return true;
  }
}

function writeLastRun(): void {
  try {
    ensureStateDir();
    fs.writeFileSync(
      STATE_PATH,
      JSON.stringify({ lastRun: new Date().toISOString() }, null, 2),
      'utf-8'
    );
  } catch {
    // Ignore
  }
}

function normalizePluginName(name: string): string | null {
  const trimmed = name.trim();
  if (!trimmed) return null;
  if (trimmed.startsWith('./') || trimmed.startsWith('../')) return null;
  if (trimmed.startsWith('file:') || trimmed.startsWith('git+')) return null;
  if (trimmed.includes(path.sep)) return null;

  const atIndex = trimmed.lastIndexOf('@');
  if (atIndex > 0) {
    return trimmed.slice(0, atIndex);
  }

  return trimmed;
}

function loadConfig(): OpencodeConfig | null {
  try {
    if (!fs.existsSync(CONFIG_PATH)) return null;
    const raw = fs.readFileSync(CONFIG_PATH, 'utf-8');
    return JSON.parse(raw) as OpencodeConfig;
  } catch {
    return null;
  }
}

function saveConfig(config: OpencodeConfig): void {
  try {
    const dir = path.dirname(CONFIG_PATH);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
    fs.writeFileSync(CONFIG_PATH, JSON.stringify(config, null, 2) + '\n', 'utf-8');
  } catch {
    // Ignore
  }
}

function ensurePluginEntry(config: OpencodeConfig): string[] {
  const existingPlugin = Array.isArray(config.plugin) ? [...config.plugin] : [];
  const existingPlugins = Array.isArray(config.plugins) ? [...config.plugins] : [];
  const existing = [...existingPlugin, ...existingPlugins];

  const normalized = existing.map((entry) =>
    entry === 'opencode-subagent-tmux' ? 'opencode-agent-tmux' : entry
  );

  const deduped: string[] = [];
  for (const entry of normalized) {
    if (!deduped.includes(entry)) {
      deduped.push(entry);
    }
  }

  const hasTmuxPlugin = deduped.some(
    (entry) =>
      entry === 'opencode-agent-tmux' ||
      entry.endsWith('/opentmux') ||
      entry.endsWith('/opencode-agent-tmux'),
  );

  if (!hasTmuxPlugin) {
    deduped.push('opencode-agent-tmux');
  }

  const changed =
    JSON.stringify(existingPlugin) !== JSON.stringify(deduped) ||
    'plugins' in config;

  if (changed) {
    config.plugin = deduped;
    delete config.plugins;
    saveConfig(config);
  }

  return deduped;
}

function installLatest(plugins: string[]): void {
  const npmCmd = process.platform === 'win32' ? 'npm.cmd' : 'npm';
  const unique = Array.from(new Set(plugins));

  for (const plugin of unique) {
    const normalized = normalizePluginName(plugin);
    if (!normalized) continue;
    const target = `${normalized}@latest`;
    spawnSync(npmCmd, ['install', '-g', target], { stdio: 'ignore' });
  }
}

function main(): void {
  if (!shouldRunUpdate()) return;
  if (process.env.OPENCODE_TMUX_UPDATE !== '1') return;

  const config = loadConfig() ?? {};
  const plugins = ensurePluginEntry(config);
  const updateList = ['opencode-agent-tmux', ...plugins];

  installLatest(updateList);
  writeLastRun();
}

try {
  main();
} catch {
  // Silent failure
}
