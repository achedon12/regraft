import type { Git, Commit } from './git.ts';
import type { RegraftConfig } from './config.ts';
import { TRAILER } from './config.ts';
import { UserError } from '../util/errors.ts';
import { log } from '../util/log.ts';

export interface Plan {
  /** Remote-tracking ref the template branch resolves to, e.g. `regraft-source/main`. */
  templateRef: string;
  /** Template branch name. */
  templateBranch: string;
  /** Resume point: the last template commit already present here. */
  base: string;
  /** How the base was decided — surfaced so nobody has to guess. */
  baseSource: 'flag' | 'config' | 'trailer' | 'date';
  /** Template commits missing here, oldest first, exclusions already applied. */
  commits: Commit[];
  /** Commits skipped by `exclude.messages`. */
  excluded: Commit[];
}

/**
 * Reads the newest `Regraft-source:` trailer in this repo's history.
 *
 * This is the resume point as a recorded fact rather than a deduction: the last
 * graft wrote down exactly which template commit it stopped at.
 */
export function lastGraftedSource(git: Git): string | null {
  const out = git.run(['log', `--grep=^${TRAILER}: `, '-n', '1', '--format=%B']);
  if (out.status !== 0 || !out.stdout) return null;
  const matches = [...out.stdout.matchAll(new RegExp(`^${TRAILER}:\\s*([0-9a-f]{7,40})\\s*$`, 'gm'))];
  return matches.at(-1)?.[1] ?? null;
}

/**
 * Guesses the template commit this repo was copied from, by date.
 *
 * A repo made with "Use this template" starts with a single squashed commit
 * dated the moment of the copy. The template commit that was current at that
 * instant is the honest starting point, and it is right far more often than any
 * content-based guess.
 */
export function guessBaseFromDate(git: Git, templateRef: string): string | null {
  const rootDate = git.rootCommitDate();
  if (!rootDate) return null;
  return git.lastCommitBefore(templateRef, rootDate);
}

export interface ResolveOptions {
  /** `--from` on the command line. Beats every other source. */
  from?: string;
  /** Allow falling back to the date guess. `init` wants this; `apply` does not. */
  allowDateGuess?: boolean;
}

export function setUpTemplateRemote(git: Git, config: RegraftConfig): { ref: string; branch: string } {
  const remote = config.template.remote ?? 'regraft-source';

  const existing = git.remoteUrl(remote);
  if (existing !== config.template.url) {
    log.debug(`pointing remote '${remote}' at ${config.template.url}`);
    git.setRemote(remote, config.template.url);
  }
  git.fetch(remote, ['--tags', '--prune']);

  const branch = config.template.ref ?? git.remoteDefaultBranch(remote);
  if (!branch) {
    throw new UserError(
      `Could not work out which branch to follow on ${config.template.url}.`,
      'Set `template.ref` in your .regraft.yml.',
    );
  }

  const ref = `${remote}/${branch}`;
  if (!git.resolve(ref)) {
    throw new UserError(
      `The template has no branch named '${branch}'.`,
      `Fetched from ${config.template.url}. Check \`template.ref\` in your .regraft.yml.`,
    );
  }

  return { ref, branch };
}

export function buildPlan(git: Git, config: RegraftConfig, options: ResolveOptions = {}): Plan {
  const { ref: templateRef, branch: templateBranch } = setUpTemplateRemote(git, config);

  let base: string | null = null;
  let baseSource: Plan['baseSource'] = 'trailer';

  if (options.from) {
    base = git.resolve(options.from);
    if (!base) {
      throw new UserError(
        `--from ${options.from} does not resolve to a commit on the template.`,
        `Try \`git log --oneline ${templateRef}\` to find one.`,
      );
    }
    baseSource = 'flag';
  } else {
    // The trailer and the configured base are both candidates, and the one
    // further along the template branch wins.
    //
    // The trailer records what was actually grafted, so it normally wins and
    // the run advances. But a configured base that sits *ahead* of it is a
    // deliberate "start from here instead" — squashed history, a deliberate
    // skip — and must not be dragged backwards by a stale trailer.
    let configured: string | null = null;
    if (config.base) {
      configured = git.resolve(config.base);
      if (!configured) {
        throw new UserError(
          `\`base: ${config.base}\` in your config does not resolve to a commit on the template.`,
          'The template may have been force-pushed, or the SHA may be a typo.',
        );
      }
    }

    const trailer = lastGraftedSource(git);
    let recorded: string | null = null;
    if (trailer) {
      recorded = git.resolve(trailer);
      if (!recorded && !configured) {
        throw new UserError(
          `This repo records ${TRAILER}: ${trailer}, but the template has no such commit.`,
          'The template branch was probably rewritten. Pick a new starting point with `--from`.',
        );
      }
    }

    if (recorded && configured) {
      const configuredIsBehind = git.ok(['merge-base', '--is-ancestor', configured, recorded]);
      base = configuredIsBehind ? recorded : configured;
      baseSource = configuredIsBehind ? 'trailer' : 'config';
    } else if (recorded) {
      base = recorded;
      baseSource = 'trailer';
    } else if (configured) {
      base = configured;
      baseSource = 'config';
    } else if (options.allowDateGuess) {
      base = guessBaseFromDate(git, templateRef);
      baseSource = 'date';
    }
  }

  if (!base) {
    throw new UserError(
      'No starting point: this repo has never been grafted and none is configured.',
      'Run `regraft init` to have one worked out from the repo\'s creation date, ' +
        'or pass `--from <template-sha>` to choose it yourself.',
    );
  }

  // The base must be on the template branch. Otherwise the range would be
  // computed against an unrelated commit and every single commit would look
  // missing.
  if (!git.ok(['merge-base', '--is-ancestor', base, templateRef])) {
    throw new UserError(
      `The starting point ${base.slice(0, 8)} is not an ancestor of ${templateRef}.`,
      'It belongs to another branch of the template, or the branch was force-pushed. ' +
        'Pick a starting point on the branch you are following with `--from`.',
    );
  }

  const all = git.commitsBetween(base, templateRef);
  const patterns = config.exclude.messages.map((pattern) => new RegExp(pattern));
  const excluded: Commit[] = [];
  const commits: Commit[] = [];
  for (const commit of all) {
    if (patterns.some((pattern) => pattern.test(commit.subject))) excluded.push(commit);
    else commits.push(commit);
  }

  return { templateRef, templateBranch, base, baseSource, commits, excluded };
}

export const BASE_SOURCE_LABEL: Record<Plan['baseSource'], string> = {
  flag: 'given with --from',
  config: 'pinned in .regraft.yml',
  trailer: `read from the last ${TRAILER} trailer`,
  date: "guessed from this repo's first commit date",
};
