# Installation Guide

Follow these steps to install and configure the **opencode-tmux** plugin.

## Prerequisites

- **OpenCode** installed and configured
- **tmux** installed (`brew install tmux` or `apt install tmux`)
- **Bun** runtime installed (`curl -fsSL https://bun.sh/install | bash`)

## Automatic Installation (Recommended)

Run this one-liner in your terminal:

```bash
git clone https://github.com/AnganSamadder/opencode-tmux.git ~/Code/opencode-tmux && \
cd ~/Code/opencode-tmux && \
bun install && \
bun run build
```

Then reload your shell configuration:

```bash
source ~/.zshrc  # or ~/.bashrc
```

## Manual Installation

3. **Clone the repository**
   ```bash
   mkdir -p ~/Code
   cd ~/Code
   git clone https://github.com/AnganSamadder/opencode-tmux.git
   cd opencode-tmux
   ```

2. **Install dependencies**
   ```bash
   bun install
   ```
   *Note: This automatically sets up the shell alias and wrapper script.*

3. **Build the plugin**
   ```bash
   bun run build
   ```

4. **Register the plugin**
    Add the plugin path to your OpenCode config (`~/.config/opencode/opencode.json`):
    ```json
    {
      "plugin": [
        "/Users/YOUR_USERNAME/Code/opencode-tmux"
      ]
    }
    ```

## Verification

1. Start a new terminal session.
2. Type `opencode` (it should launch tmux automatically).
3. In OpenCode, run `/help` or check the logs to verify the plugin is active.
