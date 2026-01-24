# OpenCode Tmux Auto-Launcher Setup

## What This Does

The wrapper script automatically:
- Detects if you're already in tmux
- If not in tmux: launches tmux first, then starts opencode
- If in tmux: just starts opencode normally
- Always uses port 4096 by default

## Installation

### Option 1: Shell Alias (Recommended)

Add this to your `~/.zshrc`:

```bash
# OpenCode with automatic tmux launching
alias opencode='/Users/angansamadder/Code/opencode-agent-tmux/bin/opencode-tmux'
```

Then reload your shell:
```bash
source ~/.zshrc
```

### Option 2: Add to PATH

```bash
# Add to ~/.zshrc
export PATH="/Users/angansamadder/Code/opencode-agent-tmux/bin:$PATH"

# Rename the wrapper to 'opencode' (this overrides the real opencode command)
mv /Users/angansamadder/Code/opencode-agent-tmux/bin/opencode-tmux \
   /Users/angansamadder/Code/opencode-agent-tmux/bin/opencode
```

## Usage

After setup, just type:

```bash
opencode
```

It will automatically:
1. Launch tmux (if not already in it)
2. Start OpenCode with `--port 4096`
3. Enable the agent-tmux plugin to work properly

## Custom Port

Set a different port:

```bash
OPENCODE_PORT=8080 opencode
```

Or export it in your `~/.zshrc`:

```bash
export OPENCODE_PORT=4096
```

## How It Works

The wrapper script:
1. Checks `$TMUX` environment variable
2. If not set: runs `tmux new-session "opencode --port 4096"`
3. If set: runs `opencode --port 4096` directly

This ensures the plugin can always spawn panes since OpenCode is guaranteed to be running inside tmux.
