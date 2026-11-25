// Run with: node --test   (from the project root)
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildId, reloadIfUpdateWaiting } from './update.js';

// Known FNV-1a 32-bit hashes, shortened to the first 7 hex digits.
test('buildId: matches the known FNV-1a values ("" , "a", "foobar")', () => {
  assert.equal(buildId(''), '811c9dc');        // 0x811c9dc5
  assert.equal(buildId('a'), 'e40c292');       // 0xe40c292c
  assert.equal(buildId('foobar'), 'bf9cf96');  // 0xbf9cf968
});

test('buildId: the same text always gives the same id', () => {
  assert.equal(buildId('some file content'), buildId('some file content'));
});

test('buildId: any change to the text changes the id', () => {
  const a = buildId('const x = 1;\n');
  assert.notEqual(a, buildId('const x = 2;\n'));
  assert.notEqual(a, buildId('const x = 1; \n'));
});

test('buildId: always 7 hex digits, also for long and non-ASCII text', () => {
  for (const text of ['', 'x', 'é€▲▼ — text', 'long '.repeat(5000)]) {
    assert.match(buildId(text), /^[0-9a-f]{7}$/);
  }
});

test('reloadIfUpdateWaiting: does nothing (and does not touch the page) when no update is waiting', () => {
  assert.equal(reloadIfUpdateWaiting(), false);
});
