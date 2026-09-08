---
layout: default
title: Home
nav_order: 1
---

# regraft

**GitHub template repositories are a one-time copy. regraft keeps them in sync.**
{: .fs-6 .fw-300 }

[Get started](#quick-start){: .btn .btn-primary .mr-2 }
[View on GitHub](https://github.com/achedon12/regraft){: .btn }

---

You clicked **Use this template**. You got a copy — and that was the last time
the two repositories ever spoke to each other.

Day 30, the template gains a security fix. Day 90, a CI change. Day 200, a
dependency bump every child needs. There is no `git pull` that will bring any of
it down, because a repo made from a template shares no commit with it:

```console
$ git merge template/main
fatal: refusing to merge unrelated histories
```

regraft replays the template's new commits onto your repo as patches — keeping
their original author, date and message — while protecting the files that make
your repo yours.

## Quick start

```bash
cd my-service
npx regraft init --template https://github.com/acme/service-template.git
npx regraft status
npx regraft apply --dry-run
npx regraft apply
```

## Where to go next

- **[Command reference]({{ site.baseurl }}/cli.html)** — every command and flag.
- **[Configuration]({{ site.baseurl }}/configuration.html)** — `.regraft.yml`, and
  the two protection lists that matter most.
- **[GitHub Action]({{ site.baseurl }}/github-action.html)** — scheduled pull
  requests, one per template commit if you want them.

## Why cherry-pick and not merge

A repo created from a template has no common ancestor with it. Merge and rebase
both need one; `cherry-pick` does not, because it applies a patch.

That is not a workaround — it is the better outcome. Each grafted commit keeps
its original author, date and subject, so the upstream fix stays findable in
your history instead of collapsing into one opaque "sync with template" commit.

## Used in production

regraft is extracted from the tooling that keeps **106 production websites** in
sync with a shared template. The two protection lists, the all-or-nothing
rollback and the merge-commit rule are not design guesses — each one is a
production incident that is no longer possible.
