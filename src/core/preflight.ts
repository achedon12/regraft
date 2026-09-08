import type { Git } from './git.ts';
import { PreflightError } from '../util/errors.ts';
import { log } from '../util/log.ts';

export interface PreflightOptions {
  /** Grafting onto a branch that is ahead of its upstream is allowed with this. */
  allowAhead?: boolean;
  /** Only `status`-style reads follow; skip the write-safety checks. */
  readOnly?: boolean;
}

/**
 * Refuses to start on a repository that is not in a fit state, and says which
 * check stopped it.
 *
 * Every one of these is a way a graft goes wrong quietly rather than loudly.
 */
export function preflight(git: Git, options: PreflightOptions = {}): void {
  if (!git.isRepository()) {
    throw new PreflightError(
      `${git.cwd} is not a git repository.`,
      'Run regraft from inside the repository you want to update.',
    );
  }

  const branch = git.currentBranch();
  if (!branch) {
    throw new PreflightError(
      'HEAD is detached.',
      'Check out the branch you want to graft onto first.',
    );
  }

  if (options.readOnly) return;

  if (git.isDirty()) {
    throw new PreflightError(
      'The working tree has uncommitted changes.',
      'A graft rewrites tracked files commit by commit; it would bury work in progress. ' +
        'Commit or stash first. (Untracked files are left alone and do not count here.)',
    );
  }

  const upstream = git.upstream();
  if (!upstream) {
    log.warn(`'${branch}' has no upstream branch — regraft will not be able to check whether you are up to date.`);
    return;
  }

  const [behind, ahead] = git.behindAhead(upstream);

  if (behind > 0) {
    throw new PreflightError(
      `'${branch}' is ${behind} commit${behind === 1 ? '' : 's'} behind ${upstream}.`,
      'Pull first. Grafting onto a stale base would produce commits nobody can fast-forward.',
    );
  }

  if (ahead > 0 && !options.allowAhead) {
    throw new PreflightError(
      `'${branch}' is ${ahead} commit${ahead === 1 ? '' : 's'} ahead of ${upstream}.`,
      'Those commits would be pushed along with the graft as a side effect. Push them ' +
        'yourself first, or pass --allow-ahead if that is what you want.',
    );
  }
}
