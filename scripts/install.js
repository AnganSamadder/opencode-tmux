#!/usr/bin/env node

const fs = require('fs');
const path = require('path');
const os = require('os');

const PLUGIN_DIR = path.resolve(__dirname, '..');
const WRAPPER_PATH = path.join(PLUGIN_DIR, 'bin', 'opencode-tmux');
const HOME = os.homedir();

function detectShell() {
  const shell = process.env.SHELL || '';
  
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

function getAliasLine() {
  return `alias opencode='${WRAPPER_PATH}'`;
}

function getExportLine() {
  return `export OPENCODE_PORT=4096`;
}

function setupAlias() {
  const shell = detectShell();
  
  console.log('');
  console.log('🔧 Setting up opencode-agent-tmux auto-launcher...');
  console.log(`   Detected shell: ${shell.name}`);
  console.log(`   Config file: ${shell.rcFile}`);
  
  if (!fs.existsSync(shell.rcFile)) {
    console.log(`   Creating ${shell.rcFile}...`);
    fs.writeFileSync(shell.rcFile, '', 'utf-8');
  }
  
  let rcContent = fs.readFileSync(shell.rcFile, 'utf-8');
  const aliasLine = getAliasLine();
  const exportLine = getExportLine();
  
  const MARKER_START = '# >>> opencode-agent-tmux >>>';
  const MARKER_END = '# <<< opencode-agent-tmux <<<';
  
  // Clean up old subagent-tmux alias if it exists
  const OLD_MARKER_START = '# >>> opencode-subagent-tmux >>>';
  const OLD_MARKER_END = '# <<< opencode-subagent-tmux <<<';
  
  if (rcContent.includes(OLD_MARKER_START)) {
    console.log('   Removing old opencode-subagent-tmux alias...');
    const regex = new RegExp(`${OLD_MARKER_START}[\\s\\S]*?${OLD_MARKER_END}\\n?`, 'g');
    const newContent = rcContent.replace(regex, '');
    fs.writeFileSync(shell.rcFile, newContent, 'utf-8');
    console.log('   ✓ Removed old alias');
    // Reload content
    rcContent = fs.readFileSync(shell.rcFile, 'utf-8');
  }
  
  if (rcContent.includes(MARKER_START)) {
    console.log('   ✓ Auto-launcher already configured');
    return;
  }
  
  const configBlock = `
${MARKER_START}
${exportLine}
${aliasLine}
${MARKER_END}
`;
  
  fs.appendFileSync(shell.rcFile, configBlock);
  
  console.log('   ✓ Auto-launcher configured successfully!');
  console.log('');
  console.log('   To activate now, run:');
  console.log(`   source ${shell.rcFile}`);
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
  console.error('⚠️  Failed to auto-configure shell alias:', error.message);
  console.error('');
  console.error('   You can manually add this to your shell config:');
  console.error(`   ${getAliasLine()}`);
  console.error('');
  process.exit(0);
}
