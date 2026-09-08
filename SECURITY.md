# Security Policy

## Supported versions

The latest published minor version receives security fixes.

## Reporting a vulnerability

Please **do not open a public issue** for a security problem.

Report it privately through GitHub's
[private vulnerability reporting](https://github.com/achedon12/regraft/security/advisories/new).
You should get an acknowledgement within a few days.

## What is in scope

regraft runs `git` as a subprocess against repositories and URLs it is pointed
at, and the GitHub Action runs it with a token. Things worth reporting:

- A `.regraft.yml` value that escapes into a shell or into `git` as an option
  rather than as data (argument injection).
- A path in `protect` that can reach outside the repository.
- Anything that makes the Action leak its token, or push somewhere other than
  the repository it is running in.
- A crafted template repository that can execute code on a machine merely
  running `regraft status`.

## What is not

- `regraft apply` changing files in your working tree. That is the entire
  purpose of the tool; `--dry-run` shows you first.
- A template you chose to point at containing hostile *content*. regraft applies
  patches from a repository you nominated; review your template as you would any
  upstream.
