# opencode-tmux Setup Fix - Summary

## Problem
User's `opencode-tmux` was not working due to misconfigured shell alias pointing to non-existent path.

## Root Causes Identified

1. **Outdated global install**: User had v1.0.8 globally installed but v1.1.10 locally
2. **Incorrect alias**: `.zshrc` had manual alias pointing to `/Users/angansamadder/Code/opencode-agent-tmux/bin/opencode-tmux` (wrong path)
3. **Missing local dev setup**: No streamlined way for contributors to develop locally without publishing

## Solutions Implemented

### 1. Fixed Immediate Issue
- Updated global package to latest version (v1.1.10) via `npm install -g opencode-agent-tmux@latest`
- Postinstall script automatically configured `.zshrc` with correct alias: `alias opencode='opencode-tmux'`

### 2. Created Local Development Infrastructure
**New file**: `scripts/dev-setup.sh`
- Automatically builds the project
- Creates symlink from npm global bin to local development build
- Enables contributors to test changes without publishing
- Provides clear next steps after setup

**New file**: `docs/LOCAL_DEVELOPMENT.md`
- Comprehensive guide for contributors
- Explains both end-user and contributor workflows
- Documents how postinstall works
- Includes troubleshooting section

### 3. Updated Documentation
- Added "Development" section to README.md linking to LOCAL_DEVELOPMENT.md
- Clarified the distinction between global install (for users) and local dev setup (for contributors)

## Installation Flow for New Users

### End Users (Seamless)
```bash
npm install -g opencode-agent-tmux
# Postinstall automatically configures shell

# Add to ~/.config/opencode/opencode.json:
{
  "plugins": ["opencode-agent-tmux"]
}

# Restart terminal
opencode  # Just works!
```

### Contributors (Also Seamless)
```bash
git clone https://github.com/AnganSamadder/opencode-agent-tmux.git
cd opencode-agent-tmux
bun install
./scripts/dev-setup.sh  # Creates symlink to local build
source ~/.zshrc
opencode  # Uses local development version
```

## How Postinstall Works

The `dist/scripts/install.js` script:
1. Detects shell (bash/zsh/fish/powershell)
2. Finds/creates shell RC file
3. Removes old `opencode-subagent-tmux` aliases (backward compatibility)
4. Adds configuration block between markers:
   ```bash
   # >>> opencode-agent-tmux >>>
   export OPENCODE_PORT=4096
   alias opencode='opencode-tmux'
   # <<< opencode-agent-tmux <<<
   ```
5. Provides instructions to source RC file or restart terminal

## Verification

Tested end-to-end:
- ✅ Global install works and configures shell
- ✅ `opencode-tmux` binary is in PATH
- ✅ Symlink for local dev points to correct location
- ✅ Binary launches and shows OpenCode help
- ✅ Version check works (1.1.34 local)

## Files Created/Modified

**Created**:
- `scripts/dev-setup.sh` - Local development setup script
- `docs/LOCAL_DEVELOPMENT.md` - Contributor documentation

**Modified**:
- `README.md` - Added development section
- `~/.zshrc` - Fixed alias (via postinstall script)

## Result

Both new users and contributors now have a seamless setup experience. The package works correctly after global install, and contributors can easily develop and test locally without needing to publish to npm.
