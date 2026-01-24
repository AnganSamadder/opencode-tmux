# opencode-agent-tmux

OpenCode plugin that provides tmux integration for viewing agent execution in real-time. Automatically spawns panes, streams output, and manages your terminal workspace.

## 🤖 For Humans (Quick Start)

Want to get started immediately? Just paste this prompt into your OpenCode agent (or any other agentic tool like Claude Code) and let it handle the setup for you:

```text
Please install the opencode-agent-tmux plugin for me.

1. Clone the repository to ~/Code/opencode-agent-tmux
2. Run 'bun install' and 'bun run build' inside the directory
3. Add the plugin path to my ~/.config/opencode/opencode.json file
4. Verify the installation by running 'opencode --version'

The plugin repo is: https://github.com/AnganSamadder/opencode-agent-tmux.git
```

## ✨ Features

- **Automatic Tmux Pane Spawning**: When any agent starts, automatically spawns a tmux pane
- **Live Streaming**: Each pane runs `opencode attach` to show real-time agent output
- **Auto-Cleanup**: Panes automatically close when agents complete
- **Configurable Layout**: Support multiple tmux layouts (main-vertical, tiled, etc.)
- **Multi-Port Support**: Automatically finds available ports when running multiple instances
- **Agent-Agnostic**: Works with oh-my-opencode, omoc-slim, or vanilla OpenCode

## 📋 Requirements

- **OpenCode**
- **tmux**
- **Bun** (for building)

## 🛠 Manual Installation

If you prefer to install it yourself:

1.  **Clone the repository:**
    ```bash
    git clone https://github.com/AnganSamadder/opencode-agent-tmux.git ~/Code/opencode-agent-tmux
    ```

2.  **Build the plugin:**
    ```bash
    cd ~/Code/opencode-agent-tmux
    bun install
    bun run build
    ```

3.  **Configure OpenCode:**
    Add the plugin to your `~/.config/opencode/opencode.json`:
    ```json
    {
      "plugins": [
        "~/Code/opencode-agent-tmux"
      ]
    }
    ```

## 🚀 Usage

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
```

Each instance works independently with its own tmux panes!

### Manual Mode

Or start OpenCode inside tmux manually:

```bash
tmux
opencode --port 4096
```

## ⚙️ Configuration

You can customize behavior by creating `~/.config/opencode/opencode-agent-tmux.json`:

```json
{
  "enabled": true,
  "port": 4096,
  "layout": "main-vertical",
  "main_pane_size": 60,
  "auto_close": true
}
```

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `enabled` | boolean | `true` | Enable/disable the plugin |
| `port` | number | `4096` | OpenCode server port |
| `layout` | string | `"main-vertical"` | Tmux layout: `main-horizontal`, `main-vertical`, `tiled`, etc. |
| `main_pane_size` | number | `60` | Size of main pane (20-80%) |
| `auto_close` | boolean | `true` | Auto-close panes when sessions complete |

## ❓ Troubleshooting

### Panes Not Spawning
1. Verify you're inside tmux: `echo $TMUX`
2. Check tmux is installed: `which tmux`
3. Check OpenCode server is running with port: `opencode --port 4096`
4. Check logs: `cat /tmp/opencode-agent-tmux.log`

### Server Not Found
Make sure OpenCode is started with the `--port` flag matching your config:
```bash
opencode --port 4096
```

## 📄 License

MIT

## 🙏 Acknowledgements

This project extracts and improves upon the tmux session management from [oh-my-opencode-slim](https://github.com/alvinunreal/oh-my-opencode-slim) by alvinunreal.
