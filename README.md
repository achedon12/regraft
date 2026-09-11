<h1 align="center">regraft</h1>

<p align="center">
  <strong>GitHub template repositories are a one-time copy. regraft keeps them in sync.</strong>
</p>

<p align="center">
  <a href="https://www.npmjs.com/package/regraft"><img alt="npm" src="https://img.shields.io/npm/v/regraft?color=%23cb3837&label=npm"></a>
  <a href="https://www.npmjs.com/package/regraft"><img alt="downloads" src="https://img.shields.io/npm/d18m/regraft?color=%23cb3837"></a>
  <a href="https://github.com/achedon12/regraft/actions/workflows/ci.yml"><img alt="CI" src="https://github.com/achedon12/regraft/actions/workflows/ci.yml/badge.svg"></a>
  <a href="LICENSE"><img alt="MIT" src="https://img.shields.io/badge/license-MIT-blue.svg"></a>
  <a href="https://nodejs.org"><img alt="Node" src="https://img.shields.io/node/v/regraft"></a>
  <a href="https://github.com/marketplace/actions/regraft"><img alt="GitHub Marketplace" src="https://img.shields.io/badge/marketplace-regraft-2ea043?logo=github"></a>
</p>

---

You clicked **Use this template**. You got a copy — and that was the last time
the two repositories ever spoke to each other.

Day 30, the template gains a security fix. Day 90, a CI change. Day 200, a
dependency bump every child needs. There is no `git pull` that will bring any of
it down, because a repo made from a template shares **no commit** with it:

```console
$ git merge template/main
fatal: refusing to merge unrelated histories
```

So the fixes get copy-pasted by hand, or they do not get applied at all. With
five repos that is tedious. With fifty it does not happen.

**regraft replays the template's new commits onto your repo as patches** —
keeping their original author, date and message — while protecting the files
that make your repo *yours*.

```console
$ npx regraft status
template  https://github.com/acme/service-template.git (main)
base      a1b2c3d4e5f6 — read from the last Regraft-source trailer

14 commits behind the template:

  8f2a1c9  Bump actions/checkout to v5
  3d9e77b  Fix: token refresh raced with retry
  ...

$ npx regraft apply
✓ Grafted 14 commits.

kept  2 protected files:
  public/logo.svg
  src/theme.css

Undo with:  git reset --hard regraft/backup-20260908-142233
```

## Install

```bash
npx regraft --help          # no install
npm install -g regraft      # or globally
```

Node 20.11+. It drives the `git` CLI, so **the repository can be in any
language** — a PHP, Python, Rust or Go template works exactly the same. npm is
only how the tool ships.

## Quick start

```bash
cd my-service                                  # a repo made from a template
npx regraft init --template https://github.com/acme/service-template.git
npx regraft status                             # what am I missing?
npx regraft apply --dry-run                    # what would happen?
npx regraft apply                              # do it
```

`init` writes a `.regraft.yml`, works out where you diverged, and tells you when
that was a guess rather than a fact.

## Why cherry-pick and not merge

A repo created from a template has **no common ancestor** with it. Merge and
rebase both need one; `cherry-pick` does not, because it applies a patch.

That is not a workaround — it is the better outcome. Each grafted commit keeps
its original author, date and subject, so the upstream fix is *findable* in your
history:

```console
$ git log --oneline
7c8ddeb Fix: token refresh raced with retry      # authored upstream, months ago
67e64eb Bump actions/checkout to v5
641c0bd Initial commit from template
```

A file copy would have given you one opaque "sync with template" commit.

## Protecting what is yours

The template should not get to decide your logo, your hostname or your brand
colour. Two lists, in `.regraft.yml`:

```yaml
protect:
  # Restored from your repo after EVERY grafted commit.
  # Your identity: unmergeable by nature.
  owned:
    - public/logo.svg
    - public/favicon.ico
    - .env.example
    - docker-compose.yml

  # Your repo wins, but only when a commit actually conflicts.
  # For files that are mostly template and partly yours.
  winsOnConflict:
    - src/theme.css
    - locales/
```

The distinction earns its keep. `owned` is restored unconditionally, because a
template commit can rewrite your logo *cleanly*, with no conflict for anyone to
notice. `winsOnConflict` is the middle ground: a theme stylesheet that is 90%
template and 10% your palette should keep receiving upstream fixes and still
survive them.

Everything else belongs to the template — and **every file the template
overwrites is listed at the end of the run**, because that is the only place a
graft loses something and it has to be visible:

```console
! The template won 1 conflicted file:
  config/nginx.conf

This is the only place a graft loses something. If any of these belong to
this repo rather than the template, add them to `protect` in .regraft.yml
and re-run from 641c0bd.
```

## All or nothing

If any commit cannot be applied, **the whole run is rolled back** to exactly
where it started, and regraft tells you which commit stopped it.

A half-applied graft is the worst possible outcome: the repo carries some of the
template's changes while its recorded state claims otherwise, and every later
run compounds the lie. So it never happens. A backup tag is written before the
first commit and printed at the end, whichever way the run goes.

## How it knows where to resume

Every grafted commit carries a trailer:

```
Fix: token refresh raced with retry

Regraft-source: 3d9e77b0a1c4e8f2d5b9a7c6e3f1d8b2a4c9e7f5
```

The next run reads the newest one and starts from there. No state file, nothing
to keep in sync, nothing to lose — the record lives in the history it describes,
and it survives clones, forks and rebases.

On a repo that has never been grafted, `init` guesses the starting point from
your first commit's date (the moment the template was copied) and **says out
loud that it guessed**. Correct it with `regraft init --from <sha> --force`.

## Keeping a fleet in sync

`regraft status --json` is built for CI: exit code `0` up to date, `1` behind.

```yaml
# .github/workflows/template-sync.yml
name: Template sync
on:
  schedule: [{ cron: '0 6 * * 1' }]
  workflow_dispatch:

jobs:
  sync:
    runs-on: ubuntu-latest
    permissions: { contents: write, pull-requests: write }
    steps:
      - uses: actions/checkout@v7
        with: { fetch-depth: 0 }   # regraft needs the full history
      - uses: achedon12/regraft@v1
        with:
          create-pull-request: true
```

Every Monday, each repo opens a pull request with the template's new commits —
authors intact, protected files intact, or no PR at all if there is nothing to
take. See [`docs/github-action.md`](docs/github-action.md) for the drift-matrix
dashboard across many repos.

## Commands

| Command | What it does |
|---|---|
| `regraft init` | Write `.regraft.yml`, find the template and a starting point |
| `regraft status` | List the template commits this repo is missing (`--json` for CI) |
| `regraft apply` | Graft them onto the current branch (`--dry-run`, `--limit N`) |
| `regraft doctor` | Check repo, config and template, and say what is wrong |

Full reference: [`docs/cli.md`](docs/cli.md). Configuration:
[`docs/configuration.md`](docs/configuration.md).

## What regraft refuses to do

It stops, and says which check stopped it, when the working tree is dirty, when
`HEAD` is detached, or when your branch is behind its upstream. Each of those is
a way a graft goes wrong quietly instead of loudly.

It never touches `origin`, never pushes, and never rewrites commits that were
already there.

## Compared to

| | |
|---|---|
| **Git submodules / subtrees** | Share history by design. A template copy has none to share. |
| **[cruft](https://github.com/cruft/cruft) / [copier](https://github.com/copier-org/copier)** | Excellent, and template-engine bound (Cookiecutter/Copier projects). regraft works on a plain GitHub template repo, in any language, with no templating layer. |
| **Renovate / Dependabot** | Update *dependencies*. regraft updates the *scaffolding* — workflows, Dockerfiles, configs, shared code. |
| **A sync script + `rsync`** | Loses authorship, loses history, and silently overwrites your logo. |

## Used in production

regraft is extracted from the tooling that keeps a fleet of production websites
in sync with one shared template: **68 sites, running 28 different versions of
that template at once** — some still on 1.x while the template is on 4.35.

That spread is the problem in one number, and it is what a one-time copy costs
you. The two protection lists, the all-or-nothing rollback and the merge-commit
rule are not design guesses — each one is a production incident that is no
longer possible.

## Contributing

Issues and pull requests are welcome — see [CONTRIBUTING.md](CONTRIBUTING.md).
Good first issues are [tagged as such](https://github.com/achedon12/regraft/labels/good%20first%20issue).

## License

[MIT](LICENSE)
