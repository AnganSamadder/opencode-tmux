# Multi-Port Support

The plugin now automatically handles multiple OpenCode instances running on different ports.

## How It Works

### Wrapper Script Auto-Detection

When you run `opencode`, the wrapper script:

1. **Checks port 4096** (default)
2. **If in use**, tries ports 4097, 4098, 4099, up to 4106
3. **Finds first available port** and starts OpenCode there
4. **Sets OPENCODE_PORT** environment variable for the plugin

### Plugin Port Detection

The plugin automatically detects the port by:
1. Reading `ctx.serverUrl` (preferred - passed by OpenCode)
2. Falling back to `OPENCODE_PORT` environment variable
3. Defaulting to `http://localhost:4096` if neither available

## Examples

### Running Multiple Instances

```bash
# Terminal 1
opencode
# → Starts on port 4096

# Terminal 2 (new window)
opencode
# → Detects 4096 in use, starts on port 4097
# → Shows: "⚠️ Port 4096 is in use, using port 4097 instead"

# Terminal 3
opencode
# → Starts on port 4098
```

Each instance gets its own port and the plugin works correctly for all of them!

### Manual Port Selection

Force a specific port:

```bash
OPENCODE_PORT=5000 opencode
```

### Port Range

Default range: 4096-4106 (11 ports)

Change the range by modifying `OPENCODE_PORT_START`:

```bash
OPENCODE_PORT=5000 opencode
# Will try ports 5000-5010
```

## Technical Details

### Port Checking Methods

The wrapper uses (in order of preference):
1. `lsof -i :PORT` (most reliable)
2. `nc -z localhost PORT` (fallback)
3. `curl http://localhost:PORT/health` (last resort)

### Why This Matters

- **No freezing** when starting multiple instances
- **Automatic port allocation** like Docker/Kubernetes
- **Plugin works across all instances** via OPENCODE_PORT env var
- **Tmux panes spawn correctly** for each instance's agents
