# Tmux Agent Plugin: Complete Feature Specification

## Overview
Implement a robust, stateless tmux integration for OpenCode that manages subagent panes with automatic layout balancing, multi-column support, and smooth visual transitions.

## Core Architecture Principles

### 1. Stateless Design
The plugin must not rely on in-memory state to track panes. Instead, it must query tmux directly for pane information using user-defined options (tmux variables). This ensures the plugin can crash, restart, or reload without losing track of existing panes.

**Key Concept**: Use tmux's `@opencode-session-id` user option on each pane to tag it with its corresponding OpenCode session ID. The plugin queries tmux to find all panes with this tag to reconstruct state.

### 2. Async-First Operations
All tmux operations must be non-blocking. Use async/await patterns for spawning panes, querying layouts, and applying changes. Never use blocking execSync calls in the hot path.

### 3. Connection Hardening
The spawned panes must reliably connect to the OpenCode server. Handle network ambiguity by:
- Resolving the `opencode` binary path explicitly using `which` or `where`
- Normalizing server URLs to use explicit IP addresses (127.0.0.1) instead of hostnames (localhost) to avoid IPv6/IPv4 mismatch issues
- Wrapping shell commands to keep panes open on failure so users can see error messages

## Feature 1: Balanced Multi-Column Layout

### Layout Algorithm
Implement a "Balanced" layout that distributes subagent panes across multiple columns optimally:

**Column Distribution Logic**:
- Maximum 3 columns (configurable via `max_agents_per_column`)
- Calculate required columns: `ceil(num_subagents / max_per_column)`
- Distribute agents evenly: first column gets `ceil(n/cols)`, second gets `ceil((n-first)/remaining_cols)`, etc.

**Examples**:
- 7 agents with limit 3 → 3 columns: [3, 2, 2]
- 5 agents with limit 3 → 2 columns: [3, 2]
- 8 agents with limit 3 → 3 columns: [3, 3, 2]

### Dynamic Main Pane Sizing
The main pane (where the primary OpenCode interface runs) must dynamically resize based on column count:
- 1 column: Main pane = 60% width
- 2 columns: Main pane = 45% width  
- 3+ columns: Main pane = 30% width

This prevents the main pane from becoming too small when many subagents are active.

### Layout String Generation
Generate tmux layout strings programmatically:
- Query current window dimensions (width x height)
- Calculate column widths based on main pane percentage
- Generate pane arrangement as tmux layout format
- Apply via `tmux select-layout`

## Feature 2: Optimistic & Deferred Rendering

### Problem
Creating multiple panes rapidly causes visual jank and tmux lockups.

### Solution: Deferred Layout Updates
When a new pane is spawned:
1. Spawn the pane immediately
2. Tag it with `@opencode-session-id`
3. **Do NOT** recalculate layout immediately
4. Wait for the next polling interval (2 seconds) or batch multiple spawns
5. Apply layout once for all recent changes

This batching prevents tmux from freezing during rapid pane creation.

### Debounced Layout Recalculation
- Add a 100ms debounce to layout recalculation
- If multiple events trigger layout within 100ms, only run it once at the end
- This prevents layout thrashing during rapid state changes

## Feature 3: Stateless Session Tracking

### Pane Tagging System
Every spawned pane must be tagged with tmux user options:
```
tmux set-option -p -t {pane_id} @opencode-session-id {session_id}
```

### Query-Based State Reconstruction
Instead of maintaining `Map<string, Session>` in memory:
1. Query tmux for all panes: `tmux list-panes -a -F "#{pane_id},#{@opencode-session-id}"`
2. Parse output to build list of tracked panes
3. Use this list for layout calculations
4. For cleanup, query tmux to find panes to close rather than tracking in memory

### Benefits
- Plugin restart doesn't lose track of panes
- No state synchronization issues
- Automatic orphan detection (panes without tags are ignored)

## Feature 4: Robust Pane Spawning

### Binary Path Resolution
Don't assume `opencode` is in PATH inside tmux:
1. At startup, resolve the absolute path using `which opencode` (or `where opencode` on Windows)
2. Cache this path
3. Use absolute path in all spawn commands

### Shell Command Hardening
The command running inside the pane must:
1. Use the resolved absolute path for the opencode binary
2. Quote the server URL and session ID to handle special characters
3. Normalize `localhost` to `127.0.0.1` to prevent IPv6 connection failures
4. Keep the pane open on failure using: `command || exec bash`

This ensures:
- Connection errors are visible (pane stays open)
- Users can see what went wrong
- No "disappearing panes" from failed connections

## Feature 5: Polling & Lifecycle Management

### Sequential Polling
Use recursive `setTimeout` instead of `setInterval` for polling:
- Wait for each poll operation to complete before scheduling the next
- Prevents overlapping operations if a poll is slow
- Eliminates race conditions

### Poll Interval
- Poll every 2 seconds (configurable)
- On each poll: query tmux for current pane state, trigger layout if changed
- Keep polling even if no sessions (stateless - we check tmux, not memory)

### Cleanup on Shutdown
When the plugin shuts down:
1. Query tmux for all panes with `@opencode-session-id` tag
2. Close those panes using `tmux kill-pane`
3. Do NOT kill the entire tmux session (only the subagent panes)

## Feature 6: Error Handling & Logging

### Trace Logging
Add verbose trace logs for debugging:
- `[TRACE] onSessionCreated called`
- `[TRACE] recalculateLayout called`
- `[TRACE] pollSessions: X active panes found`
- `[TRACE] handleShutdown TRIGGERED: {reason}`

This enables diagnosing issues without modifying code.

### Error Recovery
- If `opencode attach` fails inside a pane, the pane stays open with a shell
- If polling fails, log and retry next interval
- If layout calculation fails, log error and continue
- Never crash the plugin from transient errors

## Implementation Order

1. **Foundation**: Implement pane tagging and stateless queries
2. **Layout**: Implement balanced multi-column algorithm
3. **Spawning**: Add binary resolution and connection hardening
4. **Optimization**: Add deferred rendering and debouncing
5. **Robustness**: Add trace logging and error recovery

## Testing Scenarios

- Spawn 8 subagents simultaneously - should create 3 columns with balanced distribution
- Kill the OpenCode server while subagents are running - panes should stay open showing error
- Restart OpenCode plugin - should reconnect to existing panes automatically
- Rapidly create/destroy sessions - should not freeze tmux or cause visual glitches

## Configuration Options

```typescript
interface TmuxConfig {
  enabled: boolean;
  layout: 'dynamic-vertical' | 'manual';
  max_agents_per_column: number;  // Default: 3
  main_pane_size: number;         // Default: 60 (percent)
  polling_interval_ms: number;    // Default: 2000
}
```

## Success Criteria

1. Panes never disappear on connection failure (stay open with error visible)
2. Plugin restart doesn't lose track of existing panes
3. Layout smoothly balances across 1-3 columns based on agent count
4. Main pane resizes appropriately as columns increase
5. No visual jank or freezing during rapid pane creation
6. All operations are non-blocking (async)
