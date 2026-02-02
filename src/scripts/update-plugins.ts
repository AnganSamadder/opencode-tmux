#!/usr/bin/env node

import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";

const HOME = os.homedir();
const CONFIG_PATH = path.join(HOME, ".config", "opencode", "opencode.json");

const NEW_STATE_DIR = path.join(HOME, ".config", "opencode", "opencode-tmux");
const OLD_STATE_DIR = path.join(
  HOME,
  ".config",
  "opencode",
  "opencode-agent-tmux",
);

function getStateDir(): string {
  if (fs.existsSync(NEW_STATE_DIR)) {
    return NEW_STATE_DIR;
  }
  if (fs.existsSync(OLD_STATE_DIR)) {
    console.warn(
      "Deprecation: Using legacy opencode-agent-tmux state directory. Please update to opencode-plugin-tmux",
    );
    return OLD_STATE_DIR;
  }
  return NEW_STATE_DIR;
}

const STATE_DIR = getStateDir();
const STATE_PATH = path.join(STATE_DIR, "update-state.json");
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
    const raw = fs.readFileSync(STATE_PATH, "utf-8");
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
      "utf-8",
    );
  } catch {
    // Ignore
  }
}

function normalizePluginName(name: string): string | null {
  const trimmed = name.trim();
  if (!trimmed) return null;
  if (trimmed.startsWith("./") || trimmed.startsWith("../")) return null;
  if (trimmed.startsWith("file:") || trimmed.startsWith("git+")) return null;
  if (trimmed.includes(path.sep)) return null;

  const atIndex = trimmed.lastIndexOf("@");
  if (atIndex > 0) {
    return trimmed.slice(0, atIndex);
  }

  return trimmed;
}

function loadConfig(): OpencodeConfig | null {
  try {
    if (!fs.existsSync(CONFIG_PATH)) return null;
    const raw = fs.readFileSync(CONFIG_PATH, "utf-8");
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
    fs.writeFileSync(
      CONFIG_PATH,
      JSON.stringify(config, null, 2) + "\n",
      "utf-8",
    );
  } catch {
    // Ignore
  }
}

function ensurePluginEntry(config: OpencodeConfig): string[] {
  // Check 'plugin' (singular) first, fallback to 'plugins' (plural) for reading but prefer 'plugin' for writing
  const existingRaw = config.plugin || config.plugins;
  const existing = Array.isArray(existingRaw) ? [...existingRaw] : [];

  const normalized = existing.map((plugin) => {
    if (
      plugin === "opencode-subagent-tmux" ||
      plugin === "opencode-agent-tmux"
    ) {
      return "opencode-tmux";
    }
    return plugin;
  });

  if (!normalized.includes("opencode-tmux")) {
    normalized.push("opencode-tmux");
  }

  if (JSON.stringify(existing) !== JSON.stringify(normalized)) {
    // FORCE SINGULAR 'plugin' KEY
    config.plugin = normalized;
    // Remove plural key if it exists to clean up
    delete config.plugins;

    saveConfig(config);
  }

  return normalized;
}

function installLatest(plugins: string[]): void {
  const npmCmd = process.platform === "win32" ? "npm.cmd" : "npm";
  const unique = Array.from(new Set(plugins));

  for (const plugin of unique) {
    const normalized = normalizePluginName(plugin);
    if (!normalized) continue;

    // Use scoped package for opencode-tmux
    const pkgName =
      normalized === "opencode-tmux"
        ? "opencode-plugin-tmux"
        : normalized;
    const target = `${pkgName}@latest`;
    spawnSync(npmCmd, ["install", "-g", target], { stdio: "ignore" });
  }
}

function main(): void {
  if (!shouldRunUpdate()) return;
  if (process.env.OPENCODE_TMUX_UPDATE !== "1") return;

  const config = loadConfig() ?? {};
  const plugins = ensurePluginEntry(config);
  const updateList = ["opencode-tmux", ...plugins];

  installLatest(updateList);
  writeLastRun();
}

try {
  main();
} catch {
  // Silent failure
}
