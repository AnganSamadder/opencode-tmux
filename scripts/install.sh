#!/usr/bin/env bash

PLUGIN_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
WRAPPER_SCRIPT="$PLUGIN_DIR/bin/opencode-tmux"

detect_shell_rc() {
	if [ -n "$ZSH_VERSION" ] || [[ "$SHELL" == *"zsh"* ]]; then
		echo "$HOME/.zshrc"
	elif [ -n "$BASH_VERSION" ] || [[ "$SHELL" == *"bash"* ]]; then
		if [ -f "$HOME/.bash_profile" ]; then
			echo "$HOME/.bash_profile"
		else
			echo "$HOME/.bashrc"
		fi
	elif [[ "$SHELL" == *"fish"* ]]; then
		echo "$HOME/.config/fish/config.fish"
	else
		echo "$HOME/.profile"
	fi
}

setup_alias() {
	local rc_file
	rc_file="$(detect_shell_rc)"

	echo ""
	echo "🔧 Setting up opencode-agent-tmux auto-launcher..."
	echo "   Config file: $rc_file"

	if [ ! -f "$rc_file" ]; then
		echo "   Creating $rc_file..."
		touch "$rc_file"
	fi

	local marker_start="# >>> opencode-agent-tmux >>>"
	local marker_end="# <<< opencode-agent-tmux <<<"

	# Clean up old subagent-tmux alias if it exists
	local old_marker_start="# >>> opencode-subagent-tmux >>>"
	local old_marker_end="# <<< opencode-subagent-tmux <<<"
	
	if grep -q "$old_marker_start" "$rc_file" 2>/dev/null; then
		echo "   Removing old opencode-subagent-tmux alias..."
		# Create a temp file
		sed "/$old_marker_start/,/$old_marker_end/d" "$rc_file" > "${rc_file}.tmp" && mv "${rc_file}.tmp" "$rc_file"
		echo "   ✓ Removed old alias"
	fi
	
	if grep -q "$marker_start" "$rc_file" 2>/dev/null; then
		echo "   ✓ Auto-launcher already configured"
		echo ""
		return 0
	fi

	cat >>"$rc_file" <<EOF

$marker_start
export OPENCODE_PORT=4096
alias opencode='$WRAPPER_SCRIPT'
$marker_end
EOF

	echo "   ✓ Auto-launcher configured successfully!"
	echo ""
	echo "   To activate now, run:"
	echo "   source $rc_file"
	echo ""
	echo "   Or restart your terminal."
	echo ""
	echo "   Usage: Just type 'opencode' and tmux + port 4096 will be auto-configured!"
	echo ""
}

setup_alias
