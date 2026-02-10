#!/usr/bin/env node

import { spawn } from 'node:child_process';
import { resolveGoBinary } from '../utils/go-runtime';

async function main(): Promise<void> {
  const goCli = resolveGoBinary('opentmux');
  if (!goCli) {
    await import('./opentmux-legacy');
    return;
  }

  const args = process.argv.slice(2);
  const child = spawn(goCli, args, {
    stdio: 'inherit',
    env: process.env,
  });

  child.on('close', (code) => {
    process.exit(code ?? 0);
  });

  child.on('error', (err) => {
    console.error(err);
    process.exit(1);
  });
}

void main();
