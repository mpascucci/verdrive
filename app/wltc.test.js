// Run with: node --test
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { WLTC3B_KMH } from './wltc.js';

test('WLTC 3b: 1801 numeric samples (0..1800 s), starts and ends stopped', () => {
  assert.equal(WLTC3B_KMH.length, 1801);
  assert.ok(WLTC3B_KMH.every((x) => Number.isFinite(x) && x >= 0));
  assert.equal(WLTC3B_KMH[0], 0);
  assert.equal(WLTC3B_KMH[1800], 0);
});

test('WLTC 3b: published totals (23.27 km, max 131.3 km/h, mean 46.5 km/h)', () => {
  let m = 0;
  for (let i = 1; i < WLTC3B_KMH.length; i++) m += (WLTC3B_KMH[i] + WLTC3B_KMH[i - 1]) / 2 / 3.6;
  assert.ok(Math.abs(m / 1000 - 23.27) < 0.01);
  assert.equal(Math.max(...WLTC3B_KMH), 131.3);
  assert.ok(Math.abs((m / 1800) * 3.6 - 46.5) < 0.1);
});

test('WLTC 3b: phase boundaries are stopped, and no step is physically impossible', () => {
  for (const t of [589, 590, 1022, 1023, 1477, 1478]) assert.ok(WLTC3B_KMH[t] < 1, `t=${t}`);
  for (let i = 1; i < WLTC3B_KMH.length; i++) assert.ok(Math.abs(WLTC3B_KMH[i] - WLTC3B_KMH[i - 1]) / 3.6 < 2, `t=${i}`);
});

test('WLTC 3b: the sum of each phase equals the checksum printed in Regulation (EU) 2017/1151, Table A1/13 (class 3-2)', () => {
  const sum = (a, b) => Math.round(WLTC3B_KMH.slice(a, b + 1).reduce((x, y) => x + y, 0) * 10) / 10;
  assert.equal(sum(0, 589), 11140.3);      // Low
  assert.equal(sum(590, 1022), 17121.2);   // Medium
  assert.equal(sum(1023, 1477), 25782.2);  // High
  assert.equal(sum(1478, 1800), 29714.9);  // Extra High
  assert.equal(sum(0, 1800), 83758.6);     // Total
});
