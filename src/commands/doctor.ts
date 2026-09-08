import type { Git } from '../core/git.ts';
import { findConfig, parseConfig, CONFIG_FILENAMES } from '../core/config.ts';
import { readFileSync } from 'node:fs';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { setUpTemplateRemote, lastGraftedSource } from '../core/plan.ts';
import { log, pc } from '../util/log.ts';

type Level = 'ok' | 'warn' | 'fail';

interface Check {
  name: string;
  level: Level;
  detail: string;
}

const MARK: Record<Level, string> = {
  ok: pc.green('✓'),
  warn: pc.yellow('!'),
  fail: pc.red('✗'),
};

/**
 * Answers "why is this not working" without anyone having to read the source.
 *
 * Every check here corresponds to a way a graft fails confusingly rather than
 * cleanly.
 */
export function doctorCommand(git: Git): number {
  const checks: Check[] = [];
  const add = (name: string, level: Level, detail: string) => checks.push({ name, level, detail });

  const version = git.run(['--version']);
  if (version.status === 0) add('git', 'ok', version.stdout);
  else add('git', 'fail', 'git is not on PATH — regraft cannot do anything without it');

  if (!git.isRepository()) {
    add('repository', 'fail', `${git.cwd} is not a git repository`);
    return report(checks);
  }
  const root = git.toplevel();
  add('repository', 'ok', root);

  const branch = git.currentBranch();
  if (branch) add('branch', 'ok', branch);
  else add('branch', 'fail', 'HEAD is detached — check out a branch before grafting');

  add(
    'worktree',
    git.isDirty() ? 'fail' : 'ok',
    git.isDirty() ? 'uncommitted changes — commit or stash them first' : 'clean',
  );

  const upstream = git.upstream();
  if (!upstream) {
    add('upstream', 'warn', 'no upstream branch — regraft cannot tell whether you are up to date');
  } else {
    const [behind, ahead] = git.behindAhead(upstream);
    const state = behind === 0 && ahead === 0 ? 'ok' : behind > 0 ? 'fail' : 'warn';
    add('upstream', state, `${upstream} — ${behind} behind, ${ahead} ahead`);
  }

  const configPath = findConfig(root);
  if (!configPath) {
    add('config', 'fail', `no ${CONFIG_FILENAMES[0]} — run \`regraft init\``);
    return report(checks);
  }
  add('config', 'ok', configPath);

  let config;
  try {
    config = parseConfig(readFileSync(configPath, 'utf8'), configPath);
  } catch (error) {
    add('config syntax', 'fail', (error as Error).message);
    return report(checks);
  }
  add('config syntax', 'ok', 'valid');

  // A protected path that matches nothing is almost always a typo, and a typo
  // here is silent: the file it was meant to guard gets overwritten anyway.
  const missing: string[] = [];
  for (const path of [...config.protect.owned, ...config.protect.winsOnConflict]) {
    const clean = path.replace(/\/+$/, '');
    if (clean && !existsSync(join(root, clean))) missing.push(path);
  }
  if (missing.length > 0) {
    add('protect paths', 'warn', `not found in this repo: ${missing.join(', ')}`);
  } else {
    const total = config.protect.owned.length + config.protect.winsOnConflict.length;
    add('protect paths', total === 0 ? 'warn' : 'ok', total === 0 ? 'nothing is protected — the template wins every file' : `${total} path(s), all present`);
  }

  try {
    const { ref, branch: templateBranch } = setUpTemplateRemote(git, config);
    add('template', 'ok', `${config.template.url} (${templateBranch})`);

    const trailer = lastGraftedSource(git);
    if (config.base) add('base', 'ok', `${config.base.slice(0, 12)} — pinned in config`);
    else if (trailer) add('base', 'ok', `${trailer.slice(0, 12)} — from the last ${'Regraft-source'} trailer`);
    else add('base', 'fail', 'no starting point — run `regraft init` or pass --from');

    const base = config.base ?? trailer;
    if (base) {
      const resolved = git.resolve(base);
      if (!resolved) add('base reachable', 'fail', `${base.slice(0, 12)} is not a commit on the template`);
      else if (!git.ok(['merge-base', '--is-ancestor', resolved, ref]))
        add('base reachable', 'fail', `${base.slice(0, 12)} is not an ancestor of ${ref}`);
      else add('base reachable', 'ok', `on ${ref}`);
    }
  } catch (error) {
    add('template', 'fail', (error as Error).message);
  }

  return report(checks);
}

function report(checks: Check[]): number {
  const width = Math.max(...checks.map((check) => check.name.length));
  log.info();
  for (const check of checks) {
    log.info(`${MARK[check.level]} ${check.name.padEnd(width)}  ${pc.dim(check.detail)}`);
  }
  log.info();

  const failed = checks.filter((check) => check.level === 'fail').length;
  const warned = checks.filter((check) => check.level === 'warn').length;

  if (failed > 0) {
    log.error(`${failed} check${failed === 1 ? '' : 's'} failed.`);
    return 1;
  }
  if (warned > 0) log.warn(`${warned} warning${warned === 1 ? '' : 's'} — grafting will work, but read them.`);
  else log.ok('Ready to graft.');
  return 0;
}
