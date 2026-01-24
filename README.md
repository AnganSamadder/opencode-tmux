# opencode-agent-tmux

OpenCode plugin that provides **smart tmux integration** for viewing agent execution in real-time. Automatically spawns panes, streams output, and manages your terminal workspace.

![License](https://img.shields.io/npm/l/opencode-agent-tmux)
![Version](https://img.shields.io/npm/v/opencode-agent-tmux)

## 🚀 Quick Start (Official)

**1. Install via NPM:**
```bash
npm install -g opencode-agent-tmux
```
*The installer automatically configures your shell (Bash, Zsh, Fish, PowerShell) to use the smart wrapper.*

**2. Enable the Plugin:**
Add `"opencode-agent-tmux"` to your `~/.config/opencode/opencode.json`:
```json
{
  "plugins": [
    "opencode-agent-tmux"
  ]
}
```

**3. Run OpenCode:**
Just type `opencode` in your terminal. The plugin handles the rest!

---

## ✨ Features

- **Automatic Tmux Pane Spawning**: When any agent starts, automatically spawns a tmux pane
- **Live Streaming**: Each pane runs `opencode attach` to show real-time agent output
- **Auto-Cleanup**: Panes automatically close when agents complete
- **Configurable Layout**: Support multiple tmux layouts (main-vertical, tiled, etc.)
- **Multi-Port Support**: Automatically finds available ports (4096-4106) when running multiple instances
- **Agent-Agnostic**: Works with oh-my-opencode, omoc-slim, or vanilla OpenCode
- **Cross-Platform**: Full support for **macOS**, **Linux**, and **Windows** (via PowerShell or WSL)

## 📋 Requirements

- **OpenCode**
- **tmux** (Must be installed on your system)
- **Node.js** (For the installation wrapper)

## 🚀 Usage

### Automatic Mode (Recommended)
After installation, just run:
```bash
opencode
```
The wrapper automatically:
1.  Launches a new tmux session (if you aren't in one).
2.  Finds an available port.
3.  Starts the OpenCode server.
4.  Enables the plugin to spawn panes for agents.

### Running Multiple Instances
Want to run multiple OpenCode sessions? No problem:

```bash
# Terminal 1
opencode
# → Starts on port 4096

# Terminal 2
opencode
# → Detects 4096 is in use, automatically uses port 4097
```
Each instance works independently with its own tmux panes!

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

## 🛠 Development / Manual Installation

Only needed if you want to contribute to the code:

1.  **Clone:** `git clone https://github.com/AnganSamadder/opencode-agent-tmux.git`
2.  **Build:** `bun install && bun run build`
3.  **Configure:** Add the **full path** to your config: `"/absolute/path/to/opencode-agent-tmux"`

## ❓ Troubleshooting

### Panes Not Spawning
1. Verify you're inside tmux: `echo $TMUX`
2. Check tmux is installed: `which tmux` (or `where tmux` on Windows)
3. Check logs: `cat /tmp/opencode-agent-tmux.log`

### Server Not Found
Make sure OpenCode is started with the `--port` flag matching your config (the wrapper does this automatically).

## 📄 License
MIT

## 🙏 Acknowledgements
This project extracts and improves upon the tmux session management from [oh-my-opencode-slim](https://github.com/alvinunreal/oh-my-opencode-slim) by alvinunreal.
