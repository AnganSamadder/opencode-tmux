# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [1.5.2](https://github.com/AnganSamadder/opentmux/compare/v1.5.1...v1.5.2) (2026-02-10)


### Bug Fixes

* bypass tmux wrapper for interactive mode (no args) ([51acfd5](https://github.com/AnganSamadder/opentmux/commit/51acfd5bf4e3e83cf1cf7c3ab5974894d876da19))
* correct GitHub Actions workflows for OIDC publishing ([2b351c0](https://github.com/AnganSamadder/opentmux/commit/2b351c048cbaabfa57b6c0cbb8a4b33eae96109f))
* handle opentmux symlink in argv parsing ([baa8c7e](https://github.com/AnganSamadder/opentmux/commit/baa8c7e80cf971d08f2c44f274e6791b9a3bb3a5))
* handle symlinked binaries in argument parsing ([9dea6e0](https://github.com/AnganSamadder/opentmux/commit/9dea6e05a5ca33a7f86b43ddd0f886830b0e724f))
* remove leading ./ from bin path in package.json ([a40547d](https://github.com/AnganSamadder/opentmux/commit/a40547d6b0948b9e109637d5e846b99eff68de6a))
* use string format for bin field instead of object ([8b21ed0](https://github.com/AnganSamadder/opentmux/commit/8b21ed01b446e2284445053d298532805919f563))

## [1.5.2] - 2026-02-10

### Fixed

- Fixed critical bug in `opentmux` binary argument parsing where npm global installs (which use symlinks without extensions) were incorrectly identified as binary executables instead of node scripts, causing infinite recursion loops.

## [1.5.0](https://github.com/AnganSamadder/opentmux/compare/v1.4.4...v1.5.0) (2026-02-09)

### Features

- release v1.5.0 - port rotation and aggressive reaping ([e168a83](https://github.com/AnganSamadder/opentmux/commit/e168a83a78b7ec00cabf1f7c8260d3555b7c2eb2))

### Bug Fixes

- improve argument parsing to correctly handle -reap and CLI commands ([1228616](https://github.com/AnganSamadder/opentmux/commit/12286165cfebb1948992b8584127423d4c20652b))
- improve security and achieve full type safety ([f05a9d6](https://github.com/AnganSamadder/opentmux/commit/f05a9d67ffe8a216ff4e3aba747f5f0f37336d3d))
- make zombie reaper fail-safe and robust to API changes ([ee71ead](https://github.com/AnganSamadder/opentmux/commit/ee71eadcd4084bb8c7ded2d0e3ab54a8b725d1ad))
- update release workflow and prevent accidental major version bumps ([0a5258a](https://github.com/AnganSamadder/opentmux/commit/0a5258a2ddd58635ff418b039d56c40e6766f51a))

## [1.5.0] - 2026-02-06

### Added

- **Port Rotation**: New `rotate_port` config option (default: `false`). When enabled, automatically kills the oldest session to make room for new ones when the port limit is reached.
- **Configurable Port Range**: New `max_ports` config option (default: `10`) to control how many concurrent sessions are allowed.
- **Aggressive Reaping**: The `-reap` command now aggressively detects and kills stuck servers that fail to respond to health checks.

### Fixed

- **Suicide Prevention**: `-reap` now whitelists the current session's port to prevent accidental self-termination.
- **Reap Command Logic**: Fixed a bug where `oc -reap` would fail with "No available ports" if all ports were occupied.
- **Health Check Robustness**: Added retry logic (3 attempts) to server health checks to avoid false positives on busy servers.

## [1.4.7] - 2026-02-05

### Fixed

- **CLI Argument Handling**: Improved logic to correctly identify CLI commands (like `config`, `auth`, `agent`) versus TUI commands, ensuring arguments are passed correctly.
- **Graceful Shutdown**: Fixed issue where `AbortError` (code 20) during interrupt (Ctrl+C) was logged as a fatal error. Now handles it cleanly by exiting with code 0.
- **Zombie Reaper Flag**: Fixed `--reap` flag handling to ensure it executes the reaper logic instead of passing it to opencode.

## [1.4.6] - 2026-02-05

### Fixed

- Internal release with CLI logic improvements. Superseded by 1.4.7.

## [1.4.5] - 2025-02-04

### Fixed

- **Plugin duplicate detection**: Fixed `update-plugins.ts` to properly detect local path installations (`/opentmux`) in addition to registry names, preventing duplicate plugin entries
- **Runtime duplicate prevention**: Added `isInitialized` guard in plugin entry point to prevent duplicate initialization if plugin is loaded multiple times
- **Race condition prevention**: Added `pendingSessions` Set to prevent race conditions when multiple child sessions spawn simultaneously
- **Pane layout fixes**: Fixed main-vertical-multi-column layout to correctly identify the main pane and agent panes

## [1.4.0] - 2026-02-03

### Features

- **Zombie Reaper**: Introduced a new system to automatically detect and clean up orphaned "opencode attach" processes that persist after sessions end.
  - Added `ZombieReaper` class that safely identifies zombies by verifying session status with the server.
  - Added background reaping (default interval: 30s) to `TmuxSessionManager`.
  - Added CLI command `opentmux --reap` for manual global cleanup of zombie processes.
- **Safety**: Reaper strictly validates that processes belong to the current server instance before killing them, preventing accidental termination of other active OpenCode instances.

### Fixes

- Fixed memory leak where `opencode attach` processes would remain running indefinitely after their parent tmux pane or session was closed.

## [1.3.2](https://github.com/AnganSamadder/opentmux/compare/v1.3.1...v1.3.2) (2026-02-03)

### Bug Fixes

- rename bin file to opentmux.ts ([83c3b14](https://github.com/AnganSamadder/opentmux/commit/83c3b1431fcf9304dc712940785d550a5664171e))
- restore SpawnQueue and fix pane resizing regression (revert to v1.3.0 logic) ([91db75d](https://github.com/AnganSamadder/opentmux/commit/91db75d15f1f1b5187f915292f0284da7d59f7e4))
- update CLI alias generation to use opentmux binary name ([fb4a058](https://github.com/AnganSamadder/opentmux/commit/fb4a058abc3e493abfe2cc69be6d4b9ed4dff3af))

## [1.2.7] - 2026-01-27

### Fixed

- Fixed issue where tmux window closes instantly when opencode exits with success code (0).
- Changed shell wrapper to always pause and show exit code after execution, ensuring users can see final output/errors before the window closes.
