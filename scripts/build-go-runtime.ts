#!/usr/bin/env bun

import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

const cwd = process.cwd();
const suffix = (osName: string) => (osName === 'windows' ? '.exe' : '');

interface Target {
  os: string;
  arch: string;
}

const defaultTargets: Target[] = [
  { os: os.platform() === 'darwin' ? 'darwin' : os.platform() === 'win32' ? 'windows' : 'linux', arch: os.arch() === 'x64' ? 'amd64' : os.arch() === 'arm64' ? 'arm64' : os.arch() },
];

const releaseTargets: Target[] = [
  { os: 'darwin', arch: 'arm64' },
  { os: 'darwin', arch: 'amd64' },
  { os: 'linux', arch: 'amd64' },
  { os: 'linux', arch: 'arm64' },
  { os: 'windows', arch: 'amd64' },
];

const targets = process.env.OPENTMUX_GO_RELEASE === '1' ? releaseTargets : defaultTargets;
const binaries = ['opentmux', 'opentmuxd', 'opentmuxctl'] as const;

function run(cmd: string[], env: Record<string, string>): void {
  const proc = Bun.spawnSync(cmd, {
    cwd,
    stdout: 'inherit',
    stderr: 'inherit',
    env: { ...process.env, ...env },
  });
  if (proc.exitCode !== 0) {
    throw new Error(`command failed: ${cmd.join(' ')}`);
  }
}

function build(): void {
  const runtimeDir = path.join(cwd, 'dist', 'runtime');
  fs.rmSync(runtimeDir, { recursive: true, force: true });

  for (const target of targets) {
    const outDir = path.join(runtimeDir, `${target.os}-${target.arch}`);
    fs.mkdirSync(outDir, { recursive: true });

    for (const bin of binaries) {
      const outPath = path.join(outDir, `${bin}${suffix(target.os)}`);
      run(
        ['go', 'build', '-trimpath', '-ldflags=-s -w', '-o', outPath, `./cmd/${bin}`],
        {
          GOOS: target.os,
          GOARCH: target.arch,
          CGO_ENABLED: '0',
        },
      );
    }
  }

  const localBinDir = path.join(cwd, 'bin');
  fs.mkdirSync(localBinDir, { recursive: true });
  const localTag = `${defaultTargets[0].os}-${defaultTargets[0].arch}`;
  const localRuntimeDir = path.join(runtimeDir, localTag);

  for (const bin of binaries) {
    const from = path.join(localRuntimeDir, `${bin}${suffix(defaultTargets[0].os)}`);
    const to = path.join(localBinDir, `${bin}${suffix(defaultTargets[0].os)}`);
    fs.copyFileSync(from, to);
    fs.chmodSync(to, 0o755);
  }
}

build();
