# Changelog

All notable changes to this project are documented here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and this project
adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

## [0.1.0] — 2026-09-08

First public release.

### Added

- `regraft init` — writes `.regraft.yml`, derives the template and works out a
  starting point, saying so when that point is a guess rather than a fact.
- `regraft status` — lists the template commits the repo is missing. Exits `1`
  when behind, `0` when level, so it can gate a CI step. `--json` for machines.
- `regraft apply` — replays those commits, keeping their original author, date
  and message, and recording each source SHA in a `Regraft-source` trailer.
  `--dry-run`, `--limit`, `--from`.
- `regraft doctor` — checks the repo, the config and the template, and reports
  what would stop a graft.
- Two-tier path protection: `protect.owned` is restored after every commit,
  `protect.winsOnConflict` only when a commit conflicts.
- All-or-nothing rollback with a backup tag: a run that cannot finish leaves the
  repo exactly where it started.
- GitHub Action that opens a pull request with the pending commits.

[Unreleased]: https://github.com/achedon12/regraft/compare/v0.1.0...HEAD
[0.1.0]: https://github.com/achedon12/regraft/releases/tag/v0.1.0
