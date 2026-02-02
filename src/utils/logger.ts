import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

const NEW_LOG_FILE = path.join(os.tmpdir(), 'opencode-tmux.log');
const OLD_LOG_FILE = path.join(os.tmpdir(), 'opencode-agent-tmux.log');

function getLogFile(): string {
  if (fs.existsSync(NEW_LOG_FILE)) {
    return NEW_LOG_FILE;
  }
  if (fs.existsSync(OLD_LOG_FILE)) {
    console.warn(
      'Deprecation: Using legacy opencode-agent-tmux log file. Please update to @angansamadder/opencode-tmux',
    );
    return OLD_LOG_FILE;
  }
  return NEW_LOG_FILE;
}

const logFile = getLogFile();

export function log(message: string, data?: unknown): void {
  try {
    const timestamp = new Date().toISOString();
    const logEntry = `[${timestamp}] ${message} ${
      data ? JSON.stringify(data) : ''
    }\n`;
    fs.appendFileSync(logFile, logEntry);
  } catch {
    // Silently ignore logging errors
  }
}
