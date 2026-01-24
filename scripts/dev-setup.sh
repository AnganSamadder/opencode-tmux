#!/usr/bin/env bash
# Local Development Setup Script for opencode-agent-tmux
# This script sets up the local development environment by creating symlinks

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"

echo ""
echo "🔧 Setting up opencode-agent-tmux local development..."
echo ""

# Check if we're in the right directory
if [ ! -f "$PROJECT_ROOT/package.json" ]; then
	echo "❌ Error: Not in the opencode-agent-tmux directory"
	exit 1
fi

# Build the project first
echo "📦 Building project..."
cd "$PROJECT_ROOT"
bun run build

# Check if dist/bin/opencode-tmux.js exists
if [ ! -f "$PROJECT_ROOT/dist/bin/opencode-tmux.js" ]; then
	echo "❌ Error: Build failed - dist/bin/opencode-tmux.js not found"
	exit 1
fi

# Make binary executable
chmod +x "$PROJECT_ROOT/dist/bin/opencode-tmux.js"

# Detect npm global bin directory
if command -v npm &>/dev/null; then
	NPM_BIN=$(npm config get prefix)/bin
	echo "📍 NPM global bin: $NPM_BIN"

	# Create symlink
	if [ -L "$NPM_BIN/opencode-tmux" ]; then
		echo "🔄 Removing existing opencode-tmux symlink..."
		rm "$NPM_BIN/opencode-tmux"
	fi

	echo "🔗 Creating symlink: $NPM_BIN/opencode-tmux -> $PROJECT_ROOT/dist/bin/opencode-tmux.js"
	ln -s "$PROJECT_ROOT/dist/bin/opencode-tmux.js" "$NPM_BIN/opencode-tmux"

	echo "✓ Symlink created!"
else
	echo "⚠️  npm not found - cannot create global symlink"
fi

echo ""
echo "🎉 Local development setup complete!"
echo ""
echo "📝 Next steps:"
echo "   1. Run 'source ~/.zshrc' (or ~/.bashrc) to reload your shell config"
echo "   2. Run 'opencode' to test the tmux integration"
echo "   3. The symlink will use your local build, so changes will reflect after 'bun run build'"
echo ""
echo "💡 Tips:"
echo "   - Run 'bun run dev' for watch mode during development"
echo "   - Run 'scripts/dev-setup.sh' again after making changes to the binary"
echo ""
