import { join } from 'node:path';
import type { Git } from '../core/git.ts';
import { findConfig, writeConfig, CONFIG_FILENAMES, type RegraftConfig } from '../core/config.ts';
import { setUpTemplateRemote, guessBaseFromDate, lastGraftedSource } from '../core/plan.ts';
import { preflight } from '../core/preflight.ts';
import { UserError } from '../util/errors.ts';
import { log, pc } from '../util/log.ts';

export interface InitOptions {
  template?: string;
  ref?: string;
  from?: string;
  force?: boolean;
}

/**
 * Derives the template URL from `origin`, keeping host, org and transport.
 *
 * Deriving rather than asking matters: it preserves an SSH alias or a
 * self-hosted host, so the URL regraft ends up fetching is one the machine can
 * already authenticate against — the same one the repo pulls from every day.
 */
export function deriveTemplateUrl(originUrl: string, templateName: string): string {
  // `dirname` would eat the colon of an scp-style URL (git@host:org/repo.git)
  // and hand back something unusable, so the last path segment is replaced
  // textually instead.
  const withGitSuffix = /\.git$/.test(originUrl);
  const replaced = originUrl.replace(/[^/:]+?(\.git)?$/, templateName);
  return withGitSuffix && !replaced.endsWith('.git') ? `${replaced}.git` : replaced;
}

export function initCommand(git: Git, options: InitOptions): number {
  preflight(git, { readOnly: true });
  const root = git.toplevel();

  const existing = findConfig(root);
  if (existing && !options.force) {
    throw new UserError(
      `${existing} already exists.`,
      'Edit it directly, or pass --force to overwrite it.',
    );
  }

  const templateUrl = options.template ?? inferTemplate(git);
  if (!templateUrl) {
    throw new UserError(
      'Could not work out which template this repo came from.',
      'Pass it explicitly:  regraft init --template https://github.com/acme/web-template.git',
    );
  }

  const config: RegraftConfig = {
    template: { url: templateUrl, remote: 'regraft-source' },
    protect: { owned: [], winsOnConflict: [] },
    exclude: { messages: [] },
    git: { safeDirectory: true, ignoreFileMode: true },
  };
  if (options.ref) config.template.ref = options.ref;

  log.step(`Fetching ${templateUrl}`);
  const { ref, branch } = setUpTemplateRemote(git, config);
  config.template.ref = branch;

  // A base is only pinned when it had to be guessed. When history already
  // carries a trailer, the trailer is the better source and stays the source.
  const trailer = lastGraftedSource(git);
  let base: string | null = null;
  let how = '';

  if (options.from) {
    base = git.resolve(options.from);
    if (!base) throw new UserError(`--from ${options.from} is not a commit on ${ref}.`);
    how = 'given with --from';
  } else if (trailer) {
    how = 'already recorded in this repo\'s history';
  } else {
    base = guessBaseFromDate(git, ref);
    how = "guessed from this repo's first commit date";
  }

  if (base) {
    if (!git.ok(['merge-base', '--is-ancestor', base, ref])) {
      throw new UserError(
        `${base.slice(0, 8)} is not on ${ref}.`,
        'Pick a starting point on the branch you want to follow.',
      );
    }
    config.base = base;
  }

  const path = join(root, CONFIG_FILENAMES[0]);
  writeConfig(path, config);

  log.ok(`Wrote ${pc.bold(CONFIG_FILENAMES[0])}`);
  log.info();
  log.info(`  ${pc.bold('template')}  ${templateUrl}`);
  log.info(`  ${pc.bold('branch')}    ${branch}`);
  if (base) {
    const commit = git.commit(base);
    log.info(`  ${pc.bold('base')}      ${base.slice(0, 12)} ${pc.dim(`— ${how}`)}`);
    if (commit) log.info(`            ${pc.dim(commit.subject)}`);
  } else {
    log.info(`  ${pc.bold('base')}      ${pc.dim(how)}`);
  }

  log.info();
  if (how.startsWith('guessed')) {
    log.warn('That starting point is a guess. Check it before grafting:');
    log.info(pc.dim('  regraft status        # do the listed commits look unapplied here?'));
    log.info(pc.dim('  regraft init --from <sha> --force   # to correct it'));
    log.info();
  }
  log.info(pc.dim('Next: list what this repo owns under `protect` in .regraft.yml, then run `regraft status`.'));

  return 0;
}

/**
 * Best-effort guess of the template from the repo itself.
 *
 * GitHub records the template on the repo object, not in the git data, so there
 * is nothing local to read. An `upstream`/`template` remote is the one honest
 * local signal; anything beyond that would be invention.
 */
function inferTemplate(git: Git): string | null {
  for (const name of ['template', 'upstream', 'template-source', 'regraft-source']) {
    const url = git.remoteUrl(name);
    if (url) {
      log.info(pc.dim(`Using the '${name}' remote as the template: ${url}`));
      return url;
    }
  }
  return null;
}
