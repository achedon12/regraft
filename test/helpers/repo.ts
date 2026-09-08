import { mkdtempSync, rmSync, writeFileSync, mkdirSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';

/**
 * Real git repositories in temp dirs.
 *
 * regraft is a thin layer over git's own conflict machinery, so mocking git
 * would only test the mock. These build actual repos with actual histories.
 */
export class TestRepo {
  readonly dir: string;

  constructor(prefix = 'regraft-test-') {
    this.dir = mkdtempSync(join(tmpdir(), prefix));
    this.git(['init', '--quiet', '--initial-branch=main']);
    this.git(['config', 'user.name', 'Test']);
    this.git(['config', 'user.email', 'test@example.com']);
    this.git(['config', 'commit.gpgsign', 'false']);
  }

  git(args: string[]): { status: number; stdout: string; stderr: string } {
    const result = spawnSync('git', args, { cwd: this.dir, encoding: 'utf8' });
    return {
      status: result.status ?? 1,
      stdout: (result.stdout ?? '').trim(),
      stderr: (result.stderr ?? '').trim(),
    };
  }

  mustGit(args: string[]): string {
    const result = this.git(args);
    if (result.status !== 0) {
      throw new Error(`git ${args.join(' ')} failed in ${this.dir}: ${result.stderr || result.stdout}`);
    }
    return result.stdout;
  }

  write(path: string, content: string): this {
    const full = join(this.dir, path);
    mkdirSync(dirname(full), { recursive: true });
    writeFileSync(full, content, 'utf8');
    return this;
  }

  commit(message: string, date = '2024-01-01T00:00:00Z'): string {
    this.mustGit(['add', '-A']);
    this.mustGit(['-c', `user.name=Test`, 'commit', '--quiet', '--allow-empty', '-m', message, '--date', date]);
    return this.mustGit(['rev-parse', 'HEAD']);
  }

  head(): string {
    return this.mustGit(['rev-parse', 'HEAD']);
  }

  read(path: string): string {
    return spawnSync('cat', [join(this.dir, path)], { encoding: 'utf8' }).stdout ?? '';
  }

  log(): string[] {
    const out = this.mustGit(['log', '--format=%s']);
    return out ? out.split('\n') : [];
  }

  cleanup(): void {
    rmSync(this.dir, { recursive: true, force: true });
  }
}

/**
 * A template repo and a child made from it that share no ancestor — exactly
 * what "Use this template" produces, and the whole reason regraft exists.
 */
export function makeTemplateAndChild(): { template: TestRepo; child: TestRepo; baseSha: string } {
  const template = new TestRepo('regraft-template-');
  template.write('README.md', '# Template\n');
  template.write('src/app.js', 'export const version = 1;\n');
  template.write('theme.css', '.brand { color: blue; }\n');
  template.write('logo.svg', '<svg>template</svg>\n');
  template.commit('Initial template');
  const baseSha = template.head();

  // The child is a fresh repo with the template's files as one squashed commit,
  // so its history has no commit in common with the template's.
  const child = new TestRepo('regraft-child-');
  child.write('README.md', '# Template\n');
  child.write('src/app.js', 'export const version = 1;\n');
  child.write('theme.css', '.brand { color: red; }\n');
  child.write('logo.svg', '<svg>child</svg>\n');
  child.commit('Initial commit from template');

  return { template, child, baseSha };
}

export function writeConfigFile(child: TestRepo, template: TestRepo, extra = ''): void {
  child.write(
    '.regraft.yml',
    `template:\n  url: ${template.dir}\n  ref: main\n  remote: regraft-source\n${extra}`,
  );
}
