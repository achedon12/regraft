/**
 * Path protection rules.
 *
 * Two lists, deliberately not one. `owned` is restored after every grafted
 * commit; `winsOnConflict` only steps in when git could not merge a file on its
 * own. Everything else belongs to the template — and every file the template
 * overwrites is reported, because that is the only place a graft loses
 * something and it has to be visible.
 */

export type Protection = 'owned' | 'winsOnConflict' | null;

/** Trailing slashes are accepted so `locales/` and `locales` behave alike. */
function normalize(pattern: string): string {
  return pattern.replace(/\/+$/, '');
}

/** True when `file` is `pattern` itself or sits underneath it. */
export function matches(file: string, pattern: string): boolean {
  const base = normalize(pattern);
  if (base === '') return false;
  return file === base || file.startsWith(`${base}/`);
}

export interface ProtectLists {
  owned: string[];
  winsOnConflict: string[];
}

/** `owned` wins over `winsOnConflict` when a path appears in both. */
export function protectionFor(file: string, lists: ProtectLists): Protection {
  if (lists.owned.some((pattern) => matches(file, pattern))) return 'owned';
  if (lists.winsOnConflict.some((pattern) => matches(file, pattern))) return 'winsOnConflict';
  return null;
}

/** Whether the child repo keeps its version of `file` when a commit conflicts. */
export function keepsOnConflict(file: string, lists: ProtectLists): boolean {
  return protectionFor(file, lists) !== null;
}
