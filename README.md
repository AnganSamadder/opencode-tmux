# opencode-agent-tmux

OpenCode plugin that provides tmux integration for viewing agent execution in real-time.

## Features

- **Automatic Tmux Pane Spawning**: When any agent starts, automatically spawns a tmux pane
- **Live Streaming**: Each pane runs `opencode attach` to show real-time agent output
- **Auto-Cleanup**: Panes automatically close when agents complete
- **Configurable Layout**: Support multiple tmux layouts (main-vertical, tiled, etc.)
- **Multi-Port Support**: Automatically finds available ports when running multiple instances
- **Agent-Agnostic**: Works with oh-my-opencode, omoc-slim, or vanilla OpenCode

## Installation

### For Humans

Simply copy and paste this command into your terminal:

```bash
# Clone and install with auto-setup
git clone https://github.com/yourusername/opencode-agent-tmux.git ~/Code/opencode-agent-tmux && \
cd ~/Code/opencode-agent-tmux && \
bun install && \
bun run build
```

Then reload your shell:
```bash
source ~/.zshrc  # or ~/.bashrc
```

And update your OpenCode config:
```json
// Add to ~/.config/opencode/opencode.json
{
  "plugin": [
    // ... other plugins
    "/Users/YOUR_USERNAME/Code/opencode-agent-tmux"
  ]
}
```

### For Agents

Copy and paste this prompt to have an agent install it for you:

```
Please install the opencode-agent-tmux plugin for me.

1. Clone the repository to ~/Code/opencode-agent-tmux
2. Run 'bun install' and 'bun run build' inside the directory
3. Add the plugin path to my ~/.config/opencode/opencode.json file
4. Verify the installation by running 'opencode --version'

The plugin repo is: https://github.com/yourusername/opencode-agent-tmux.git
```

## Usage

### Easy Mode (Recommended)

After installation, just type:

```bash
opencode
```

The wrapper automatically:
- Launches tmux if you're not already in it
- Finds an available port (4096-4106) if default is in use
- Starts OpenCode with the available port
- Enables the plugin to spawn panes for agents

### Running Multiple Instances

Want to run multiple OpenCode sessions? No problem:

```bash
# Terminal 1
opencode
# → Starts on port 4096

# Terminal 2
opencode
# → Detects 4096 in use, automatically uses port 4097

# Terminal 3
opencode
# → Uses port 4098
```

Each instance works independently with its own tmux panes!

### Manual Mode

Or start OpenCode inside tmux manually:

```bash
tmux
opencode --port 4096
```

### What Happens

When you trigger agents (e.g., using Task tool, background agents):
1. New tmux panes automatically spawn
2. Each pane shows live streaming output
3. Panes close automatically when agents complete

## Testing

Test with this prompt:

```
I need help analyzing my codebase. Please launch 3 agents in parallel:
1. Search for all TypeScript files
2. Analyze the project structure
3. Check for test files

Work on these in parallel.
```

You should see 3 new tmux panes spawn, each showing live output from a different agent.

## Configuration

Edit `~/.config/opencode/opencode-agent-tmux.json`:

```json
{
  "enabled": true,
  "port": 4096,
  "layout": "main-vertical",
  "main_pane_size": 60,
  "auto_close": true
}
```

### Configuration Options

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `enabled` | boolean | `true` | Enable/disable the plugin |
| `port` | number | `4096` | OpenCode server port |
| `layout` | string | `"main-vertical"` | Tmux layout: `main-horizontal`, `main-vertical`, `tiled`, `even-horizontal`, `even-vertical` |
| `main_pane_size` | number | `60` | Size of main pane (20-80%) |
| `auto_close` | boolean | `true` | Auto-close panes when sessions complete |

## Troubleshooting

### Panes Not Spawning

1. Verify you're inside tmux: `echo $TMUX` should return something
2. Check tmux is installed: `which tmux`
3. Check OpenCode server is running with port: `opencode --port 4096`
4. Check logs: `cat /tmp/opencode-agent-tmux.log`

### Server Not Found

Make sure OpenCode is started with the `--port` flag matching your config:

```bash
opencode --port 4096
```

### Multiple Instances

Running multiple instances? Each will automatically get its own port. See `MULTI_PORT.md` for details.

## Advanced Features

- **Multi-Port Support**: See `MULTI_PORT.md` for running multiple instances
- **Tmux Launcher Details**: See `TMUX_LAUNCHER.md` for wrapper customization

## License

MIT
