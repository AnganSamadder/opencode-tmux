# Local Development Setup

This guide is for contributors who want to develop and test `opentmux` locally.

## Quick Setup

```bash
# Clone the repository (if you haven't already)
git clone https://github.com/AnganSamadder/opentmux.git
cd opentmux

# Install dependencies
bun install

# Install Go toolchain (required for rewrite branch)
brew install go buf

# Build the project
bun run build

# Run the development setup script
./scripts/dev-setup.sh
```

The `dev-setup.sh` script will:
1. Build the project
2. Create a symlink from your npm global bin to the local build
3. Configure your shell to use the local version

## Development Workflow

### Watch Mode
```bash
bun run dev
```
This runs `tsup` in watch mode, automatically rebuilding when you make changes.

### Manual Build
```bash
bun run build
```
This runs TypeScript bundling and builds Go runtime binaries into `dist/runtime/<os-arch>/`.

### Type Checking
```bash
bun run typecheck
```

## How It Works

### For End Users (Global Install)
When users run `npm install -g opentmux`:
1. The package is installed to npm's global `node_modules`
2. The `opentmux` binary is added to npm's global bin directory
3. The `postinstall` script automatically runs, which:
   - Detects the user's shell (bash/zsh/fish/powershell)
   - Adds `alias opencode='opentmux'` to their shell config
   - Sets `OPENCODE_PORT=4096`
   - Removes old aliases from previous versions
4. Users restart their terminal and run `opencode` to get tmux integration

### For Contributors (Local Development)
When you run `./scripts/dev-setup.sh`:
1. The project is built locally
2. A symlink is created: `npm-global-bin/opentmux` → `local-repo/dist/bin/opentmux.js`
3. Your shell alias (from a previous global install) now points to your local development version
4. Changes you make will be reflected after running `bun run build`

## Testing Changes

### Test the Binary
```bash
# Test help
opentmux --help

# Test launching opencode with tmux
opencode
```

### Test the Postinstall Script
```bash
# Run the install script directly
node dist/scripts/install.js
```

### Test the Plugin
1. Make sure `"opentmux"` is in your `~/.config/opencode/opencode.json` plugin array
2. Run `opencode` and spawn an agent (like `explore` or `oracle`)
3. Check if tmux panes are created automatically

## Publishing

Before publishing:
1. Update version in `package.json`
2. Test locally with `./scripts/dev-setup.sh`
3. Commit changes
4. Run `npm publish` (the `prepublishOnly` script will build automatically)

## Troubleshooting

### Symlink not working
```bash
# Check if symlink exists
ls -la $(npm config get prefix)/bin/opentmux

# Recreate symlink
./scripts/dev-setup.sh
```

### Changes not reflected
```bash
# Rebuild
bun run build

# Verify symlink points to your local version
which opentmux
```

### Alias not found
```bash
# Reinstall globally to trigger postinstall
npm install -g opentmux@latest

# Or run install script manually
node dist/scripts/install.js

# Reload shell
source ~/.zshrc  # or ~/.bashrc
```
