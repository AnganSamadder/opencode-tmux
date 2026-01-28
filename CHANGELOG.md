# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [1.2.7] - 2026-01-27

### Fixed
- Fixed issue where tmux window closes instantly when opencode exits with success code (0).
- Changed shell wrapper to always pause and show exit code after execution, ensuring users can see final output/errors before the window closes.
