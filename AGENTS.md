# AGENTS.md

Instructions for AI agents working on opencode-agent-tmux.

## Project Overview

An OpenCode plugin providing smart tmux integration for viewing agent execution in real-time. Built as a TypeScript Node.js package with Bun tooling.

**Core Technologies:**
- TypeScript (ESNext, strict mode)
- Node.js runtime with ESM modules
- Bun for development tooling
- tsup for bundling
- Zod for runtime validation

## Build, Lint, and Test Commands

### Build Commands
```bash
# Full build (compile TypeScript to dist/)
bun run build

# Watch mode for development
bun run dev

# Type checking only (no emit)
bun run typecheck
```

### Testing
**Note:** This project uses manual/integration testing (no automated test suite).

```bash
# Integration test scripts
./scripts/test-plugin.sh      # Test plugin integration
./scripts/test-multiport.sh   # Test multi-port support

# Manual test after local build
./scripts/dev-setup.sh         # Sets up local development
source ~/.zshrc                # Reload shell config
opencode                       # Run to test integration
```

### Linting
**Note:** No ESLint/Prettier configured. Code quality enforced through TypeScript strict mode.

```bash
# Type checking serves as primary linting
bun run typecheck
```

## Code Style Guidelines

### Import Statements

**Order and Grouping:**
1. Type-only imports first (using `import type`)
2. Node.js built-in modules (with `node:` prefix)
3. External dependencies
4. Relative imports (local modules)
5. Group with blank lines between categories

**Examples:**
```typescript
// ✅ Good
import type { Plugin } from './types';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { z } from 'zod';
import { TmuxSessionManager } from './tmux-session-manager';
import { log, startTmuxCheck } from './utils';

// ❌ Bad - missing node: prefix, wrong order
import { z } from 'zod';
import * as fs from 'fs';
import { log } from './utils';
import type { Plugin } from './types';
```

**Rules:**
- Always use `node:` prefix for built-in modules (`node:fs`, `node:path`, `node:child_process`)
- Omit `.ts` extensions in relative imports
- Use named imports when importing specific exports
- Use `import type` for type-only imports

### Naming Conventions

| Type | Convention | Examples |
|------|------------|----------|
| **Files** | kebab-case | `tmux-session-manager.ts`, `opencode-tmux.ts` |
| **Functions/Variables** | camelCase | `spawnTmuxPane`, `isInsideTmux`, `serverUrl` |
| **Classes** | PascalCase | `TmuxSessionManager` |
| **Types/Interfaces** | PascalCase | `PluginConfig`, `TmuxLayout` |
| **Constants** | UPPER_SNAKE_CASE | `POLL_INTERVAL_MS`, `SESSION_TIMEOUT_MS` |
| **Enums** | PascalCase | `TmuxLayoutSchema` (Zod enum) |

**No Interface Prefix:** Avoid `I` prefix (use `PluginConfig`, not `IPluginConfig`)

### TypeScript Patterns

**Strict Typing (Required):**
```typescript
// ✅ Good - explicit types
function loadConfig(directory: string): PluginConfig {
  const configPaths: string[] = [
    path.join(directory, 'opencode-agent-tmux.json'),
  ];
  // ...
}

// ❌ Bad - implicit any
function loadConfig(directory) {
  const configPaths = [...];
  // ...
}
```

**Zod for Runtime Validation:**
```typescript
// ✅ Good - use Zod schemas for config validation
export const PluginConfigSchema = z.object({
  enabled: z.boolean().default(true),
  port: z.number().default(4096),
});

export type PluginConfig = z.infer<typeof PluginConfigSchema>;

// Parse and validate
const result = PluginConfigSchema.safeParse(parsed);
if (result.success) {
  return result.data;
}
```

**Type Exports:**
```typescript
// ✅ Good - export both value and type
export const TmuxLayoutSchema = z.enum(['main-horizontal', 'main-vertical']);
export type TmuxLayout = z.infer<typeof TmuxLayoutSchema>;

// ✅ Good - re-export types from index
export type { PluginConfig, TmuxConfig, TmuxLayout } from './config';
```

### Error Handling

**Async Error Patterns:**
```typescript
// ✅ Good - try/catch with proper logging
try {
  const content = fs.readFileSync(configPath, 'utf-8');
  const parsed = JSON.parse(content);
  return PluginConfigSchema.parse(parsed);
} catch (err) {
  log('[plugin] config load error', { configPath, error: String(err) });
  return defaultConfig;
}

// ✅ Good - graceful degradation
const sessions = await fetchSessions().catch(() => []);
```

**Error Propagation:**
- Let errors bubble up in async functions (throw/rethrow)
- Catch at appropriate boundaries (plugin entry points)
- Log errors with structured context

### Async/Await Guidelines

```typescript
// ✅ Good - proper async/await
async function closePanes(panes: string[]): Promise<void> {
  await Promise.all(panes.map(pane => closePane(pane)));
}

// ✅ Good - sequential when order matters
async function setup(): Promise<void> {
  await initializeConfig();
  await startTmuxManager();
}

// ❌ Bad - unnecessary await in return
async function getData(): Promise<Data> {
  return await fetchData(); // Just use: return fetchData();
}
```

## Configuration Files

- **tsconfig.json**: TypeScript compiler (strict mode, ESNext target)
- **tsup.config.ts**: Build configuration (ESM output, multiple entries)
- **package.json**: NPM metadata, scripts, dependencies

**Plugin Config Location:**
- Primary: `~/.config/opencode/opencode-agent-tmux.json`
- Fallback: `{project}/opencode-agent-tmux.json`

## Release Process

This project uses GitHub Actions for automated releases. **Do NOT run `npm publish` manually.**

**Workflow behavior (from `.github/workflows/publish-npm.yml`):**
- Trigger: Push of tag `v*`
- Build: `bun install` + `bun run build`
- Publish: `npm publish --access public` via `NPM_TOKEN` secret

### Steps:
1. **Make changes, commit with conventional commits:**
   ```bash
   git commit -m "feat: add new feature"  # Minor version bump
   git commit -m "fix: resolve bug"       # Patch version bump
   git commit -m "feat!: breaking change" # Major version bump
   ```

2. **Update version in package.json:**
   - Patch (1.1.x): Bug fixes only
   - Minor (1.x.0): New features, backward compatible
   - Major (x.0.0): Breaking changes

3. **Commit, tag, and push:**
   ```bash
   git add package.json
   git commit -m "Bump version to X.Y.Z"
   git tag vX.Y.Z
   git push origin main --tags
   ```

4. **Create GitHub release (optional, for documentation):**
   ```bash
   gh release create vX.Y.Z --title "vX.Y.Z" --notes "Release notes..."
   ```

5. **Verify:**
   - Check https://github.com/AnganSamadder/opencode-tmux/actions
   - Verify npm: `npm view @angansamadder/opencode-tmux version`

## Local Development

See [docs/LOCAL_DEVELOPMENT.md](docs/LOCAL_DEVELOPMENT.md) for contributor setup.

**Quick Start:**
```bash
./scripts/dev-setup.sh  # Initial setup
source ~/.zshrc         # Reload shell
bun run dev            # Watch mode
opencode               # Test in separate terminal
```
