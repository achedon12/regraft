# Contributing to regraft

Thanks for being here. regraft rewrites other people's repositories, so the bar
for correctness is high — but the codebase is small and there is a lot of room
to help.

## Getting set up

```bash
git clone https://github.com/achedon12/regraft.git
cd regraft
npm install
npm test          # builds nothing, runs against real git repos in temp dirs
npm run build
```

Node 22.18+ to run the tests (they execute TypeScript directly). Node 20.11+ to
run the built CLI.

No test framework to learn: `node:test` and `node:assert`, both built in.

## Trying your change against a real repo

```bash
npm run build
node dist/cli.js status --cwd /path/to/some/repo
```

`test/helpers/repo.ts` builds throwaway template/child pairs that share no
history — the same shape as a real "Use this template" copy. Use it rather than
mocking git: regraft is a thin layer over git's own conflict machinery, and a
mocked git would only ever test the mock.

## What a good pull request looks like

- **One concern per PR.** Easier to review, easier to revert.
- **A test that fails without the change.** For a bug fix, write it first — if
  it passes before your fix, it is not testing the bug.
- **Comments explain *why*, not *what*.** The code already says what it does.
  The valuable comment is the one recording why the obvious approach was wrong;
  most comments in this codebase mark a production incident.
- **No new runtime dependencies** without discussing it in an issue first.
  regraft ships two, both tiny, and that is a feature.

## Things that are especially welcome

- Repro cases for grafts that go wrong. A failing test with two synthetic repos
  is worth more than a paragraph.
- Support for other forges — GitLab and Gitea have the same one-way-copy problem
  and nothing in the core is GitHub-specific.
- Documentation. If something took you two reads, say so in an issue; that is a
  bug in the docs.

## Reporting a bug

Include the output of `regraft doctor` and, where you can, a way to reproduce it
with two throwaway repos. Never paste a private repository URL or a token.

## Code of conduct

By participating you agree to the [Code of Conduct](CODE_OF_CONDUCT.md).
