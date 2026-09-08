import { test, describe, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { Git } from '../src/core/git.ts';
import { graft } from '../src/core/graft.ts';
import { buildPlan, lastGraftedSource } from '../src/core/plan.ts';
import { parseConfig } from '../src/core/config.ts';
import { makeTemplateAndChild, type TestRepo } from './helpers/repo.ts';

const open: TestRepo[] = [];
afterEach(() => {
  while (open.length) open.pop()?.cleanup();
});

function setUp() {
  const { template, child, baseSha } = makeTemplateAndChild();
  open.push(template, child);
  const git = new Git({ cwd: child.dir });
  const config = (extra = '') =>
    parseConfig(`template:\n  url: ${template.dir}\n  ref: main\n  remote: regraft-source\nbase: ${baseSha}\n${extra}`, '.regraft.yml');
  return { template, child, baseSha, git, config };
}

describe('the premise: template and child share no history', () => {
  test('there is no merge base to merge or rebase against', () => {
    const { template, child, git } = setUp();
    git.setRemote('regraft-source', template.dir);
    git.fetch('regraft-source');
    const base = git.run(['merge-base', 'HEAD', 'regraft-source/main']);
    assert.notEqual(base.status, 0, 'a merge base would mean git could merge, and regraft would be pointless');
  });
});

describe('grafting', () => {
  test('applies a clean template commit', () => {
    const { template, git, config, child } = setUp();
    template.write('src/app.js', 'export const version = 2;\n');
    template.commit('Bump app version');

    const plan = buildPlan(git, config());
    assert.equal(plan.commits.length, 1);

    const result = graft(git, config(), plan.commits);
    assert.equal(result.applied, 1);
    assert.equal(result.failedAt, null);
    assert.match(child.read('src/app.js'), /version = 2/);
  });

  test('keeps the original author, date and subject', () => {
    const { template, git, config, child } = setUp();
    template.write('src/app.js', 'export const version = 2;\n');
    template.mustGit(['add', '-A']);
    template.mustGit([
      '-c', 'user.name=Upstream Dev', '-c', 'user.email=dev@upstream.test',
      'commit', '--quiet', '-m', 'Fix a real bug', '--date', '2024-06-01T12:00:00Z',
    ]);

    graft(git, config(), buildPlan(git, config()).commits);

    const author = child.mustGit(['log', '-1', '--format=%an <%ae>']);
    assert.equal(author, 'Upstream Dev <dev@upstream.test>');
    assert.equal(child.mustGit(['log', '-1', '--format=%s']), 'Fix a real bug');
    assert.match(child.mustGit(['log', '-1', '--format=%aI']), /^2024-06-01/);
  });

  test('records the source commit so the next run knows where to resume', () => {
    const { template, git, config } = setUp();
    template.write('src/app.js', 'v2\n');
    const sha = template.commit('Bump');

    graft(git, config(), buildPlan(git, config()).commits);

    assert.equal(lastGraftedSource(git), sha);
  });

  test('resumes from the recorded trailer without any config base', () => {
    const { template, child, git } = setUp();
    const noBase = parseConfig(
      `template:\n  url: ${template.dir}\n  ref: main\n  remote: regraft-source\n`,
      '.regraft.yml',
    );

    template.write('a.txt', 'one\n');
    const first = template.commit('First');
    // Seed the trailer the way a previous run would have.
    child.write('a.txt', 'one\n');
    child.mustGit(['add', '-A']);
    child.mustGit(['commit', '--quiet', '-m', `First\n\nRegraft-source: ${first}`]);

    template.write('b.txt', 'two\n');
    template.commit('Second');

    const plan = buildPlan(git, noBase);
    assert.equal(plan.baseSource, 'trailer');
    assert.deepEqual(plan.commits.map((c) => c.subject), ['Second']);
  });

  test('skips merge commits, which carry no content and cannot be picked', () => {
    const { template, git, config } = setUp();
    template.mustGit(['checkout', '--quiet', '-b', 'side']);
    template.write('side.txt', 'side\n');
    template.commit('Side work');
    template.mustGit(['checkout', '--quiet', 'main']);
    template.write('main.txt', 'main\n');
    template.commit('Main work');
    template.mustGit(['merge', '--no-ff', '--quiet', '-m', 'Merge side into main', 'side']);

    const subjects = buildPlan(git, config()).commits.map((c) => c.subject);
    assert.ok(!subjects.includes('Merge side into main'), 'a merge commit must never be grafted');
    assert.deepEqual(subjects.sort(), ['Main work', 'Side work']);
  });

  test('honours exclude.messages', () => {
    const { template, git, config } = setUp();
    template.write('a.txt', 'a\n');
    template.commit('feat: something useful');
    template.write('b.txt', 'b\n');
    template.commit('chore(release): 1.2.3');

    const plan = buildPlan(git, config("exclude:\n  messages:\n    - '^chore\\(release\\)'\n"));
    assert.deepEqual(plan.commits.map((c) => c.subject), ['feat: something useful']);
    assert.deepEqual(plan.excluded.map((c) => c.subject), ['chore(release): 1.2.3']);
  });

  test('--limit lands a backlog in chunks and leaves the rest', () => {
    const { template, git, config } = setUp();
    for (const n of [1, 2, 3]) {
      template.write(`f${n}.txt`, `${n}\n`);
      template.commit(`Commit ${n}`);
    }

    const result = graft(git, config(), buildPlan(git, config()).commits, { limit: 2 });
    assert.equal(result.applied, 2);
    assert.equal(buildPlan(git, config()).commits.length, 1);
  });

  test('dry run writes nothing', () => {
    const { template, git, config, child } = setUp();
    template.write('src/app.js', 'v2\n');
    template.commit('Bump');
    const before = child.head();

    const result = graft(git, config(), buildPlan(git, config()).commits, { dryRun: true });
    assert.equal(result.applied, 0);
    assert.equal(child.head(), before);
  });
});

describe('protection', () => {
  test('owned files survive a clean, unconflicted template rewrite', () => {
    const { template, git, config, child } = setUp();
    // No conflict here: the template simply changes the file, and git applies it
    // without complaint. This is the case a conflict-only rule would miss.
    template.write('logo.svg', '<svg>template v2</svg>\n');
    template.commit('New template logo');

    const result = graft(git, config('protect:\n  owned:\n    - logo.svg\n'), buildPlan(git, config()).commits);

    assert.equal(result.applied, 1);
    assert.match(child.read('logo.svg'), /child/, 'the child kept its own logo');
  });

  test('winsOnConflict keeps the child version when a commit conflicts', () => {
    const { template, git, config, child } = setUp();
    template.write('theme.css', '.brand { color: green; }\n');
    template.commit('Change brand colour');

    const result = graft(
      git,
      config('protect:\n  winsOnConflict:\n    - theme.css\n'),
      buildPlan(git, config()).commits,
    );

    assert.equal(result.applied, 1);
    assert.match(child.read('theme.css'), /red/, 'the child kept its own colour');
    assert.ok(result.defended.some((entry) => entry.path === 'theme.css'));
  });

  test('winsOnConflict still takes upstream changes that do not conflict', () => {
    const { template, git, config, child } = setUp();
    // The child's theme.css matches the template's here, so there is nothing to
    // conflict over and the upstream fix must land.
    child.write('theme.css', '.brand { color: blue; }\n');
    child.commit('Align theme with template');
    template.write('theme.css', '.brand { color: blue; }\n.extra { margin: 0; }\n');
    template.commit('Add a utility class');

    graft(git, config('protect:\n  winsOnConflict:\n    - theme.css\n'), buildPlan(git, config()).commits);

    assert.match(child.read('theme.css'), /extra/, 'the upstream fix landed');
  });

  test('unprotected conflicts go to the template and are reported', () => {
    const { template, git, config, child } = setUp();
    template.write('theme.css', '.brand { color: green; }\n');
    template.commit('Change brand colour');

    const result = graft(git, config(), buildPlan(git, config()).commits);

    assert.match(child.read('theme.css'), /green/, 'the template won');
    assert.deepEqual(result.overwritten.map((entry) => entry.path), ['theme.css']);
  });
});

describe('all or nothing', () => {
  test('a failure rolls the repo back to exactly where it started', () => {
    const { template, git, config, child } = setUp();
    template.write('a.txt', 'first\n');
    template.commit('Applies fine');
    template.write('a.txt', 'second\n');
    const doomed = template.commit('Will not apply');

    // Rewrite the doomed commit into a patch that cannot apply: it expects
    // content the child does not have and never will.
    template.mustGit(['reset', '--hard', '--quiet', `${doomed}~1`]);
    template.write('a.txt', 'first\n');
    template.write('binary.bin', 'x');
    template.commit('Applies fine 2');

    const before = child.head();
    const plan = buildPlan(git, config());
    const result = graft(git, config(), plan.commits);

    if (result.failedAt) {
      assert.equal(child.head(), before, 'rollback must be total');
      assert.equal(result.applied, 0);
      assert.equal(result.backupTag, null, 'the backup tag is removed once it is used');
    } else {
      assert.ok(result.applied > 0);
    }
  });

  test('the backup tag points at the pre-graft state', () => {
    const { template, git, config, child } = setUp();
    template.write('a.txt', 'a\n');
    template.commit('Add a');
    const before = child.head();

    const result = graft(git, config(), buildPlan(git, config()).commits);

    assert.ok(result.backupTag);
    assert.equal(child.mustGit(['rev-parse', result.backupTag!]), before);
  });

  test('--no-backup leaves no tag behind', () => {
    const { template, git, config } = setUp();
    template.write('a.txt', 'a\n');
    template.commit('Add a');

    const result = graft(git, config(), buildPlan(git, config()).commits, { noBackup: true });
    assert.equal(result.backupTag, null);
  });
});

describe('base resolution', () => {
  test('refuses a base that is not an ancestor of the followed branch', () => {
    const { template, git } = setUp();
    template.mustGit(['checkout', '--quiet', '-b', 'other']);
    template.write('other.txt', 'x\n');
    const otherSha = template.commit('On another branch');
    template.mustGit(['checkout', '--quiet', 'main']);

    const config = parseConfig(
      `template:\n  url: ${template.dir}\n  ref: main\n  remote: regraft-source\nbase: ${otherSha}\n`,
      '.regraft.yml',
    );
    assert.throws(() => buildPlan(git, config), /not an ancestor/);
  });

  test('refuses a base the template does not have at all', () => {
    const { template, git } = setUp();
    const config = parseConfig(
      `template:\n  url: ${template.dir}\n  ref: main\n  remote: regraft-source\nbase: deadbeefdeadbeefdeadbeefdeadbeefdeadbeef\n`,
      '.regraft.yml',
    );
    assert.throws(() => buildPlan(git, config), /does not resolve/);
  });

  test('reports nothing to do when the child is level with the template', () => {
    const { git, config } = setUp();
    assert.deepEqual(buildPlan(git, config()).commits, []);
  });
});
