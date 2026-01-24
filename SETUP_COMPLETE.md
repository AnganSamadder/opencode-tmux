# OpenCode Agent Tmux Plugin - Setup Complete! ✅

## What You Have Now

A fully working OpenCode plugin that:
- ✅ Automatically spawns tmux panes for agents
- ✅ Shows live streaming output from each agent
- ✅ Auto-closes panes when agents finish
- ✅ Supports multiple OpenCode instances with auto-port detection
- ✅ Auto-installs shell alias for easy launching

## Quick Start

### 1. Activate the Shell Alias

```bash
source ~/.zshrc
```

### 2. Launch OpenCode

```bash
opencode
```

That's it! The wrapper will:
- Launch tmux automatically (if not already in it)
- Find an available port (4096, 4097, 4098, etc.)
- Start OpenCode with the correct configuration

### 3. Test It

Paste this into OpenCode:

```
I need you to help me test the opencode-agent-tmux plugin.

Please launch 3 agents in parallel using the call_omo_agent tool with run_in_background=true:

1. Explorer Agent: Search the current directory for all TypeScript files
2. Explorer Agent: Find all configuration files (JSON, YAML)
3. Librarian Agent: Search GitHub for OpenCode plugin examples

Launch these in parallel and report the task IDs.
```

**Expected result:** You'll see 3 new tmux panes appear, each streaming an agent's output!

## Multi-Instance Support

Want to run multiple OpenCode sessions simultaneously?

```bash
# Terminal 1
opencode
# → Port 4096

# Terminal 2 
opencode
# → Port 4097 (auto-detected!)

# Terminal 3
opencode
# → Port 4098
```

Each instance works independently with its own tmux panes.

## Files Created

```
~/Code/opencode-agent-tmux/
├── src/
│   ├── index.ts                    # Plugin entry point
│   ├── config.ts                   # Configuration schema
│   ├── types.ts                    # TypeScript types
│   ├── tmux-session-manager.ts     # Core session manager
│   └── utils/
│       ├── tmux.ts                 # Tmux utilities
│       └── logger.ts               # Logging
├── bin/
│   └── opencode-tmux               # Wrapper script (auto-port)
├── scripts/
│   ├── install.sh                  # Auto-setup script
│   └── install.js                  # Node fallback
├── dist/                           # Built plugin
├── package.json
├── tsconfig.json
├── README.md
├── MULTI_PORT.md                   # Multi-port docs
└── TMUX_LAUNCHER.md                # Launcher docs
```

## Configuration Files

### OpenCode Plugin Config
`~/.config/opencode/opencode.json`
- Added plugin path to `plugin` array

### Plugin Settings
`~/.config/opencode/opencode-agent-tmux.json`
```json
{
  "enabled": true,
  "port": 4096,
  "layout": "main-vertical",
  "main_pane_size": 60,
  "auto_close": true
}
```

### Shell Alias
`~/.zshrc`
```bash
# >>> opencode-agent-tmux >>>
export OPENCODE_PORT=4096
alias opencode='/Users/angansamadder/Code/opencode-agent-tmux/bin/opencode-tmux'
# <<< opencode-agent-tmux <<<
```

## Troubleshooting

### Check if it's working

```bash
# 1. Verify alias
which opencode
# Should show: /Users/angansamadder/Code/opencode-agent-tmux/bin/opencode-tmux

# 2. Check logs
tail -f /tmp/opencode-agent-tmux.log

# 3. Test multi-port
./test-multiport.sh
```

### Common Issues

**Panes not spawning?**
- Make sure you're in tmux (check `echo $TMUX`)
- Verify OpenCode server is running
- Check logs for errors

**Port already in use?**
- The wrapper auto-detects and uses next available port
- Check with `lsof -i :4096`

## Next Steps

1. **Test the plugin** with the prompt above
2. **Try multiple instances** in separate terminals
3. **Customize layouts** in `~/.config/opencode/opencode-agent-tmux.json`

Enjoy your live-streaming agent tmux panes! 🚀
