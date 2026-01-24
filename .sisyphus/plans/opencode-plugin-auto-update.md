# Opencode Plugin Auto-Update - Plan

## A) Repo Scaffold & Structure
- Directory: `~/Code/opencode-plugin-auto-update`
- Layout:
  - `package.json`
  - `tsconfig.json`
  - `tsup.config.ts`
  - `src/index.ts` (plugin entry)
  - `src/update.ts` (background updater logic)
  - `src/lock.ts` (lock + throttle helpers)
  - `README.md`
  - `CHANGELOG.md`
  - `.gitignore`
  - `.npmignore`
- Package metadata (mirror opencode-agent-tmux style):
  - name: `opencode-plugin-auto-update`
  - display name: `Opencode Plugin Auto-Update`
  - version: `0.1.0`
  - type: `module`
  - main: `dist/index.js`
  - types: `dist/index.d.ts`
  - files: `dist`
  - keywords: `opencode`, `opencode-plugin`, `auto-update`
  - scripts: `build` (tsup), `dev` (tsup --watch), `typecheck` (tsc --noEmit), `prepublishOnly` (bun run build)

## B) Plugin Activation & Startup Flow
- Export default plugin function `(ctx: PluginInput) => Promise<PluginOutput>` (matches opencode-agent-tmux).
- On activation, immediately schedule a detached async task (e.g., `setTimeout(() => runUpdate(), 0)` or `queueMicrotask`).
- Return `{ name: "opencode-plugin-auto-update" }` with no event handler unless required.
- Ensure startup path has no blocking I/O and minimal/no logs.

## C) Update Discovery & Version Resolution
- Read `~/.config/opencode/opencode.json` and parse `plugins` array.
- Skip local/path/git plugins:
  - Absolute/relative paths (`/`, `./`, `../`, `~`)
  - `file:` URLs
  - `git+`, `ssh://`, `https://` repo URLs
- Default: update versioned npm plugins to latest.
- Config option: preserve pinned versions (do not update if user pinned).
- Resolve latest versions via package manager (npm: `npm view <pkg> version`; bun equivalent if available).

## D) Update Execution
- Detect package manager:
  - Prefer `bun` if available (`bun --version` probe)
  - Fallback to `npm`
- Install into `~/.config/opencode/node_modules`:
  - npm: `npm install <pkg>@latest --prefix ~/.config/opencode --no-save`
  - bun: `bun add <pkg>@latest --cwd ~/.config/opencode` (or equivalent)
- Update `opencode.json` plugin entries to `name@<latest>` unless pin-preserving.
- Non-fatal errors: silent unless debug enabled.

## E) Locking & Throttle
- Lock file: `~/.config/opencode/.auto-update.lock`
- Throttle state: `~/.config/opencode/.auto-update.json` with `{ lastRun: ISO, lastSuccess: ISO }`.
- Default interval: 24h.
- Stale lock cleanup: if lock age > 2h, treat as stale and proceed.

## F) Configuration (User-Friendly)
- Environment variables:
  - `OPENCODE_AUTO_UPDATE_DISABLED=true` (skip all updates)
  - `OPENCODE_AUTO_UPDATE_INTERVAL_HOURS=24` (override throttle)
  - `OPENCODE_AUTO_UPDATE_DEBUG=true` (enable logs)
  - `OPENCODE_AUTO_UPDATE_PINNED=true` (preserve pinned versions)
- Precedence: env vars override defaults.

## G) Documentation (Mirror opencode-agent-tmux style)
- README sections (match heading order/tone):
  - Overview / Why it exists
  - Installation (auto + manual)
  - How it works (background update + throttle + lock)
  - Configuration (env vars table)
  - Troubleshooting
  - Release process (npm + GitHub)
  - License / Acknowledgements
- Use concise bullets, numbered steps, fenced code blocks with language tags.

## H) Release Workflow (npm + GitHub)
- Checklist (mirror opencode-agent-tmux style):
  1. Update version in `package.json`
  2. Update `CHANGELOG.md`
  3. `bun run build`
  4. `npm publish`
  5. `git tag vX.Y.Z && git push --tags`
  6. `gh release create vX.Y.Z --notes "..."`

## I) Verification Checklist
- Startup test: no delay on `opencode` launch (update runs async).
- Throttle: run twice within 24h only once.
- Lock: concurrent runs prevented; stale lock cleaned.
- Config overrides: disabled/debug/pinned/interval honored.
- Successful update: npm/bun install completes and `opencode.json` rewritten.

## Notes / Assumptions
- OpenCode plugin API conventions derived from `opencode-agent-tmux`:
  - PluginInput/PluginOutput types and default export signature.
- No official external plugin docs found in current research; verify if available later.
