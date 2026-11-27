// Run with: node --test   (from the project root)
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { segmentPaths, fixedDigits } from './segments.js';

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

test('segmentPaths: a space is an unlit digit, "_" an unlit point', () => {
  assert.equal(segmentPaths(' ').segments.length, 7);
  assert.equal(lit(' '), 0);
  assert.equal(lit('8_8'), 14);
  assert.equal(segmentPaths('8_8').width, segmentPaths('8.8').width);
});

test('fixedDigits: always four digits and a point, so the width never changes', () => {
  assert.equal(fixedDigits(8.54), '  8.5');
  assert.equal(fixedDigits(0), '  0.0');
  assert.equal(fixedDigits(35.8), ' 35.8');
  assert.equal(fixedDigits(123.44), '123.4');
  assert.equal(fixedDigits(999.94), '999.9');
  assert.equal(fixedDigits(999.96), '100_0');
  assert.equal(fixedDigits(1234.4), '123_4');
  assert.equal(fixedDigits(50000), '999_9');
  for (const v of [null, NaN, Infinity, -1]) assert.equal(fixedDigits(v), '---_-');
  const w = segmentPaths('888.8').width;
  for (const v of [null, 1.2, 12.3, 456.7, 4567]) assert.equal(segmentPaths(fixedDigits(v)).width, w, String(v));
});
