import { spawnSync } from 'node:child_process';
import { log } from '../util/log.ts';
import { UserError } from '../util/errors.ts';

export interface GitOptions {
  cwd: string;
  /**
   * Treat every directory as safe. Needed when the working copies are not owned
   * by the user running regraft — CI checkouts and shared `/srv`-style hosts hit
   * git's "dubious ownership" refusal otherwise.
   */
  safeDirectory?: boolean;
  /**
   * Ignore the executable bit. Repos copied around rather than cloned routinely
   * carry a 100755 -> 100644 drift that would otherwise show up as a modified
   * worktree on every single file.
   */
  ignoreFileMode?: boolean;
}

export interface GitResult {
  status: number;
  stdout: string;
  stderr: string;
}

export interface Commit {
  sha: string;
  shortSha: string;
  subject: string;
  author: string;
  authorEmail: string;
  authorDate: string;
  body: string;
}

/** ASCII unit/record separators: safe inside commit messages, unlike newlines. */
const FIELD = '\x1f';
const RECORD = '\x1e';
const LOG_FORMAT = ['%H', '%h', '%s', '%an', '%ae', '%aI', '%B'].join(FIELD) + RECORD;

function parseCommits(out: string): Commit[] {
  if (!out) return [];
  return out
    .split(RECORD)
    .map((record) => record.replace(/^\n/, ''))
    .filter((record) => record.trim().length > 0)
    .map((record) => {
      const parts = record.split(FIELD);
      return {
        sha: parts[0] ?? '',
        shortSha: parts[1] ?? '',
        subject: parts[2] ?? '',
        author: parts[3] ?? '',
        authorEmail: parts[4] ?? '',
        authorDate: parts[5] ?? '',
        body: parts[6] ?? '',
      };
    });
}

export class Git {
  private readonly options: GitOptions;

  constructor(options: GitOptions) {
    this.options = options;
  }

  get cwd(): string {
    return this.options.cwd;
  }

  /** Runs git and returns the result, whatever the exit code. */
  run(args: string[]): GitResult {
    const config: string[] = [];
    if (this.options.safeDirectory !== false) config.push('-c', 'safe.directory=*');
    if (this.options.ignoreFileMode !== false) config.push('-c', 'core.fileMode=false');

    log.debug(`git ${args.join(' ')}`);
    const result = spawnSync('git', [...config, ...args], {
      cwd: this.options.cwd,
      encoding: 'utf8',
      maxBuffer: 64 * 1024 * 1024,
      env: { ...process.env, GIT_TERMINAL_PROMPT: '0' },
    });

    if (result.error) {
      throw new UserError(
        `Could not run git: ${result.error.message}`,
        'regraft drives the git CLI. Make sure `git` is installed and on PATH.',
      );
    }

    return {
      status: result.status ?? 1,
      stdout: (result.stdout ?? '').trim(),
      stderr: (result.stderr ?? '').trim(),
    };
  }

  /** Runs git and throws a UserError if it fails. */
  must(args: string[], context?: string): string {
    const result = this.run(args);
    if (result.status !== 0) {
      const detail = result.stderr || result.stdout || `exit code ${result.status}`;
      throw new UserError(context ? `${context}: ${detail}` : detail);
    }
    return result.stdout;
  }

  ok(args: string[]): boolean {
    return this.run(args).status === 0;
  }

  isRepository(): boolean {
    return this.run(['rev-parse', '--git-dir']).status === 0;
  }

  toplevel(): string {
    return this.must(['rev-parse', '--show-toplevel']);
  }

  currentBranch(): string | null {
    const result = this.run(['symbolic-ref', '--quiet', '--short', 'HEAD']);
    return result.status === 0 && result.stdout ? result.stdout : null;
  }

  head(): string {
    return this.must(['rev-parse', 'HEAD']);
  }

  resolve(rev: string): string | null {
    const result = this.run(['rev-parse', '--verify', '--quiet', `${rev}^{commit}`]);
    return result.status === 0 && result.stdout ? result.stdout : null;
  }

  /** Tracked-but-modified plus staged. Untracked files are deliberately ignored. */
  isDirty(): boolean {
    return this.must(['status', '--porcelain', '--untracked-files=no']).length > 0;
  }

  upstream(): string | null {
    const result = this.run(['rev-parse', '--abbrev-ref', '--symbolic-full-name', '@{u}']);
    return result.status === 0 && result.stdout ? result.stdout : null;
  }

  /** `[behind, ahead]` relative to `ref`. */
  behindAhead(ref: string): [number, number] {
    const out = this.must(['rev-list', '--left-right', '--count', `${ref}...HEAD`]);
    const counts = out.split(/\s+/).map((n) => Number.parseInt(n, 10));
    return [counts[0] ?? 0, counts[1] ?? 0];
  }

  remoteUrl(name: string): string | null {
    const result = this.run(['remote', 'get-url', name]);
    return result.status === 0 && result.stdout ? result.stdout : null;
  }

  setRemote(name: string, url: string): void {
    this.run(['remote', 'remove', name]);
    this.must(['remote', 'add', name, url], `Could not add the '${name}' remote`);
  }

  fetch(remote: string, extra: string[] = []): void {
    const result = this.run(['fetch', '--quiet', ...extra, remote]);
    if (result.status !== 0) {
      throw new UserError(
        `Could not fetch '${remote}': ${result.stderr || 'unknown error'}`,
        'Check that the URL is reachable and that your credentials give you read access to it.',
      );
    }
  }

  /** The remote's default branch, asked of the remote rather than guessed. */
  remoteDefaultBranch(remote: string): string | null {
    const result = this.run(['ls-remote', '--symref', remote, 'HEAD']);
    if (result.status !== 0) return null;
    const match = result.stdout.match(/^ref:\s+refs\/heads\/(\S+)\s+HEAD$/m);
    return match?.[1] ?? null;
  }

  /**
   * Commits reachable from `to` but not from `from`, oldest first.
   *
   * Merge commits are excluded, and that is not a convenience: a merge carries
   * no content of its own — both its parents are already in the range — and
   * `cherry-pick` refuses to take one without being told which parent is the
   * mainline. Replaying them would duplicate content that is already applied.
   */
  commitsBetween(from: string | null, to: string): Commit[] {
    const range = from ? `${from}..${to}` : to;
    return parseCommits(this.must(['log', '--reverse', '--no-merges', `--format=${LOG_FORMAT}`, range]));
  }

  commit(rev: string): Commit | null {
    const result = this.run(['log', '-1', `--format=${LOG_FORMAT}`, rev]);
    if (result.status !== 0) return null;
    return parseCommits(result.stdout)[0] ?? null;
  }

  /** Commits on `ref` no later than `iso`, newest first. */
  lastCommitBefore(ref: string, iso: string): string | null {
    const result = this.run(['rev-list', '-n', '1', `--before=${iso}`, ref]);
    return result.status === 0 && result.stdout ? result.stdout : null;
  }

  /** The first commit of the repository — for a template copy, the initial import. */
  rootCommitDate(): string | null {
    const roots = this.run(['rev-list', '--max-parents=0', 'HEAD']);
    if (roots.status !== 0 || !roots.stdout) return null;
    const oldest = roots.stdout.split('\n').at(-1);
    if (!oldest) return null;
    const date = this.run(['log', '-1', '--format=%aI', oldest]);
    return date.status === 0 && date.stdout ? date.stdout : null;
  }

  /** Files git could not merge on its own, as repo-relative paths. */
  unmergedFiles(): string[] {
    const out = this.must(['diff', '--name-only', '--diff-filter=U']);
    return out ? out.split('\n').filter(Boolean) : [];
  }

  isTracked(path: string): boolean {
    return this.ok(['ls-files', '--error-unmatch', '--', path]);
  }

  tag(name: string, sha: string): void {
    this.must(['tag', name, sha], `Could not create the backup tag '${name}'`);
  }

  deleteTag(name: string): void {
    this.run(['tag', '-d', name]);
  }

  abortCherryPick(): void {
    this.run(['cherry-pick', '--abort']);
  }

  hardReset(sha: string): void {
    this.must(['reset', '--hard', sha], 'Could not roll back');
  }
}
