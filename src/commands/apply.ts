import type { Git } from '../core/git.ts';
import { loadConfig } from '../core/config.ts';
import { buildPlan, BASE_SOURCE_LABEL } from '../core/plan.ts';
import { preflight } from '../core/preflight.ts';
import { graft, failureMessage } from '../core/graft.ts';
import { log, pc } from '../util/log.ts';

export interface ApplyOptions {
  from?: string;
  limit?: number;
  dryRun?: boolean;
  allowAhead?: boolean;
  noBackup?: boolean;
  json?: boolean;
}

export function applyCommand(git: Git, options: ApplyOptions): number {
  const { config } = loadConfig(git.toplevel());
  preflight(git, { allowAhead: options.allowAhead });

  const plan = buildPlan(git, config, { from: options.from });

  if (plan.commits.length === 0) {
    if (options.json) log.out(JSON.stringify({ applied: 0, upToDate: true }, null, 2));
    else log.ok('Already up to date with the template. Nothing to graft.');
    return 0;
  }

  const selected = options.limit ? plan.commits.slice(0, options.limit) : plan.commits;

  log.info(`${pc.bold('template')}  ${config.template.url} ${pc.dim(`(${plan.templateBranch})`)}`);
  log.info(`${pc.bold('base')}      ${plan.base.slice(0, 12)} ${pc.dim(`— ${BASE_SOURCE_LABEL[plan.baseSource]}`)}`);
  log.info(
    `${pc.bold('grafting')}  ${selected.length} of ${plan.commits.length} commit${plan.commits.length === 1 ? '' : 's'}` +
      (options.dryRun ? pc.dim(' (dry run — nothing will be written)') : ''),
  );
  log.info();

  if (options.dryRun) {
    for (const commit of selected) log.info(`  ${pc.dim(commit.shortSha)}  ${commit.subject}`);
    log.info();
    log.ok('Dry run: no commit was created and no file was touched.');
    if (options.json) {
      log.out(JSON.stringify({ dryRun: true, wouldApply: selected.length }, null, 2));
    }
    return 0;
  }

  const result = graft(git, config, selected, {
    limit: options.limit,
    noBackup: options.noBackup,
  });

  if (result.failedAt) throw failureMessage(result);

  log.info();
  log.ok(`Grafted ${result.applied} commit${result.applied === 1 ? '' : 's'}.`);

  if (result.defended.length > 0) {
    const paths = [...new Set(result.defended.map((entry) => entry.path))];
    log.info();
    log.info(`${pc.green('kept')}  ${paths.length} protected file${paths.length === 1 ? '' : 's'}:`);
    for (const path of paths) log.info(`  ${path}`);
  }

  if (result.overwritten.length > 0) {
    const paths = [...new Set(result.overwritten.map((entry) => entry.path))];
    log.info();
    log.warn(`The template won ${paths.length} conflicted file${paths.length === 1 ? '' : 's'}:`);
    for (const path of paths) log.info(`  ${path}`);
    log.info();
    log.info(
      pc.dim(
        'This is the only place a graft loses something. If any of these belong to\n' +
          'this repo rather than the template, add them to `protect` in .regraft.yml\n' +
          `and re-run from ${result.startSha.slice(0, 8)}.`,
      ),
    );
  }

  if (result.backupTag) {
    log.info();
    log.info(pc.dim(`Undo with:  git reset --hard ${result.backupTag}`));
  }

  const remaining = plan.commits.length - result.applied;
  if (remaining > 0) {
    log.info(pc.dim(`${remaining} commit(s) still to graft. Run \`regraft apply\` again.`));
  }

  if (options.json) {
    log.out(
      JSON.stringify(
        {
          applied: result.applied,
          remaining,
          overwritten: [...new Set(result.overwritten.map((entry) => entry.path))],
          defended: [...new Set(result.defended.map((entry) => entry.path))],
          backupTag: result.backupTag,
          startSha: result.startSha,
        },
        null,
        2,
      ),
    );
  }

  return 0;
}
