# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [1.3.2](https://github.com/AnganSamadder/opentmux/compare/v1.3.1...v1.3.2) (2026-02-03)


### Bug Fixes

* rename bin file to opentmux.ts ([83c3b14](https://github.com/AnganSamadder/opentmux/commit/83c3b1431fcf9304dc712940785d550a5664171e))
* restore SpawnQueue and fix pane resizing regression (revert to v1.3.0 logic) ([91db75d](https://github.com/AnganSamadder/opentmux/commit/91db75d15f1f1b5187f915292f0284da7d59f7e4))
* update CLI alias generation to use opentmux binary name ([fb4a058](https://github.com/AnganSamadder/opentmux/commit/fb4a058abc3e493abfe2cc69be6d4b9ed4dff3af))

## [1.2.7] - 2026-01-27

### Fixed
- Fixed issue where tmux window closes instantly when opencode exits with success code (0).
- Changed shell wrapper to always pause and show exit code after execution, ensuring users can see final output/errors before the window closes.
