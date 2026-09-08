# Changelog

All notable changes to this project are documented here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and this project
adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

## [1.0.0] — 2026-09-08

First stable release. The command surface — `init`, `status`, `apply`, `doctor`
— and the `.regraft.yml` schema are now covered by semantic versioning, and the
GitHub Action can be pinned to `@v1`.

Nothing changed in behaviour since 0.1.2; this marks the interface as settled
rather than adding to it.

## [0.1.2] — 2026-09-08

### Added

- The documentation site has an icon and a social card, so a link to it no
  longer previews as a blank box wherever it is shared.

### Changed

- Clearer wording for the action's description, which is what the GitHub
  Marketplace listing shows.

### Fixed

- The release workflow fired on any `v*` tag, so pushing the moving `v1` tag
  that consumers pin the action to started a run that tried to republish the
  current version. Releases now trigger on full semver tags only, and a
  release moves the major tag itself.

## [0.1.1] — 2026-09-08

### Fixed

- The installed CLI did nothing at all. npm links the binary as a symlink, and
  node resolves that symlink for `import.meta.url` but not for `argv[1]`, so the
  entry-point check never matched and the process exited silently. Running
  `dist/cli.js` directly — which every test did — was the one path that hid it.
  The CLI is now exercised through a symlink in the suite.

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

[Unreleased]: https://github.com/achedon12/regraft/compare/v1.0.0...HEAD
[1.0.0]: https://github.com/achedon12/regraft/compare/v0.1.2...v1.0.0
[0.1.2]: https://github.com/achedon12/regraft/compare/v0.1.1...v0.1.2
[0.1.1]: https://github.com/achedon12/regraft/compare/v0.1.0...v0.1.1
[0.1.0]: https://github.com/achedon12/regraft/releases/tag/v0.1.0
