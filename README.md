# OpenTmux

[![npm version](https://img.shields.io/npm/v/opentmux.svg)](https://www.npmjs.com/package/opentmux)
[![npm downloads](https://img.shields.io/npm/dt/opentmux)](https://www.npmjs.com/package/opentmux)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)

An [OpenCode](https://opencode.ai) plugin that provides **smart tmux integration** for viewing agent execution in real-time. Automatically spawns panes, streams output, and manages your terminal workspace.

- **Agent-Agnostic**: Works with oh-my-opencode, omoc-slim, or vanilla OpenCode.
- **Cross-Platform**: Full support for **macOS**, **Linux**, and **Windows** (via PowerShell or WSL).

![Opencode Agent Tmux Demo](https://raw.githubusercontent.com/angansamadder/opentmux/main/assets/demo.png)
*Note: The demo shows the "sisyphus" agent from [oh-my-opencode](https://github.com/code-yeongyu/oh-my-opencode), but this plugin supports ALL OpenCode subagents.*

## Installation

### 🤖 Let an LLM do it (Recommended)

Paste this into any LLM agent (OpenCode, Claude Code, Cursor, etc.):

```text
Install the opentmux plugin by following: https://raw.githubusercontent.com/AnganSamadder/opentmux/main/README.md
```

<details>
<summary><b>Instructions for LLM Agents</b></summary>

To install this plugin, please perform the following steps for the user:

1.  **Install the NPM package globally:**
    ```bash
    npm install -g opentmux
    ```
    *Note: This installer automatically configures the user's shell (Bash/Zsh/Fish/PowerShell) to use the smart wrapper.*

2.  **Configure OpenCode:**
    Add `"opentmux"` to the `plugin` array in the user's config file (usually `~/.config/opencode/opencode.json`).

    ```json
    {
      "plugin": [
        "opentmux"
      ]
    }
    ```

3.  **Verify & Finalize:**
    *   Check if `tmux` is installed on the system. If not, advise the user to install it (e.g., `brew install tmux`, `sudo apt install tmux`, or `winget install tmux`).
    *   Tell the user: **"Installation complete! Please restart your terminal and run `opencode` to see the tmux integration in action."**

</details>

### 👤 For Humans (Manual)

1.  **Install via NPM:**
    ```bash
    npm install -g opentmux
    ```
    *The installer automatically configures your shell to use the smart wrapper.*

2.  **Enable the Plugin:**
    Add `"opentmux"` to your `~/.config/opencode/opencode.json`:
    ```json
    {
      "plugin": [
        "opentmux"
      ]
    }
    ```

3.  **Run OpenCode:**
    Restart your terminal and type `opencode`. The plugin handles the rest!

## 🛠️ Development

For contributors working on this plugin locally, see [LOCAL_DEVELOPMENT.md](docs/LOCAL_DEVELOPMENT.md) for setup instructions.

### Go Runtime Rewrite (Branch: `refactor/go-rewrite`)

This branch ships a Go-first runtime with a thin TypeScript compatibility shim.

- `src/index.ts` starts/controls `opentmuxd` via `opentmuxctl`
- `src/bin/opentmux.ts` delegates to the Go CLI wrapper binary
- Legacy TypeScript runtime remains as fallback while migration is validated

Build steps:

```bash
# TypeScript bundle + local-platform Go binaries in dist/runtime/<os-arch>/
bun run build

# 100-session burst benchmark harness
bun run bench:burst
```

## ✨ Features

- **Automatic Tmux Pane Spawning**: When any agent starts, automatically spawns a tmux pane
- **Live Streaming**: Each pane runs `opencode attach` to show real-time agent output
- **Auto-Cleanup**: Panes automatically close when agents complete
- **Configurable Layout**: Support multiple tmux layouts (`main-vertical`, `tiled`, etc.)
- **Multi-Port Support**: Automatically finds available ports (4096-4106) when running multiple instances
- **Smart Wrapper**: Automatically detects if you are in tmux; if not, launches a session for you.

## ⚙️ Configuration

You can customize behavior by creating `~/.config/opencode/opentmux.json`:

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
2. Check tmux is installed: `which tmux` (or `where tmux` on Windows)
3. Check logs: `cat /tmp/opentmux.log`

### Server Not Found
Make sure OpenCode is started with the `--port` flag matching your config (the wrapper does this automatically).

## 🗺️ Roadmap

The following features are planned for future releases:
- **Glow Integration**: Support for [Glow](https://github.com/charmbracelet/glow) to render markdown beautifully in spawned panes.
- **Neovim Quick-Launch**: Direct integration to launch Neovim at the agent's current working directory.
- **Enhanced Customization**: More options for pane positioning, colors, and persistent layouts.

## 📄 License

MIT

## 🙏 Acknowledgements
This project extracts and improves upon the tmux session management from [oh-my-opencode-slim](https://github.com/alvinunreal/oh-my-opencode-slim) by alvinunreal.
