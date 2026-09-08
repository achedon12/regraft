import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { parse, stringify } from 'yaml';
import { UserError } from '../util/errors.ts';

export const CONFIG_FILENAMES = ['.regraft.yml', '.regraft.yaml'] as const;

/** The trailer regraft writes on every grafted commit, and reads back to resume. */
export const TRAILER = 'Regraft-source';

export interface TemplateConfig {
  /** Clone URL of the template repository. */
  url: string;
  /** Branch to follow on the template. Resolved from the remote when absent. */
  ref?: string;
  /** Name of the local remote regraft manages. Never `origin`. */
  remote?: string;
}

export interface ProtectConfig {
  /**
   * Paths restored from the child repo after *every* grafted commit.
   *
   * This is the repo's identity — logo, favicon, domain, ports, environment.
   * Unmergeable by nature: there is no sensible three-way merge of a PNG or of
   * a hostname. The template never gets to speak about these.
   */
  owned: string[];
  /**
   * Paths where the child repo wins, but only when a commit actually conflicts.
   *
   * The middle ground for files that are 90% template and 10% local: a theme
   * stylesheet, a translations directory. Marking them `owned` would deny them
   * every upstream fix; leaving them unprotected would erase the local part.
   */
  winsOnConflict: string[];
}

export interface ExcludeConfig {
  /** Commits whose subject matches any of these regexes are skipped. */
  messages: string[];
}

export interface GitConfig {
  safeDirectory: boolean;
  ignoreFileMode: boolean;
}

export interface RegraftConfig {
  template: TemplateConfig;
  /** Explicit resume point. When absent, the trailer in history is used. */
  base?: string;
  protect: ProtectConfig;
  exclude: ExcludeConfig;
  git: GitConfig;
}

export interface LoadedConfig {
  config: RegraftConfig;
  path: string;
}

const DEFAULTS = {
  remote: 'regraft-source',
  protect: { owned: [], winsOnConflict: [] },
  exclude: { messages: [] },
  git: { safeDirectory: true, ignoreFileMode: true },
} as const;

export function findConfig(root: string): string | null {
  for (const name of CONFIG_FILENAMES) {
    const candidate = join(root, name);
    if (existsSync(candidate)) return candidate;
  }
  return null;
}

function asStringArray(value: unknown, field: string): string[] {
  if (value === undefined || value === null) return [];
  if (!Array.isArray(value) || value.some((item) => typeof item !== 'string')) {
    throw new UserError(`\`${field}\` must be a list of strings.`);
  }
  return value as string[];
}

function asBoolean(value: unknown, field: string, fallback: boolean): boolean {
  if (value === undefined || value === null) return fallback;
  if (typeof value !== 'boolean') throw new UserError(`\`${field}\` must be true or false.`);
  return value;
}

/** Parses and validates a config, filling in defaults. Throws UserError on bad input. */
export function parseConfig(source: string, path: string): RegraftConfig {
  let raw: unknown;
  try {
    raw = parse(source);
  } catch (error) {
    throw new UserError(
      `${path} is not valid YAML: ${(error as Error).message}`,
      'Run `regraft doctor` after fixing it.',
    );
  }

  if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) {
    throw new UserError(`${path} must contain a YAML mapping.`);
  }

  const data = raw as Record<string, unknown>;
  const template = data.template;
  if (template === null || typeof template !== 'object' || Array.isArray(template)) {
    throw new UserError(
      `${path} is missing a \`template\` section.`,
      'Run `regraft init` to generate a valid config.',
    );
  }

  const templateData = template as Record<string, unknown>;
  if (typeof templateData.url !== 'string' || templateData.url.trim() === '') {
    throw new UserError(`\`template.url\` is required in ${path}.`);
  }
  if (templateData.ref !== undefined && typeof templateData.ref !== 'string') {
    throw new UserError('`template.ref` must be a string.');
  }
  if (templateData.remote !== undefined && typeof templateData.remote !== 'string') {
    throw new UserError('`template.remote` must be a string.');
  }
  if (templateData.remote === 'origin') {
    throw new UserError(
      '`template.remote` cannot be `origin`.',
      'regraft replaces the URL of the remote it manages. Pointing it at origin would ' +
        'detach the repo from the place it actually pushes to.',
    );
  }
  if (data.base !== undefined && data.base !== null && typeof data.base !== 'string') {
    throw new UserError(
      '`base` must be a commit SHA written as a string.',
      'An all-digit SHA is read as a number by YAML. Quote it:  base: "0123456789abcdef..."',
    );
  }

  const protect = (data.protect ?? {}) as Record<string, unknown>;
  const exclude = (data.exclude ?? {}) as Record<string, unknown>;
  const git = (data.git ?? {}) as Record<string, unknown>;

  const config: RegraftConfig = {
    template: {
      url: templateData.url.trim(),
      remote: (templateData.remote as string | undefined) ?? DEFAULTS.remote,
    },
    protect: {
      owned: asStringArray(protect.owned, 'protect.owned'),
      winsOnConflict: asStringArray(protect.winsOnConflict, 'protect.winsOnConflict'),
    },
    exclude: {
      messages: asStringArray(exclude.messages, 'exclude.messages'),
    },
    git: {
      safeDirectory: asBoolean(git.safeDirectory, 'git.safeDirectory', DEFAULTS.git.safeDirectory),
      ignoreFileMode: asBoolean(git.ignoreFileMode, 'git.ignoreFileMode', DEFAULTS.git.ignoreFileMode),
    },
  };

  if (typeof templateData.ref === 'string') config.template.ref = templateData.ref;
  if (typeof data.base === 'string') config.base = data.base;

  for (const pattern of config.exclude.messages) {
    try {
      new RegExp(pattern);
    } catch {
      throw new UserError(`\`exclude.messages\` contains an invalid regular expression: ${pattern}`);
    }
  }

  return config;
}

export function loadConfig(root: string): LoadedConfig {
  const path = findConfig(root);
  if (!path) {
    throw new UserError(
      `No ${CONFIG_FILENAMES[0]} found in ${root}.`,
      'Run `regraft init` to create one.',
    );
  }
  return { config: parseConfig(readFileSync(path, 'utf8'), path), path };
}

/** Renders a config as commented YAML. The comments are the documentation people actually read. */
export function renderConfig(config: RegraftConfig): string {
  const body = stringify(
    {
      template: {
        url: config.template.url,
        ...(config.template.ref ? { ref: config.template.ref } : {}),
      },
      ...(config.base ? { base: config.base } : {}),
      protect: {
        owned: config.protect.owned,
        winsOnConflict: config.protect.winsOnConflict,
      },
    },
    { lineWidth: 0 },
  );

  return `# regraft — https://github.com/achedon12/regraft
#
# This repository was created from a template. It shares no commit with it, so
# there is nothing to merge or rebase: regraft replays the template's new
# commits here as patches, keeping their original author, date and message.

${body}
#   owned          restored from this repo after every grafted commit. Its
#                  identity: logo, favicon, hostnames, ports, environment.
#                  The template never gets to speak about these.
#
#   winsOnConflict this repo wins, but only when a commit actually conflicts.
#                  For files that are mostly template and partly local — a theme
#                  stylesheet, a translations directory.
#
# Directories may be listed with or without a trailing slash.
#
# exclude:
#   messages:            # commits whose subject matches are never grafted
#     - '^chore\\(release\\)'
#
# git:
#   safeDirectory: true  # -c safe.directory=* (checkouts you do not own)
#   ignoreFileMode: true # -c core.fileMode=false (copied, not cloned, repos)
`;
}

export function writeConfig(path: string, config: RegraftConfig): void {
  writeFileSync(path, renderConfig(config), 'utf8');
}
