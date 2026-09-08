import pc from 'picocolors';

let quiet = false;
let verbose = false;

export function configureLog(opts: { quiet?: boolean; verbose?: boolean }): void {
  quiet = opts.quiet ?? false;
  verbose = opts.verbose ?? false;
}

export const log = {
  /** Normal output. Silenced by --quiet. */
  info(message = ''): void {
    if (!quiet) process.stderr.write(`${message}\n`);
  },
  step(message: string): void {
    if (!quiet) process.stderr.write(`${pc.cyan('›')} ${message}\n`);
  },
  ok(message: string): void {
    if (!quiet) process.stderr.write(`${pc.green('✓')} ${message}\n`);
  },
  warn(message: string): void {
    process.stderr.write(`${pc.yellow('!')} ${message}\n`);
  },
  error(message: string): void {
    process.stderr.write(`${pc.red('✗')} ${message}\n`);
  },
  /** Only with --verbose. Every git invocation goes through here. */
  debug(message: string): void {
    if (verbose) process.stderr.write(`${pc.dim(`  ${message}`)}\n`);
  },
  /** Machine-readable output. Never silenced, always stdout. */
  out(message: string): void {
    process.stdout.write(`${message}\n`);
  },
};

export { pc };
