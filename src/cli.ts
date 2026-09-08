#!/usr/bin/env node
import { parseArgs } from 'node:util';
import { createRequire } from 'node:module';
import { Git } from './core/git.ts';
import { findConfig, parseConfig } from './core/config.ts';
import { readFileSync } from 'node:fs';
import { initCommand } from './commands/init.ts';
import { statusCommand } from './commands/status.ts';
import { applyCommand } from './commands/apply.ts';
import { doctorCommand } from './commands/doctor.ts';
import { UserError } from './util/errors.ts';
import { configureLog, log, pc } from './util/log.ts';

const require = createRequire(import.meta.url);

function version(): string {
  try {
    return require('../package.json').version as string;
  } catch {
    return '0.0.0';
  }
}

const HELP = `${pc.bold('regraft')} — keep a repo made from a template up to date with it

${pc.bold('USAGE')}
  regraft <command> [options]

${pc.bold('COMMANDS')}
  init      Write .regraft.yml, working out the template and a starting point
  status    List the template commits this repo is missing
  apply     Graft those commits onto the current branch
  doctor    Check the repo, the config and the template, and say what is wrong

${pc.bold('OPTIONS')}
  -C, --cwd <dir>    Run as if started in <dir>
      --from <sha>   Start from this template commit instead of the recorded one
      --limit <n>    Take at most n commits (apply, status)
      --dry-run      Work everything out, write nothing (apply)
      --allow-ahead  Graft even though the branch is ahead of its upstream (apply)
      --no-backup    Skip the safety tag (apply)
      --json         Machine-readable output (init excepted)
  -t, --template <url>  Template clone URL (init)
      --ref <branch>    Template branch to follow (init)
  -f, --force        Overwrite an existing .regraft.yml (init)
  -q, --quiet        Only errors
  -v, --verbose      Print every git command
  -h, --help         This text
  -V, --version      Version

${pc.bold('EXAMPLES')}
  regraft init --template https://github.com/acme/web-template.git
  regraft status --json
  regraft apply --limit 10
  regraft apply --dry-run

${pc.dim('Docs: https://github.com/achedon12/regraft')}
`;

export function run(argv: string[]): number {
  let parsed;
  try {
    parsed = parseArgs({
      args: argv,
      allowPositionals: true,
      strict: true,
      options: {
        cwd: { type: 'string', short: 'C' },
        from: { type: 'string' },
        limit: { type: 'string' },
        'dry-run': { type: 'boolean' },
        'allow-ahead': { type: 'boolean' },
        'no-backup': { type: 'boolean' },
        json: { type: 'boolean' },
        template: { type: 'string', short: 't' },
        ref: { type: 'string' },
        force: { type: 'boolean', short: 'f' },
        quiet: { type: 'boolean', short: 'q' },
        verbose: { type: 'boolean', short: 'v' },
        help: { type: 'boolean', short: 'h' },
        version: { type: 'boolean', short: 'V' },
      },
    });
  } catch (error) {
    throw new UserError((error as Error).message, 'Run `regraft --help` for the available options.');
  }

  const { values, positionals } = parsed;
  configureLog({ quiet: values.quiet, verbose: values.verbose });

  if (values.version) {
    log.out(version());
    return 0;
  }

  const command = positionals[0];
  if (values.help || !command) {
    process.stdout.write(HELP);
    return command ? 0 : values.help ? 0 : 1;
  }

  let limit: number | undefined;
  if (values.limit !== undefined) {
    limit = Number.parseInt(values.limit, 10);
    if (!Number.isInteger(limit) || limit < 1) {
      throw new UserError(`--limit must be a positive integer, got '${values.limit}'.`);
    }
  }

  const cwd = values.cwd ?? process.cwd();
  const git = new Git({ cwd, ...gitSettings(cwd) });

  switch (command) {
    case 'init':
      return initCommand(git, {
        template: values.template,
        ref: values.ref,
        from: values.from,
        force: values.force,
      });
    case 'status':
      return statusCommand(git, { json: values.json, from: values.from, limit });
    case 'apply':
      return applyCommand(git, {
        from: values.from,
        limit,
        dryRun: values['dry-run'],
        allowAhead: values['allow-ahead'],
        noBackup: values['no-backup'],
        json: values.json,
      });
    case 'doctor':
      return doctorCommand(git);
    default:
      throw new UserError(
        `Unknown command '${command}'.`,
        'Available: init, status, apply, doctor. Run `regraft --help`.',
      );
  }
}

/**
 * The two git settings the config can override are needed *before* the config
 * can be read through Git, so they are read straight off disk here. A bad
 * config is ignored at this point; the command that follows reports it properly.
 */
function gitSettings(cwd: string): { safeDirectory: boolean; ignoreFileMode: boolean } {
  try {
    const probe = new Git({ cwd });
    const path = probe.isRepository() ? findConfig(probe.toplevel()) : null;
    if (!path) return { safeDirectory: true, ignoreFileMode: true };
    const config = parseConfig(readFileSync(path, 'utf8'), path);
    return config.git;
  } catch {
    return { safeDirectory: true, ignoreFileMode: true };
  }
}

const isMain = process.argv[1] && import.meta.url === `file://${process.argv[1]}`;

if (isMain) {
  try {
    process.exitCode = run(process.argv.slice(2));
  } catch (error) {
    if (error instanceof UserError) {
      log.error(error.message);
      if (error.hint) log.info(pc.dim(`  ${error.hint.split('\n').join('\n  ')}`));
      process.exitCode = 2;
    } else {
      log.error('regraft hit an unexpected error. This is a bug, please report it:');
      log.info(pc.dim('  https://github.com/achedon12/regraft/issues/new?template=bug_report.yml'));
      log.info();
      log.info(String((error as Error).stack ?? error));
      process.exitCode = 3;
    }
  }
}
