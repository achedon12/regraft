import type { Git } from '../core/git.ts';
import { loadConfig } from '../core/config.ts';
import { buildPlan, BASE_SOURCE_LABEL } from '../core/plan.ts';
import { preflight } from '../core/preflight.ts';
import { log, pc } from '../util/log.ts';

export interface StatusOptions {
  json?: boolean;
  from?: string;
  limit?: number;
}

/**
 * Exit code is the point: 0 up to date, 1 behind. That makes
 * `regraft status || regraft apply` a valid pipeline step.
 */
export function statusCommand(git: Git, options: StatusOptions): number {
  const { config, path } = loadConfig(git.toplevel());
  preflight(git, { readOnly: true });

  const plan = buildPlan(git, config, { from: options.from });
  const behind = plan.commits.length;

  if (options.json) {
    log.out(
      JSON.stringify(
        {
          repository: git.toplevel(),
          config: path,
          template: { url: config.template.url, branch: plan.templateBranch },
          base: plan.base,
          baseSource: plan.baseSource,
          behind,
          upToDate: behind === 0,
          commits: plan.commits.map((commit) => ({
            sha: commit.sha,
            shortSha: commit.shortSha,
            subject: commit.subject,
            author: commit.author,
            date: commit.authorDate,
          })),
          excluded: plan.excluded.map((commit) => ({ sha: commit.sha, subject: commit.subject })),
          protect: config.protect,
        },
        null,
        2,
      ),
    );
    return behind === 0 ? 0 : 1;
  }

  log.info(`${pc.bold('template')}  ${config.template.url} ${pc.dim(`(${plan.templateBranch})`)}`);
  log.info(`${pc.bold('base')}      ${plan.base.slice(0, 12)} ${pc.dim(`— ${BASE_SOURCE_LABEL[plan.baseSource]}`)}`);
  log.info();

  if (behind === 0) {
    log.ok('Up to date with the template.');
    if (plan.excluded.length > 0) {
      log.info(pc.dim(`  ${plan.excluded.length} commit(s) skipped by exclude.messages`));
    }
    return 0;
  }

  log.info(`${pc.yellow(pc.bold(`${behind} commit${behind === 1 ? '' : 's'} behind`))} the template:`);
  log.info();

  const shown = options.limit ? plan.commits.slice(0, options.limit) : plan.commits;
  for (const commit of shown) {
    log.info(`  ${pc.dim(commit.shortSha)}  ${commit.subject}`);
  }
  if (shown.length < behind) log.info(pc.dim(`  … and ${behind - shown.length} more`));

  if (plan.excluded.length > 0) {
    log.info();
    log.info(pc.dim(`  ${plan.excluded.length} commit(s) skipped by exclude.messages`));
  }

  log.info();
  log.info(pc.dim('Run `regraft apply` to graft them onto this branch.'));
  return 1;
}
