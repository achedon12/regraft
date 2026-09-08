---
layout: default
title: GitHub Action
nav_order: 4
---

# The regraft GitHub Action

Runs regraft on a schedule and turns the template's new commits into pull
requests — the same shape of workflow Dependabot gives you for dependencies,
but for the scaffolding.

## The one you probably want

```yaml
# .github/workflows/template-sync.yml
name: Template sync

on:
  schedule:
    - cron: '0 6 * * 1'   # Mondays, 06:00 UTC
  workflow_dispatch:       # and a button

permissions:
  contents: write
  pull-requests: write

jobs:
  sync:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v5
        with:
          fetch-depth: 0   # regraft needs the full history, not a shallow clone

      - uses: achedon12/regraft@v1
```

One pull request a week, only when the template actually moved.

## One pull request per template commit

```yaml
      - uses: achedon12/regraft@v1
        with:
          strategy: per-commit
          open-pull-requests-limit: 3
          labels: template-sync,dependencies
          reviewers: alice,bob
```

Each template commit becomes its own pull request, reviewable and mergeable on
its own, capped at three open at a time — exactly how Dependabot handles
dependencies.

The trade-off is real and worth knowing: each pull request grafts its commit
onto the base branch **in isolation**. A commit that depends on an earlier one
may not apply alone. Those are reported in the job summary and skipped rather
than forced, and `strategy: single` will take them in order.

## Report drift without opening anything

```yaml
      - uses: achedon12/regraft@v1
        id: drift
        with:
          create-pull-request: false

      - name: Fail the build when we fall too far behind
        if: fromJSON(steps.drift.outputs.behind) > 20
        run: exit 1
```

The commit table lands in the job summary either way.

## A drift dashboard across many repositories

One workflow in one place, reporting on a whole fleet:

```yaml
name: Fleet drift

on:
  schedule: [{ cron: '0 7 * * 1' }]
  workflow_dispatch:

jobs:
  drift:
    runs-on: ubuntu-latest
    strategy:
      fail-fast: false
      matrix:
        repo:
          - acme/service-a
          - acme/service-b
          - acme/service-c
    steps:
      - uses: actions/checkout@v5
        with:
          repository: ${{ matrix.repo }}
          token: ${{ secrets.FLEET_TOKEN }}
          fetch-depth: 0

      - uses: achedon12/regraft@v1
        with:
          create-pull-request: false
```

Each row reports how far behind that repository is, with the missing commits
listed. Swap `create-pull-request: false` for the default and the same matrix
opens a pull request on every repo at once.

## Inputs

### What to graft

| Input | Default | |
|---|---|---|
| `version` | `latest` | Version of regraft to run (npm semver range). Pin it for reproducibility. |
| `from` | | Start from this template commit instead of the recorded one. |
| `limit` | | With `strategy: single`, graft at most this many commits. Lands a long backlog in reviewable chunks. |
| `working-directory` | `.` | For a repo that is not at the root. |

### How pull requests are opened

| Input | Default | |
|---|---|---|
| `create-pull-request` | `true` | `false` reports drift and stops. |
| `strategy` | `single` | `single` or `per-commit`. |
| `open-pull-requests-limit` | `5` | With `per-commit`, how many to keep open at once. |
| `branch-prefix` | `regraft` | Branches are `<prefix>/template-sync` or `<prefix>/<sha>`. |
| `base` | current branch | Branch the pull requests target. |
| `title-prefix` | | Prepended to every title, e.g. `chore(template): `. |
| `labels` | `template-sync` | Comma-separated. |
| `reviewers` | | Comma-separated users or teams. |
| `assignees` | | Comma-separated users. |
| `draft` | `false` | Open as drafts. |
| `auto-merge` | `false` | Squash auto-merge. Warns instead of failing if the repo forbids it. |

### Identity

| Input | Default | |
|---|---|---|
| `token` | `github.token` | Needs `contents: write` and `pull-requests: write`. |
| `git-name` / `git-email` | `github-actions[bot]` | Committer of the graft commits. The *authors* stay whoever wrote them upstream. |

## Outputs

| Output | |
|---|---|
| `behind` | Commits missing before the run. |
| `applied` | Commits actually grafted. |
| `pull-requests` | JSON array of pull request URLs. |
| `pull-request-url` | The first one, for the common single-PR case. |

## Things that will bite you

**`fetch-depth: 0` is not optional.** The default checkout is shallow, and
regraft cannot compute a range against a history it does not have. The action
checks and fails with a clear message rather than doing something odd.

**A private template needs a token that can read it.** `github.token` can only
see the repository the workflow runs in. Give `actions/checkout` a PAT or an App
token, or set `template.url` to an authenticated URL.

**Workflows pushed by `github.token` do not trigger other workflows.** If your
template ships `.github/workflows/`, the sync PR will not run CI under the
default token. Use a PAT or a GitHub App token if you need that.

**A schedule on a quiet repository gets disabled.** GitHub stops scheduled
workflows after 60 days without activity in the repo. `workflow_dispatch` keeps
you a manual button either way.
