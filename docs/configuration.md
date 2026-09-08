---
layout: default
title: Configuration
nav_order: 3
---

# Configuring regraft

Everything lives in `.regraft.yml` at the root of the repository being updated.
`regraft init` writes a commented starting point.

```yaml
template:
  url: https://github.com/acme/service-template.git
  ref: main
  remote: regraft-source

base: a1b2c3d4e5f6

protect:
  owned:
    - public/logo.svg
    - .env.example
  winsOnConflict:
    - src/theme.css
    - locales/

exclude:
  messages:
    - '^chore\(release\)'

git:
  safeDirectory: true
  ignoreFileMode: true
```

## `template`

| Key | |
|---|---|
| `url` | **Required.** Clone URL. Any transport git understands, including an SSH alias or a local path. |
| `ref` | Branch to follow. Defaults to the template's own default branch, asked of the remote. |
| `remote` | Name of the local remote regraft manages. Defaults to `regraft-source`. Cannot be `origin`. |

regraft points `remote` at `url` on every run and fetches it. It never touches
`origin`. Setting `remote: origin` is refused outright: regraft rewrites that
remote's URL, and doing so to `origin` would detach the repo from the place it
actually pushes to.

Pin `ref` rather than relying on the default if your template has more than one
long-lived branch. A remote-tracking ref cached in an old clone lies about the
default branch surprisingly often.

## `base`

The template commit this repo already has. Optional, and mostly written by
`init`.

It is a **starting point, not a ceiling**: once a graft has run, the
`Regraft-source` trailer in your history takes over, and the run advances. Both
are considered and the one further along the template branch wins — so a `base`
you deliberately move *forward* (a squashed history, a deliberate skip) is
respected, while a stale one never drags you backwards.

> An all-digit SHA must be quoted. YAML would otherwise read it as a number.

## `protect`

Two lists, and the difference between them matters.

### `owned` — restored after every commit

Your identity. Logo, favicon, hostnames, ports, environment files,
`docker-compose.yml`. Unmergeable by nature: there is no sensible three-way merge
of a PNG or of a hostname.

These are restored from your repo after **every** grafted commit, not only on
conflict. That is the whole point: a template commit can rewrite your logo
cleanly, with no conflict for anyone to notice, and a conflict-only rule would
let it through in silence.

### `winsOnConflict` — your repo wins, but only on conflict

For files that are mostly the template's and partly yours: a theme stylesheet
that is 90% upstream and 10% your palette, a translations directory.

Marking them `owned` would deny them every upstream fix forever. Leaving them
unprotected would erase your part on the first conflicting commit. This is the
middle ground: upstream changes land while they are compatible, and your version
survives the moment they are not.

### Everything else

Belongs to the template. And every file the template overwrites is **listed at
the end of the run** — that is the only place a graft loses something, so it has
to be visible.

### Notes

- Directories may be written with or without a trailing slash.
- A path in both lists is treated as `owned`.
- Paths are repo-relative. Prefixes do not partially match: `locales` covers
  `locales/fr.json` but not `locales-old/fr.json`.
- `regraft doctor` warns about protected paths that do not exist — almost always
  a typo, and a silent one.

## `exclude`

```yaml
exclude:
  messages:
    - '^chore\(release\)'
    - '^Merge branch'
```

JavaScript regular expressions, tested against each commit **subject**. Matching
commits are never grafted, and `status` reports how many were skipped.

Useful for a template that commits its own version bumps, or changelog entries
that mean nothing in a child repo.

Merge commits are already excluded, always, and not through this list: a merge
carries no content of its own — both its parents are already in the range — and
`cherry-pick` refuses to take one without being told which parent is the
mainline.

## `git`

```yaml
git:
  safeDirectory: true    # -c safe.directory=*
  ignoreFileMode: true   # -c core.fileMode=false
```

Both default to `true`, and both exist because of how repos behave in the wild
rather than in theory.

`safeDirectory` covers working copies not owned by the user running regraft —
CI checkouts, shared hosts. Without it git refuses to open the repository at all
("dubious ownership").

`ignoreFileMode` covers repos that were copied rather than cloned, which
routinely carry a `100755 → 100644` drift. Without it, every file looks modified
and regraft would refuse to start on a tree that is actually clean.

Turn either off if you would rather git behaved strictly.
