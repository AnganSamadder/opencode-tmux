// src/index.ts
import * as fs2 from "fs";
import * as path2 from "path";

// src/config.ts
import { z } from "zod";
var TmuxLayoutSchema = z.enum([
  "main-horizontal",
  "main-vertical",
  "tiled",
  "even-horizontal",
  "even-vertical"
]);
var TmuxConfigSchema = z.object({
  enabled: z.boolean().default(true),
  layout: TmuxLayoutSchema.default("main-vertical"),
  main_pane_size: z.number().min(20).max(80).default(60)
});
var PluginConfigSchema = z.object({
  enabled: z.boolean().default(true),
  port: z.number().default(4096),
  layout: TmuxLayoutSchema.default("main-vertical"),
  main_pane_size: z.number().min(20).max(80).default(60),
  auto_close: z.boolean().default(true)
});
var POLL_INTERVAL_MS = 2e3;
var SESSION_TIMEOUT_MS = 10 * 60 * 1e3;
var SESSION_MISSING_GRACE_MS = POLL_INTERVAL_MS * 3;

// src/utils/logger.ts
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
var logFile = path.join(os.tmpdir(), "opencode-agent-tmux.log");
function log(message, data) {
  try {
    const timestamp = (/* @__PURE__ */ new Date()).toISOString();
    const logEntry = `[${timestamp}] ${message} ${data ? JSON.stringify(data) : ""}
`;
    fs.appendFileSync(logFile, logEntry);
  } catch {
  }
}

// src/utils/tmux.ts
import { spawn } from "child_process";
var tmuxPath = null;
var tmuxChecked = false;
var storedConfig = null;
var serverAvailable = null;
var serverCheckUrl = null;
async function spawnAsync(command, options) {
  return new Promise((resolve) => {
    const [cmd, ...args] = command;
    const proc = spawn(cmd, args, { stdio: "pipe" });
    let stdout = "";
    let stderr = "";
    if (!options?.ignoreOutput) {
      proc.stdout?.on("data", (data) => {
        stdout += data.toString();
      });
      proc.stderr?.on("data", (data) => {
        stderr += data.toString();
      });
    }
    proc.on("close", (code) => {
      resolve({
        exitCode: code ?? 1,
        stdout,
        stderr
      });
    });
    proc.on("error", () => {
      resolve({
        exitCode: 1,
        stdout,
        stderr
      });
    });
  });
}
async function isServerRunning(serverUrl) {
  if (serverCheckUrl === serverUrl && serverAvailable === true) {
    return true;
  }
  const healthUrl = new URL("/health", serverUrl).toString();
  const timeoutMs = 3e3;
  const maxAttempts = 2;
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), timeoutMs);
    let response = null;
    try {
      response = await fetch(healthUrl, { signal: controller.signal }).catch(
        () => null
      );
    } finally {
      clearTimeout(timeout);
    }
    const available = response?.ok ?? false;
    if (available) {
      serverCheckUrl = serverUrl;
      serverAvailable = true;
      log("[tmux] isServerRunning: checked", { serverUrl, available, attempt });
      return true;
    }
    if (attempt < maxAttempts) {
      await new Promise((r) => setTimeout(r, 250));
    }
  }
  log("[tmux] isServerRunning: checked", { serverUrl, available: false });
  return false;
}
async function findTmuxPath() {
  const isWindows = process.platform === "win32";
  const cmd = isWindows ? "where" : "which";
  try {
    const result = await spawnAsync([cmd, "tmux"]);
    if (result.exitCode !== 0) {
      log("[tmux] findTmuxPath: 'which tmux' failed", {
        exitCode: result.exitCode
      });
      return null;
    }
    const path3 = result.stdout.trim().split("\n")[0];
    if (!path3) {
      log("[tmux] findTmuxPath: no path in output");
      return null;
    }
    const verifyResult = await spawnAsync([path3, "-V"]);
    if (verifyResult.exitCode !== 0) {
      log("[tmux] findTmuxPath: tmux -V failed", {
        path: path3,
        verifyExit: verifyResult.exitCode
      });
      return null;
    }
    log("[tmux] findTmuxPath: found tmux", { path: path3 });
    return path3;
  } catch (err) {
    log("[tmux] findTmuxPath: exception", { error: String(err) });
    return null;
  }
}
async function getTmuxPath() {
  if (tmuxChecked) {
    return tmuxPath;
  }
  tmuxPath = await findTmuxPath();
  tmuxChecked = true;
  log("[tmux] getTmuxPath: initialized", { tmuxPath });
  return tmuxPath;
}
function isInsideTmux() {
  return !!process.env.TMUX;
}
async function applyLayout(tmux, layout, mainPaneSize) {
  try {
    await spawnAsync([tmux, "select-layout", layout]);
    if (layout === "main-horizontal" || layout === "main-vertical") {
      const sizeOption = layout === "main-horizontal" ? "main-pane-height" : "main-pane-width";
      await spawnAsync([
        tmux,
        "set-window-option",
        sizeOption,
        `${mainPaneSize}%`
      ]);
      await spawnAsync([tmux, "select-layout", layout]);
    }
    log("[tmux] applyLayout: applied", { layout, mainPaneSize });
  } catch (err) {
    log("[tmux] applyLayout: exception", { error: String(err) });
  }
}
async function spawnTmuxPane(sessionId, description, config, serverUrl) {
  log("[tmux] spawnTmuxPane called", {
    sessionId,
    description,
    config,
    serverUrl
  });
  if (!config.enabled) {
    log("[tmux] spawnTmuxPane: config.enabled is false, skipping");
    return { success: false };
  }
  if (!isInsideTmux()) {
    log("[tmux] spawnTmuxPane: not inside tmux, skipping");
    return { success: false };
  }
  const serverRunning = await isServerRunning(serverUrl);
  if (!serverRunning) {
    const defaultPort = process.env.OPENCODE_PORT ?? "4096";
    log("[tmux] spawnTmuxPane: OpenCode server not running, skipping", {
      serverUrl,
      hint: `Start opencode with --port ${defaultPort}`
    });
    return { success: false };
  }
  const tmux = await getTmuxPath();
  if (!tmux) {
    log("[tmux] spawnTmuxPane: tmux binary not found, skipping");
    return { success: false };
  }
  storedConfig = config;
  try {
    const opencodeCmd = `opencode attach ${serverUrl} --session ${sessionId}`;
    const args = [
      "split-window",
      "-h",
      "-d",
      "-P",
      "-F",
      "#{pane_id}",
      opencodeCmd
    ];
    log("[tmux] spawnTmuxPane: executing", { tmux, args, opencodeCmd });
    const result = await spawnAsync([tmux, ...args]);
    const paneId = result.stdout.trim();
    log("[tmux] spawnTmuxPane: split result", {
      exitCode: result.exitCode,
      paneId,
      stderr: result.stderr.trim()
    });
    if (result.exitCode === 0 && paneId) {
      await spawnAsync(
        [tmux, "select-pane", "-t", paneId, "-T", description.slice(0, 30)],
        { ignoreOutput: true }
      );
      const layout = config.layout ?? "main-vertical";
      const mainPaneSize = config.main_pane_size ?? 60;
      await applyLayout(tmux, layout, mainPaneSize);
      log("[tmux] spawnTmuxPane: SUCCESS, pane created and layout applied", {
        paneId,
        layout
      });
      return { success: true, paneId };
    }
    return { success: false };
  } catch (err) {
    log("[tmux] spawnTmuxPane: exception", { error: String(err) });
    return { success: false };
  }
}
async function closeTmuxPane(paneId) {
  log("[tmux] closeTmuxPane called", { paneId });
  if (!paneId) {
    log("[tmux] closeTmuxPane: no paneId provided");
    return false;
  }
  const tmux = await getTmuxPath();
  if (!tmux) {
    log("[tmux] closeTmuxPane: tmux binary not found");
    return false;
  }
  try {
    const result = await spawnAsync([tmux, "kill-pane", "-t", paneId]);
    log("[tmux] closeTmuxPane: result", {
      exitCode: result.exitCode,
      stderr: result.stderr.trim()
    });
    if (result.exitCode === 0) {
      log("[tmux] closeTmuxPane: SUCCESS, pane closed", { paneId });
      if (storedConfig) {
        const layout = storedConfig.layout ?? "main-vertical";
        const mainPaneSize = storedConfig.main_pane_size ?? 60;
        await applyLayout(tmux, layout, mainPaneSize);
        log("[tmux] closeTmuxPane: layout reapplied", { layout });
      }
      return true;
    }
    log("[tmux] closeTmuxPane: failed (pane may already be closed)", {
      paneId
    });
    return false;
  } catch (err) {
    log("[tmux] closeTmuxPane: exception", { error: String(err) });
    return false;
  }
}
function startTmuxCheck() {
  if (!tmuxChecked) {
    getTmuxPath().catch(() => {
    });
  }
}

// src/tmux-session-manager.ts
var TmuxSessionManager = class {
  client;
  tmuxConfig;
  serverUrl;
  sessions = /* @__PURE__ */ new Map();
  pollInterval;
  enabled = false;
  constructor(ctx, tmuxConfig, serverUrl) {
    this.client = ctx.client;
    this.tmuxConfig = tmuxConfig;
    this.serverUrl = serverUrl;
    this.enabled = tmuxConfig.enabled && isInsideTmux();
    log("[tmux-session-manager] initialized", {
      enabled: this.enabled,
      tmuxConfig: this.tmuxConfig,
      serverUrl: this.serverUrl
    });
  }
  async onSessionCreated(event) {
    if (!this.enabled) return;
    if (event.type !== "session.created") return;
    const info = event.properties?.info;
    if (!info?.id || !info?.parentID) {
      return;
    }
    const sessionId = info.id;
    const parentId = info.parentID;
    const title = info.title ?? "Subagent";
    if (this.sessions.has(sessionId)) {
      log("[tmux-session-manager] session already tracked", { sessionId });
      return;
    }
    log("[tmux-session-manager] child session created, spawning pane", {
      sessionId,
      parentId,
      title
    });
    const paneResult = await spawnTmuxPane(
      sessionId,
      title,
      this.tmuxConfig,
      this.serverUrl
    ).catch((err) => {
      log("[tmux-session-manager] failed to spawn pane", {
        error: String(err)
      });
      return { success: false, paneId: void 0 };
    });
    if (paneResult.success && paneResult.paneId) {
      const now = Date.now();
      this.sessions.set(sessionId, {
        sessionId,
        paneId: paneResult.paneId,
        parentId,
        title,
        createdAt: now,
        lastSeenAt: now
      });
      log("[tmux-session-manager] pane spawned", {
        sessionId,
        paneId: paneResult.paneId
      });
      this.startPolling();
    }
  }
  startPolling() {
    if (this.pollInterval) return;
    this.pollInterval = setInterval(
      () => this.pollSessions(),
      POLL_INTERVAL_MS
    );
    log("[tmux-session-manager] polling started");
  }
  stopPolling() {
    if (this.pollInterval) {
      clearInterval(this.pollInterval);
      this.pollInterval = void 0;
      log("[tmux-session-manager] polling stopped");
    }
  }
  async pollSessions() {
    if (this.sessions.size === 0) {
      this.stopPolling();
      return;
    }
    try {
      const statusResult = await this.client.session.status();
      const allStatuses = statusResult.data ?? {};
      const now = Date.now();
      const sessionsToClose = [];
      for (const [sessionId, tracked] of this.sessions.entries()) {
        const status = allStatuses[sessionId];
        const isIdle = status?.type === "idle";
        if (status) {
          tracked.lastSeenAt = now;
          tracked.missingSince = void 0;
        } else if (!tracked.missingSince) {
          tracked.missingSince = now;
        }
        const missingTooLong = !!tracked.missingSince && now - tracked.missingSince >= SESSION_MISSING_GRACE_MS;
        const isTimedOut = now - tracked.createdAt > SESSION_TIMEOUT_MS;
        if (isIdle || missingTooLong || isTimedOut) {
          sessionsToClose.push(sessionId);
        }
      }
      for (const sessionId of sessionsToClose) {
        await this.closeSession(sessionId);
      }
    } catch (err) {
      log("[tmux-session-manager] poll error", { error: String(err) });
    }
  }
  async closeSession(sessionId) {
    const tracked = this.sessions.get(sessionId);
    if (!tracked) return;
    log("[tmux-session-manager] closing session pane", {
      sessionId,
      paneId: tracked.paneId
    });
    await closeTmuxPane(tracked.paneId);
    this.sessions.delete(sessionId);
    if (this.sessions.size === 0) {
      this.stopPolling();
    }
  }
  createEventHandler() {
    return async (input) => {
      await this.onSessionCreated(input.event);
    };
  }
  async cleanup() {
    this.stopPolling();
    if (this.sessions.size > 0) {
      log("[tmux-session-manager] closing all panes", {
        count: this.sessions.size
      });
      const closePromises = Array.from(this.sessions.values()).map(
        (s) => closeTmuxPane(s.paneId).catch(
          (err) => log("[tmux-session-manager] cleanup error for pane", {
            paneId: s.paneId,
            error: String(err)
          })
        )
      );
      await Promise.all(closePromises);
      this.sessions.clear();
    }
    log("[tmux-session-manager] cleanup complete");
  }
};

// src/index.ts
function detectServerUrl() {
  if (process.env.OPENCODE_PORT) {
    return `http://localhost:${process.env.OPENCODE_PORT}`;
  }
  return "http://localhost:4096";
}
function loadConfig(directory) {
  const configPaths = [
    path2.join(directory, "opencode-agent-tmux.json"),
    path2.join(
      process.env.HOME ?? "",
      ".config",
      "opencode",
      "opencode-agent-tmux.json"
    )
  ];
  for (const configPath of configPaths) {
    try {
      if (fs2.existsSync(configPath)) {
        const content = fs2.readFileSync(configPath, "utf-8");
        const parsed = JSON.parse(content);
        const result = PluginConfigSchema.safeParse(parsed);
        if (result.success) {
          log("[plugin] loaded config", { configPath, config: result.data });
          return result.data;
        }
        log("[plugin] config parse error", {
          configPath,
          error: result.error.message
        });
      }
    } catch (err) {
      log("[plugin] config load error", { configPath, error: String(err) });
    }
  }
  const defaultConfig = PluginConfigSchema.parse({});
  log("[plugin] using default config", { config: defaultConfig });
  return defaultConfig;
}
var OpencodeAgentTmux = async (ctx) => {
  const config = loadConfig(ctx.directory);
  const tmuxConfig = {
    enabled: config.enabled,
    layout: config.layout,
    main_pane_size: config.main_pane_size
  };
  const serverUrl = ctx.serverUrl?.toString() || detectServerUrl();
  log("[plugin] initialized", {
    tmuxConfig,
    directory: ctx.directory,
    serverUrl
  });
  if (tmuxConfig.enabled) {
    startTmuxCheck();
  }
  const tmuxSessionManager = new TmuxSessionManager(ctx, tmuxConfig, serverUrl);
  return {
    name: "opencode-agent-tmux",
    event: async (input) => {
      await tmuxSessionManager.onSessionCreated(
        input.event
      );
    }
  };
};
var src_default = OpencodeAgentTmux;
export {
  src_default as default
};
