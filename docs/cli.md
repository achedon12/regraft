---
layout: default
title: Command reference
nav_order: 2
---

# Command reference

```
regraft <command> [options]
```

Everything regraft prints for humans goes to **stderr**; `--json` output goes to
**stdout**. So `regraft status --json > drift.json` gives you clean JSON and
still shows you what happened.

## Exit codes

| Code | |
|---|---|
| `0` | Success. For `status`, also means "up to date". |
| `1` | `status` only: the repo is behind the template. Not an error. |
| `2` | Something you need to fix: bad config, dirty tree, unreachable template. |
| `3` | A bug in regraft. Please [report it](https://github.com/achedon12/regraft/issues). |

The `status` split is deliberate: `regraft status || regraft apply` is a valid
pipeline step.

## `regraft init`

Writes `.regraft.yml`.

```bash
regraft init --template https://github.com/acme/service-template.git
regraft init --from a1b2c3d --force
```

| Option | |
|---|---|
| `-t, --template <url>` | Template clone URL. Without it, an existing `template`, `upstream`, `template-source` or `regraft-source` remote is used. |
| `--ref <branch>` | Template branch to follow. Defaults to the template's own default branch, asked of the remote rather than guessed. |
| `--from <sha>` | Starting point. Without it, one is guessed from your first commit's date. |
| `-f, --force` | Overwrite an existing config. |

When the starting point is a guess, `init` says so and tells you how to correct
it. Check it before your first `apply`: a starting point that is too old replays
commits you already have, one that is too new skips commits you need.

## `regraft status`

Lists the template commits this repo is missing. Changes nothing.

```bash
regraft status
regraft status --json
regraft status --limit 5
```

| Option | |
|---|---|
| `--json` | Machine-readable. See the shape below. |
| `--limit <n>` | Show only the first n commits. |
| `--from <sha>` | Compute against this starting point instead of the recorded one. |

```jsonc
{
  "repository": "/path/to/repo",
  "template": { "url": "...", "branch": "main" },
  "base": "a1b2c3d…",
  "baseSource": "trailer",      // flag | config | trailer | date
  "behind": 14,
  "upToDate": false,
  "commits": [{ "sha": "…", "shortSha": "8f2a1c9", "subject": "…", "author": "…", "date": "…" }],
  "excluded": [{ "sha": "…", "subject": "…" }],
  "protect": { "owned": ["…"], "winsOnConflict": ["…"] }
}
```

## `regraft apply`

Grafts the pending commits onto the current branch. Commits, but never pushes.

```bash
regraft apply --dry-run
regraft apply
regraft apply --limit 10
```

| Option | |
|---|---|
| `--dry-run` | Work everything out, write nothing. |
| `--limit <n>` | Take at most n commits. Lands a long backlog in reviewable chunks. |
| `--from <sha>` | Start from here instead of the recorded point. |
| `--allow-ahead` | Graft even though the branch is ahead of its upstream. |
| `--no-backup` | Skip the safety tag. For disposable checkouts like CI. |
| `--json` | Also print a machine-readable summary. |

Before starting, `apply` refuses a dirty working tree, a detached `HEAD`, or a
branch behind its upstream, and says which one stopped it.

If any commit fails, **the whole run is rolled back** and nothing is left
half-applied. Otherwise a backup tag is printed:

```
Undo with:  git reset --hard regraft/backup-20260908-142233
```

## `regraft doctor`

Checks the repository, the config and the template, and reports what would stop
a graft. Run it first when something is not behaving.

```console
$ regraft doctor
✓ git             git version 2.43.0
✓ repository      /srv/service-a
✓ branch          main
✓ worktree        clean
✓ upstream        origin/main — 0 behind, 0 ahead
✓ config          /srv/service-a/.regraft.yml
✓ config syntax   valid
! protect paths   not found in this repo: public/logo.png
✓ template        https://github.com/acme/service-template.git (main)
✓ base            a1b2c3d4e5f6 — from the last Regraft-source trailer
✓ base reachable  on regraft-source/main

! 1 warning — grafting will work, but read them.
```

A protected path that matches nothing is a warning rather than an error, because
it is almost always a typo — and a typo there is silent: the file it was meant
to guard gets overwritten anyway.

## Global options

| Option | |
|---|---|
| `-C, --cwd <dir>` | Run as if started in `<dir>`. |
| `-q, --quiet` | Errors only. |
| `-v, --verbose` | Print every git command regraft runs. |
| `-h, --help` | Help. |
| `-V, --version` | Version. |

`--verbose` is the honest answer to "what is it actually doing": every git
invocation is printed, and you can run them yourself.
