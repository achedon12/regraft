import { test, describe, before } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, symlinkSync, rmSync, existsSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

const CLI = resolve(import.meta.dirname, '../dist/cli.js');

function runNode(entry: string, args: string[] = []) {
  const result = spawnSync(process.execPath, [entry, ...args], { encoding: 'utf8' });
  return {
    status: result.status ?? 1,
    stdout: (result.stdout ?? '').trim(),
    stderr: (result.stderr ?? '').trim(),
  };
}

describe('the built CLI', () => {
  before(() => {
    if (!existsSync(CLI)) {
      throw new Error('dist/cli.js is missing — run `npm run build` before the tests.');
    }
  });

  test('runs when invoked directly', () => {
    const result = runNode(CLI, ['--version']);
    assert.match(result.stdout, /^\d+\.\d+\.\d+/);
  });

  /**
   * The regression that shipped in 0.1.0: npm installs the bin as a symlink,
   * node resolves it for `import.meta.url` but not for `argv[1]`, and a naive
   * comparison of the two made the installed CLI exit silently having done
   * nothing. Calling `dist/cli.js` directly — as every other test did — is the
   * one path that hides it.
   */
  test('runs when invoked through a symlink, the way npm installs it', () => {
    const dir = mkdtempSync(join(tmpdir(), 'regraft-bin-'));
    try {
      mkdirSync(join(dir, '.bin'));
      const link = join(dir, '.bin', 'regraft');
      symlinkSync(CLI, link);

      const result = runNode(link, ['--version']);
      assert.match(result.stdout, /^\d+\.\d+\.\d+/, 'the CLI produced no output through a symlink');
      assert.equal(result.status, 0);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test('prints help and exits 0 with --help', () => {
    const result = runNode(CLI, ['--help']);
    assert.equal(result.status, 0);
    assert.match(result.stdout, /USAGE/);
    assert.match(result.stdout, /init|status|apply|doctor/);
  });

  test('exits 1 with usage when given no command', () => {
    const result = runNode(CLI);
    assert.equal(result.status, 1);
    assert.match(result.stdout, /USAGE/);
  });

  test('rejects an unknown command without a stack trace', () => {
    const result = runNode(CLI, ['nonsense']);
    assert.equal(result.status, 2);
    assert.match(result.stderr, /Unknown command/);
    assert.doesNotMatch(result.stderr, /at \w+ \(/, 'a user error must not print a stack trace');
  });

  test('reports a missing config as a user error, not a crash', () => {
    const dir = mkdtempSync(join(tmpdir(), 'regraft-empty-'));
    try {
      spawnSync('git', ['init', '-q', '-b', 'main'], { cwd: dir });
      spawnSync('git', ['commit', '-q', '--allow-empty', '-m', 'x'], {
        cwd: dir,
        env: { ...process.env, GIT_AUTHOR_NAME: 'T', GIT_AUTHOR_EMAIL: 't@t.t', GIT_COMMITTER_NAME: 'T', GIT_COMMITTER_EMAIL: 't@t.t' },
      });
      const result = runNode(CLI, ['status', '--cwd', dir]);
      assert.equal(result.status, 2);
      assert.match(result.stderr, /regraft init/);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
