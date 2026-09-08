import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { parseConfig, renderConfig } from '../src/core/config.ts';
import { UserError } from '../src/util/errors.ts';

const minimal = 'template:\n  url: https://github.com/acme/tpl.git\n';

describe('parseConfig', () => {
  test('accepts a minimal config and fills in defaults', () => {
    const config = parseConfig(minimal, '.regraft.yml');
    assert.equal(config.template.url, 'https://github.com/acme/tpl.git');
    assert.equal(config.template.remote, 'regraft-source');
    assert.deepEqual(config.protect, { owned: [], winsOnConflict: [] });
    assert.deepEqual(config.git, { safeDirectory: true, ignoreFileMode: true });
  });

  test('reads protect lists', () => {
    const config = parseConfig(
      `${minimal}protect:\n  owned:\n    - logo.svg\n  winsOnConflict:\n    - theme.css\n`,
      '.regraft.yml',
    );
    assert.deepEqual(config.protect.owned, ['logo.svg']);
    assert.deepEqual(config.protect.winsOnConflict, ['theme.css']);
  });

  test('rejects a missing template section', () => {
    assert.throws(() => parseConfig('protect: {}\n', '.regraft.yml'), UserError);
  });

  test('rejects a missing template url', () => {
    assert.throws(() => parseConfig('template:\n  ref: main\n', '.regraft.yml'), UserError);
  });

  test('refuses to manage the origin remote', () => {
    assert.throws(
      () => parseConfig(`${minimal}  remote: origin\n`, '.regraft.yml'),
      /cannot be `origin`/,
    );
  });

  test('rejects a protect list that is not a list of strings', () => {
    assert.throws(() => parseConfig(`${minimal}protect:\n  owned: logo.svg\n`, '.regraft.yml'), UserError);
  });

  test('rejects an invalid exclude regex rather than crashing later', () => {
    assert.throws(
      () => parseConfig(`${minimal}exclude:\n  messages:\n    - '[unclosed'\n`, '.regraft.yml'),
      /invalid regular expression/,
    );
  });

  test('reports invalid YAML as a user error, not a crash', () => {
    assert.throws(() => parseConfig('template:\n  url: "unterminated\n', '.regraft.yml'), UserError);
  });

  test('rejects a YAML list at the top level', () => {
    assert.throws(() => parseConfig('- one\n- two\n', '.regraft.yml'), UserError);
  });
});

describe('renderConfig', () => {
  test('round-trips through the parser', () => {
    const original = parseConfig(
      `${minimal}  ref: main\nbase: abc1234\nprotect:\n  owned:\n    - logo.svg\n  winsOnConflict:\n    - theme.css\n`,
      '.regraft.yml',
    );
    const reparsed = parseConfig(renderConfig(original), '.regraft.yml');
    assert.equal(reparsed.template.url, original.template.url);
    assert.equal(reparsed.template.ref, original.template.ref);
    assert.equal(reparsed.base, original.base);
    assert.deepEqual(reparsed.protect, original.protect);
  });

  test('the commented example lines stay valid YAML comments', () => {
    const rendered = renderConfig(parseConfig(minimal, '.regraft.yml'));
    assert.doesNotThrow(() => parseConfig(rendered, '.regraft.yml'));
    assert.match(rendered, /^# regraft/);
  });
});
