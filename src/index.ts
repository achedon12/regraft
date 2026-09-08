/**
 * regraft as a library.
 *
 * The CLI is a thin shell over these; anything it can do, a script can do too.
 */
export { Git } from './core/git.ts';
export type { Commit, GitOptions, GitResult } from './core/git.ts';
export {
  loadConfig,
  parseConfig,
  renderConfig,
  writeConfig,
  findConfig,
  CONFIG_FILENAMES,
  TRAILER,
} from './core/config.ts';
export type {
  RegraftConfig,
  TemplateConfig,
  ProtectConfig,
  ExcludeConfig,
  LoadedConfig,
} from './core/config.ts';
export { buildPlan, lastGraftedSource, guessBaseFromDate, setUpTemplateRemote, BASE_SOURCE_LABEL } from './core/plan.ts';
export type { Plan, ResolveOptions } from './core/plan.ts';
export { graft, failureMessage } from './core/graft.ts';
export type { GraftResult, GraftOptions, OverwrittenFile } from './core/graft.ts';
export { preflight } from './core/preflight.ts';
export type { PreflightOptions } from './core/preflight.ts';
export { protectionFor, keepsOnConflict, matches } from './core/protect.ts';
export type { Protection, ProtectLists } from './core/protect.ts';
export { UserError, PreflightError } from './util/errors.ts';
