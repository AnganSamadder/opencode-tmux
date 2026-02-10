import { execFile, spawn, type ChildProcess } from 'node:child_process';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';

const EXEC_TIMEOUT_MS = 15_000;

type GoBinaryName = 'opentmux' | 'opentmuxd' | 'opentmuxctl';

function binarySuffix(): string {
  return process.platform === 'win32' ? '.exe' : '';
}

function runtimeTag(): string {
  const arch = process.arch === 'x64' ? 'amd64' : process.arch === 'arm64' ? 'arm64' : process.arch;
  const platform = process.platform === 'darwin' ? 'darwin' : process.platform === 'win32' ? 'windows' : process.platform;
  return `${platform}-${arch}`;
}

function existsAndExecutable(filePath: string): boolean {
  try {
    fs.accessSync(filePath, fs.constants.X_OK);
    return true;
  } catch {
    return false;
  }
}

function moduleRoot(): string {
  const here = path.dirname(fileURLToPath(import.meta.url));
  return path.resolve(here, '..', '..');
}

export function resolveGoBinary(name: GoBinaryName): string | null {
  const suffix = binarySuffix();
  const explicit = process.env[`OPENTMUX_GO_${name.toUpperCase()}_BIN`];
  if (explicit && existsAndExecutable(explicit)) {
    return explicit;
  }

  const binDir = process.env.OPENTMUX_GO_BIN_DIR;
  if (binDir) {
    const candidate = path.join(binDir, `${name}${suffix}`);
    if (existsAndExecutable(candidate)) {
      return candidate;
    }
  }

  const root = moduleRoot();
  const localBuild = path.join(root, 'bin', `${name}${suffix}`);
  if (existsAndExecutable(localBuild)) {
    return localBuild;
  }

  const runtimeDirs = [
    path.join(root, 'dist', 'runtime', runtimeTag()),
    path.join(root, 'runtime', runtimeTag()),
  ];
  for (const runtimeDir of runtimeDirs) {
    const runtimeBuild = path.join(runtimeDir, `${name}${suffix}`);
    if (existsAndExecutable(runtimeBuild)) {
      return runtimeBuild;
    }
  }

  return null;
}

export interface ExecResult {
  success: boolean;
  code: number;
  stdout: string;
  stderr: string;
  error?: string;
}

export function execGoBinary(binaryPath: string, args: string[]): Promise<ExecResult> {
  return new Promise((resolve) => {
    execFile(binaryPath, args, { timeout: EXEC_TIMEOUT_MS }, (error, stdout, stderr) => {
      if (error) {
        const code = (error as NodeJS.ErrnoException & { code?: number }).code;
        resolve({
          success: false,
          code: typeof code === 'number' ? code : 1,
          stdout: stdout?.toString() ?? '',
          stderr: stderr?.toString() ?? '',
          error: String(error),
        });
        return;
      }
      resolve({
        success: true,
        code: 0,
        stdout: stdout?.toString() ?? '',
        stderr: stderr?.toString() ?? '',
      });
    });
  });
}

export function spawnGoBinary(binaryPath: string, args: string[], options?: { detached?: boolean; stdio?: 'inherit' | 'ignore' }): ChildProcess {
  return spawn(binaryPath, args, {
    detached: options?.detached ?? false,
    stdio: options?.stdio ?? 'ignore',
    env: process.env,
  });
}

export function defaultSocketPath(): string {
  return path.join(os.tmpdir(), `opentmuxd-${process.pid}.sock`);
}
