import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { matches, protectionFor, keepsOnConflict } from '../src/core/protect.ts';

describe('path matching', () => {
  test('matches the path itself', () => {
    assert.equal(matches('theme.css', 'theme.css'), true);
  });

  test('matches files under a directory', () => {
    assert.equal(matches('locales/fr.json', 'locales'), true);
    assert.equal(matches('locales/nested/fr.json', 'locales'), true);
  });

  test('tolerates a trailing slash, so `locales/` and `locales` behave alike', () => {
    assert.equal(matches('locales/fr.json', 'locales/'), true);
    assert.equal(matches('locales/fr.json', 'locales///'), true);
  });

  test('does not match a sibling that merely shares a prefix', () => {
    assert.equal(matches('locales-old/fr.json', 'locales'), false);
    assert.equal(matches('theme.css.map', 'theme.css'), false);
  });

  test('an empty pattern matches nothing rather than everything', () => {
    assert.equal(matches('anything', ''), false);
    assert.equal(matches('anything', '/'), false);
  });
});

describe('protection lookup', () => {
  const lists = { owned: ['logo.svg', 'config/'], winsOnConflict: ['theme.css', 'locales'] };

  test('classifies each list', () => {
    assert.equal(protectionFor('logo.svg', lists), 'owned');
    assert.equal(protectionFor('config/app.json', lists), 'owned');
    assert.equal(protectionFor('theme.css', lists), 'winsOnConflict');
    assert.equal(protectionFor('locales/fr.json', lists), 'winsOnConflict');
  });

  test('unlisted paths belong to the template', () => {
    assert.equal(protectionFor('src/app.js', lists), null);
    assert.equal(keepsOnConflict('src/app.js', lists), false);
  });

  test('owned wins when a path is in both lists', () => {
    const both = { owned: ['shared'], winsOnConflict: ['shared'] };
    assert.equal(protectionFor('shared/file.txt', both), 'owned');
  });

  test('both lists keep the child version on conflict', () => {
    assert.equal(keepsOnConflict('logo.svg', lists), true);
    assert.equal(keepsOnConflict('theme.css', lists), true);
  });
});
