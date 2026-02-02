#!/usr/bin/env node

import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const HOME = os.homedir();

interface ShellConfig {
  name: string;
  rcFile: string;
  dir?: string;
}

function detectShell(): ShellConfig {
  const shell = process.env.SHELL || '';
  const platform = process.platform;
  
  if (platform === 'win32') {
     const documents = path.join(HOME, 'Documents');
     const psDir = path.join(documents, 'PowerShell');
     const psProfile = path.join(psDir, 'Microsoft.PowerShell_profile.ps1');
     return {
         name: 'powershell',
         rcFile: psProfile,
         dir: psDir
     };
  }

  if (shell.includes('zsh')) {
    return { name: 'zsh', rcFile: path.join(HOME, '.zshrc') };
  } else if (shell.includes('bash')) {
    const bashProfile = path.join(HOME, '.bash_profile');
    const bashrc = path.join(HOME, '.bashrc');
    return {
      name: 'bash',
      rcFile: fs.existsSync(bashProfile) ? bashProfile : bashrc
    };
  } else if (shell.includes('fish')) {
    return {
      name: 'fish',
      rcFile: path.join(HOME, '.config', 'fish', 'config.fish')
    };
  }
  
  return { name: 'unknown', rcFile: path.join(HOME, '.profile') };
}

function getAliasContent(shellName: string): string {
  if (shellName === 'powershell') {
    return `
function opencode {
    opencode-tmux $args
}
`;
  }
  
  return `alias opencode='opencode-tmux'`;
}

function getExportLine(): string {
  return `export OPENCODE_PORT=4096`;
}

function setupAlias(): void {
  const shell = detectShell();
  
  console.log('');
  console.log('🔧 Setting up opencode-tmux auto-launcher...');
  console.log(`   Detected shell: ${shell.name}`);
  console.log(`   Config file: ${shell.rcFile}`);
  
  if (shell.name === 'powershell') {
      if (shell.dir && !fs.existsSync(shell.dir)) {
          fs.mkdirSync(shell.dir, { recursive: true });
      }
  }

  if (!fs.existsSync(shell.rcFile)) {
    console.log(`   Creating ${shell.rcFile}...`);
    fs.writeFileSync(shell.rcFile, '', 'utf-8');
  }
  
  let rcContent = fs.readFileSync(shell.rcFile, 'utf-8');
  const aliasContent = getAliasContent(shell.name);
  
  const MARKER_START = '# >>> opencode-tmux >>>';
  const MARKER_END = '# <<< opencode-tmux <<<';
  
  const OLD_MARKER_START = '# >>> opencode-agent-tmux >>>';
  const OLD_MARKER_END = '# <<< opencode-agent-tmux <<<';
  
  const LEGACY_MARKER_START = '# >>> opencode-subagent-tmux >>>';
  const LEGACY_MARKER_END = '# <<< opencode-subagent-tmux <<<';
  
  const escapeRegExp = (string: string) => string.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

  if (rcContent.includes(LEGACY_MARKER_START)) {
    console.log('   Removing legacy opencode-subagent-tmux alias...');
    const regex = new RegExp(`${escapeRegExp(LEGACY_MARKER_START)}[\\s\\S]*?${escapeRegExp(LEGACY_MARKER_END)}\\n?`, 'g');
    rcContent = rcContent.replace(regex, '');
    fs.writeFileSync(shell.rcFile, rcContent, 'utf-8');
    rcContent = fs.readFileSync(shell.rcFile, 'utf-8');
  }

  if (rcContent.includes(OLD_MARKER_START)) {
    console.log('   Updating legacy opencode-agent-tmux alias...');
    console.warn('   Deprecation: Using legacy opencode-agent-tmux markers. Updating to opencode-tmux.');
    const regex = new RegExp(`${escapeRegExp(OLD_MARKER_START)}[\\s\\S]*?${escapeRegExp(OLD_MARKER_END)}\\n?`, 'g');
    rcContent = rcContent.replace(regex, '');
    fs.writeFileSync(shell.rcFile, rcContent, 'utf-8');
    rcContent = fs.readFileSync(shell.rcFile, 'utf-8');
  }

  if (rcContent.includes(MARKER_START)) {
    console.log('   Updating opencode-tmux alias...');
    const regex = new RegExp(`${escapeRegExp(MARKER_START)}[\\s\\S]*?${escapeRegExp(MARKER_END)}\\n?`, 'g');
    
    rcContent = rcContent.replace(regex, '');
    fs.writeFileSync(shell.rcFile, rcContent, 'utf-8');
    rcContent = fs.readFileSync(shell.rcFile, 'utf-8');
  }
  
  let configBlock = '';
  if (shell.name === 'powershell') {
      configBlock = `
${MARKER_START}
$env:OPENCODE_PORT="4096"
${aliasContent}
${MARKER_END}
`;
  } else {
      configBlock = `
${MARKER_START}
${getExportLine()}
${aliasContent}
${MARKER_END}
`;
  }
  
  fs.appendFileSync(shell.rcFile, configBlock);
  
  console.log('   ✓ Auto-launcher configured successfully!');
  console.log('');
  console.log('   To activate now:');
  if (shell.name === 'powershell') {
      console.log(`   . ${shell.rcFile}`);
  } else {
      console.log(`   source ${shell.rcFile}`);
  }
  console.log('');
  console.log('   Or restart your terminal.');
  console.log('');
  console.log('   Usage: Just type "opencode" and tmux + port 4096 will be auto-configured!');
  console.log('');
}

try {
  setupAlias();
} catch (error) {
  console.error('');
  console.error('⚠️  Failed to auto-configure shell alias:', (error as Error).message);
  console.error('');
  process.exit(0);
}
