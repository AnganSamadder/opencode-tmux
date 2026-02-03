import {
  findProcessIds,
  getProcessCommand,
  isProcessAlive,
  safeKill,
  waitForProcessExit,
} from './utils/process';
import { log } from './utils/logger';

export interface ReaperOptions {
  enabled: boolean;
  intervalMs: number;
  minZombieChecks: number;
  gracePeriodMs: number;
  autoSelfDestruct?: boolean;
  selfDestructTimeoutMs?: number;
}

interface ZombieCandidate {
  count: number;
  firstDetectedAt: number;
}

interface AttachProcess {
  pid: number;
  sessionId: string;
  command: string;
  targetUrl: string | null;
}

export class ZombieReaper {
  private serverUrl: string;
  private options: ReaperOptions;
  private pollInterval?: ReturnType<typeof setInterval>;
  private candidates = new Map<number, ZombieCandidate>();
  private isScanning = false;
  private lastActivityTime: number = Date.now();

  constructor(serverUrl: string, options: ReaperOptions) {
    this.serverUrl = serverUrl;
    this.options = options;
  }

  /**
   * Manual global reap command (for CLI).
   * Scans ALL attach processes and checks them against their respective servers.
   */
  static async reapAll(options: Partial<ReaperOptions> = {}): Promise<void> {
    const opts = {
      enabled: true,
      intervalMs: 0,
      minZombieChecks: 0, // Instant kill for CLI (manual)
      gracePeriodMs: 0,   // No grace for manual reap
      ...options
    } as ReaperOptions;

    log('[zombie-reaper] starting manual global reap');
    const reaper = new ZombieReaper('', opts); // Dummy URL, we won't use instance scan
    const processes = await reaper.findAllAttachProcesses();

    if (processes.length === 0) {
      console.log('No opencode attach processes found.');
      return;
    }

    console.log(`Found ${processes.length} attach processes. Checking statuses...`);
    
    // Group by URL to batch requests
    const byUrl = new Map<string, AttachProcess[]>();
    for (const p of processes) {
      const url = p.targetUrl || 'unknown';
      const arr = byUrl.get(url) || [];
      arr.push(p);
      byUrl.set(url, arr);
    }

    let reapedCount = 0;

    for (const [url, procs] of byUrl.entries()) {
      if (url === 'unknown') {
        console.log(`⚠️  Skipping ${procs.length} processes with unknown target URL`);
        continue;
      }

      // Fetch sessions for this URL
      let activeSessions: Set<string> | null = null;
      try {
        activeSessions = await reaper.fetchActiveSessions(url);
      } catch (err) {
        // If server is explicitly refused/down, assume all its clients are zombies
        // BUT verify it's actually down (fetch throws) vs just empty
        // fetchActiveSessions returns null on error
      }

      if (activeSessions === null) {
         // Server unreachable.
         // For manual reap, if server is dead, clients are zombies.
         // Let's kill them but warn.
         console.log(`Server ${url} unreachable. Treating ${procs.length} clients as orphans.`);
         for (const p of procs) {
           await reaper.forceKill(p.pid);
           reapedCount++;
         }
         continue;
      }

      for (const p of procs) {
        if (!activeSessions.has(p.sessionId)) {
          console.log(`🧟 Zombie detected: PID ${p.pid} (Session ${p.sessionId} on ${url})`);
          await reaper.forceKill(p.pid);
          reapedCount++;
        } else {
          // console.log(`✅ Active: PID ${p.pid} (Session ${p.sessionId})`);
        }
      }
    }
    
    console.log(`Reap complete. Killed ${reapedCount} zombies.`);
  }

  private async forceKill(pid: number): Promise<void> {
     // Direct kill for CLI
     try {
       process.kill(pid, 'SIGTERM');
       // await waitForProcessExit... but for CLI we might just fire and forget or wait briefly
     } catch {}
  }

  start(): void {
    if (!this.options.enabled) return;
    if (this.pollInterval) return;

    log('[zombie-reaper] starting', this.options);
    this.pollInterval = setInterval(() => this.scanOnce(), this.options.intervalMs);
  }

  stop(): void {
    if (this.pollInterval) {
      clearInterval(this.pollInterval);
      this.pollInterval = undefined;
      log('[zombie-reaper] stopped');
    }
  }

  async shutdown(): Promise<void> {
    this.stop();
    log('[zombie-reaper] shutting down, running final scan');
    await this.scanOnce();
  }

  async scanOnce(): Promise<void> {
    if (this.isScanning) return;
    this.isScanning = true;

    try {
      const processes = await this.findAllAttachProcesses();
      if (processes.length === 0) {
        this.candidates.clear();
        return;
      }

      // Filter processes that belong to THIS server
      const myProcesses = processes.filter(p => this.areUrlsEqual(p.targetUrl, this.serverUrl));
      
      if (myProcesses.length > 0) {
        this.lastActivityTime = Date.now();
      } else {
        // No active clients connected to this server
        if (this.options.autoSelfDestruct && this.options.selfDestructTimeoutMs) {
          const idleTime = Date.now() - this.lastActivityTime;
          if (idleTime > this.options.selfDestructTimeoutMs) {
            log('[zombie-reaper] Server abandoned (no clients). Self-destructing.', { 
              idleTimeMs: idleTime,
              timeoutMs: this.options.selfDestructTimeoutMs
            });
            process.exit(0);
          }
        }
      }
      
      if (myProcesses.length === 0) {
        // No processes for this server, clear candidates for safety
        // (Actually, we should only clear candidates that belong to this server, but 
        //  since we filter candidates by PID, and PIDs are unique, it's fine)
        //  Wait, if a PID was tracked but now isn't in myProcesses (e.g. reattached to another port?),
        //  we should drop it.
        //  Simplest: prune candidates that aren't in `myProcesses`.
        this.pruneCandidates(new Set());
        return;
      }

      // Fetch active sessions from server
      const activeSessions = await this.fetchActiveSessions(this.serverUrl);
      if (activeSessions === null) {
        log('[zombie-reaper] server unreachable, skipping scan');
        return;
      }

      const currentPids = new Set<number>();

      for (const proc of myProcesses) {
        currentPids.add(proc.pid);
        
        const isZombie = !activeSessions.has(proc.sessionId);
        
        if (isZombie) {
          this.markAsZombie(proc.pid);
          
          if (this.shouldKill(proc.pid)) {
            await this.reapProcess(proc);
          }
        } else {
          // It's active, remove from candidates if it was there
          if (this.candidates.has(proc.pid)) {
            this.candidates.delete(proc.pid);
          }
        }
      }

      this.pruneCandidates(currentPids);

    } catch (err) {
      log('[zombie-reaper] scan error', { error: String(err) });
    } finally {
      this.isScanning = false;
    }
  }

  private pruneCandidates(currentPids: Set<number>) {
      // Cleanup candidates that no longer exist (or are no longer relevant to this server)
      for (const pid of this.candidates.keys()) {
        if (!currentPids.has(pid)) {
          this.candidates.delete(pid);
        }
      }
  }

  private areUrlsEqual(url1: string | null, url2: string): boolean {
    if (!url1) return false;
    try {
      // Helper to normalize URL strings
      const normalize = (u: string) => {
        // Add protocol if missing
        if (!u.match(/^https?:\/\//)) {
          u = `http://${u}`;
        }
        const urlObj = new URL(u);
        // Normalize localhost to 127.0.0.1 for comparison
        if (urlObj.hostname === 'localhost') {
          urlObj.hostname = '127.0.0.1';
        }
        return urlObj.origin;
      };

      return normalize(url1) === normalize(url2);
    } catch {
      return url1 === url2;
    }
  }

  async findAllAttachProcesses(): Promise<AttachProcess[]> {
    const pids = findProcessIds('opencode attach');
    const results: AttachProcess[] = [];

    for (const pid of pids) {
      const command = getProcessCommand(pid);
      if (!command) continue;

      // Extract session ID
      const sessionMatch = command.match(/--session\s+([a-zA-Z0-9_-]+)/);
      
      // Extract URL. We want the first non-flag argument after 'attach'.
      // If the command follows our pattern: opencode attach <url> --session ...
      // Then <url> is immediate.
      // But we should be robust against: opencode attach --session ... <url> (if that was valid)
      // The current tmux.ts ALWAYS puts URL first: `opencode attach ${serverUrl} ...`
      // So we can just capture the first token after attach.
      // We removed the hardcoded 'http://' prefix requirement.
      const urlMatch = command.match(/attach\s+([^\s]+)/);

      if (sessionMatch && sessionMatch[1]) {
        results.push({
          pid,
          sessionId: sessionMatch[1],
          targetUrl: urlMatch ? urlMatch[1] : null,
          command,
        });
      }
    }

    return results;
  }

  // Exposed for testing
  async classifyProcess(sessionId: string): Promise<'active' | 'zombie' | 'unknown'> {
    const activeSessions = await this.fetchActiveSessions(this.serverUrl);
    if (activeSessions === null) return 'unknown';
    return activeSessions.has(sessionId) ? 'active' : 'zombie';
  }

  private async fetchActiveSessions(url: string): Promise<Set<string> | null> {
    const statusUrl = new URL('/session/status', url).toString();
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 2000);

    try {
      const response = await fetch(statusUrl, { signal: controller.signal }).catch(() => null);
      if (!response?.ok) return null;

      const payload = (await response.json().catch(() => null)) as unknown;
      if (!payload || typeof payload !== 'object') return null;

      const data = (payload as { data?: unknown }).data;
      if (!data || typeof data !== 'object') return null;

      if (Array.isArray(data)) {
         return new Set(); 
      }
      
      return new Set(Object.keys(data));
    } catch {
      return null;
    } finally {
      clearTimeout(timeout);
    }
  }

  markAsZombie(pid: number): void {
    const candidate = this.candidates.get(pid);
    if (candidate) {
      candidate.count++;
    } else {
      this.candidates.set(pid, {
        count: 1,
        firstDetectedAt: Date.now(),
      });
    }
  }

  shouldKill(pid: number): boolean {
    const candidate = this.candidates.get(pid);
    if (!candidate) return false;

    const meetsCount = candidate.count >= this.options.minZombieChecks;
    const meetsGrace = Date.now() - candidate.firstDetectedAt >= this.options.gracePeriodMs;

    return meetsCount && meetsGrace;
  }

  private async reapProcess(proc: AttachProcess): Promise<void> {
    log('[zombie-reaper] REAPING ZOMBIE', { pid: proc.pid, sessionId: proc.sessionId });
    
    safeKill(proc.pid, 'SIGTERM');
    const exited = await waitForProcessExit(proc.pid, 2000);
    
    if (!exited) {
      log('[zombie-reaper] force killing zombie', { pid: proc.pid });
      safeKill(proc.pid, 'SIGKILL');
    }
    
    this.candidates.delete(proc.pid);
  }
}
