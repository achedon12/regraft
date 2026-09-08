import type { Git, Commit } from './git.ts';
import type { RegraftConfig } from './config.ts';
import { TRAILER } from './config.ts';
import { protectionFor, type ProtectLists } from './protect.ts';
import { log, pc } from '../util/log.ts';
import { UserError } from '../util/errors.ts';

export interface OverwrittenFile {
  path: string;
  /** The commit that took it. */
  sha: string;
  subject: string;
}

export interface GraftResult {
  applied: number;
  /** Files where the template won a conflict — the only place a graft loses anything. */
  overwritten: OverwrittenFile[];
  /** Commits the child repo kept its side of, per protection rules. */
  defended: OverwrittenFile[];
  /** Set when the run was rolled back. */
  failedAt: Commit | null;
  failureReason: string | null;
  backupTag: string | null;
  startSha: string;
}

export interface GraftOptions {
  /** Stop after N commits. Useful to land a long backlog in reviewable chunks. */
  limit?: number;
  /** Compute everything, touch nothing. */
  dryRun?: boolean;
  /** Skip the safety tag. The GitHub Action does, its checkout is disposable. */
  noBackup?: boolean;
}

function backupTagName(): string {
  const stamp = new Date().toISOString().replace(/[-:]/g, '').replace(/\..+$/, '').replace('T', '-');
  return `regraft/backup-${stamp}`;
}

/**
 * Replays template commits onto the current branch.
 *
 * All or nothing: if any commit cannot be applied, the whole run is rolled back
 * to where it started. A half-applied graft is the worst outcome — the repo
 * would carry some of the template's changes while its trailer, and anything
 * keyed off it, claims a state it is not in.
 */
export function graft(
  git: Git,
  config: RegraftConfig,
  commits: Commit[],
  options: GraftOptions = {},
): GraftResult {
  const lists: ProtectLists = config.protect;
  const selected = options.limit ? commits.slice(0, options.limit) : commits;
  const startSha = git.head();

  const result: GraftResult = {
    applied: 0,
    overwritten: [],
    defended: [],
    failedAt: null,
    failureReason: null,
    backupTag: null,
    startSha,
  };

  if (options.dryRun || selected.length === 0) return result;

  if (!options.noBackup) {
    result.backupTag = backupTagName();
    git.tag(result.backupTag, startSha);
  }

  for (const commit of selected) {
    log.step(`${pc.dim(commit.shortSha)} ${commit.subject}`);

    const picked = git.run(['cherry-pick', '--no-commit', '--allow-empty', commit.sha]);

    if (picked.status !== 0) {
      const unmerged = git.unmergedFiles();

      if (unmerged.length === 0) {
        // Failed without a conflict to arbitrate — a binary patch that will not
        // apply, a broken index. There is nothing to decide here, so we do not.
        result.failedAt = commit;
        result.failureReason = picked.stderr || picked.stdout || 'cherry-pick failed';
        break;
      }

      for (const file of unmerged) {
        const protection = protectionFor(file, lists);
        const side = protection ? '--ours' : '--theirs';

        if (git.ok(['checkout', side, '--', file])) {
          git.run(['add', '--', file]);
        } else {
          // An add/delete conflict: the file does not exist on both sides, so
          // there is no `--ours`/`--theirs` to check out. Stage whichever state
          // is on disk.
          if (git.ok(['ls-files', '--error-unmatch', '--', file]) || existsInWorktree(git, file)) {
            git.run(['add', '--', file]);
          } else {
            git.run(['rm', '--quiet', '--', file]);
          }
        }

        const record = { path: file, sha: commit.sha, subject: commit.subject };
        if (protection) result.defended.push(record);
        else result.overwritten.push(record);
      }
    }

    // `owned` paths go back to this repo's version after every commit, not just
    // on conflict: a template commit can rewrite one cleanly, with no conflict
    // to arbitrate, and silently replace the repo's identity.
    for (const pattern of lists.owned) {
      const path = pattern.replace(/\/+$/, '');
      if (!path) continue;
      // Untracked-but-present paths (a local .env) are never touched by a graft,
      // and `checkout HEAD --` on them only produces noise.
      if (git.isTracked(path)) git.run(['checkout', 'HEAD', '--', path]);
    }

    const committed = git.run([
      'commit',
      '--allow-empty',
      '--no-verify',
      '--quiet',
      `--author=${commit.author} <${commit.authorEmail}>`,
      `--date=${commit.authorDate}`,
      '-m',
      commit.body.trim(),
      '-m',
      `${TRAILER}: ${commit.sha}`,
    ]);

    if (committed.status !== 0) {
      result.failedAt = commit;
      result.failureReason = committed.stderr || committed.stdout || 'commit failed';
      break;
    }

    result.applied += 1;
  }

  if (result.failedAt) {
    git.abortCherryPick();
    git.hardReset(startSha);
    if (result.backupTag) {
      git.deleteTag(result.backupTag);
      result.backupTag = null;
    }
    result.applied = 0;
    result.overwritten = [];
    result.defended = [];
  }

  return result;
}

function existsInWorktree(git: Git, file: string): boolean {
  return git.ok(['ls-files', '--others', '--exclude-standard', '--error-unmatch', '--', file]);
}

/** Formats the failure into the message the user actually needs. */
export function failureMessage(result: GraftResult): UserError {
  const commit = result.failedAt;
  return new UserError(
    `Could not graft ${commit?.shortSha ?? '?'} — ${commit?.subject ?? ''}\n  ${result.failureReason ?? ''}`,
    `Nothing was applied: the repo is back at ${result.startSha.slice(0, 8)}, exactly where it started.\n` +
      'Apply that commit by hand, or skip past it with `exclude.messages` in your .regraft.yml.',
  );
}
