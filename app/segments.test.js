// Run with: node --test   (from the project root)
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { segmentPaths } from './segments.js';

const lit = (text) => segmentPaths(text).segments.filter((s) => s.on).length;

test('segmentPaths: seven segments per digit, the right ones lit', () => {
  assert.equal(segmentPaths('8').segments.length, 7);
  assert.equal(lit('8'), 7);
  assert.equal(lit('1'), 2);
  assert.equal(lit('7'), 3);
  assert.equal(lit('0'), 6);
  assert.equal(lit('—'), 1); // no value yet: the middle bar
});

test('segmentPaths: a decimal point or comma is one lit square; unknown characters are skipped', () => {
  const r = segmentPaths('14.2');
  assert.equal(r.segments.length, 7 * 3 + 1);
  assert.deepEqual(segmentPaths('14,2').segments, r.segments);
  assert.deepEqual(segmentPaths('1x4.2').segments, r.segments);
});

test('segmentPaths: width grows with each character; the point is narrow', () => {
  const one = segmentPaths('1').width, two = segmentPaths('11').width, dot = segmentPaths('1.1').width;
  assert.equal(one, 20);
  assert.equal(two, 44.5);
  assert.ok(dot > two && dot < two + 10, String(dot));
  assert.equal(segmentPaths('').width, 0);
});

test('segmentPaths: everything sits on or above the baseline', () => {
  for (const s of segmentPaths('8.8').segments) {
    for (const [, y] of s.d.matchAll(/[\d.-]+,([\d.-]+)/g)) assert.ok(Number(y) <= 0.01, s.d);
  }
});
