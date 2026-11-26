// Run with: node --test   (from the project root)
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { binProfile, extremes } from './elevation.js';

// 1 km at 10 m/s, 1 point per second, climbing 1 m every 10 m, burning 3.6 L/h (0.001 L/s)
const climb = Array.from({ length: 101 }, (_, i) => ({ d: i * 10, h: 100 + i, L: i * 0.001, s: i }));

test('binProfile: fewer than 2 points with altitude, or no distance, gives nothing', () => {
  assert.deepEqual(binProfile([]), []);
  assert.deepEqual(binProfile([{ d: 0, h: 5, L: 0, s: 0 }]), []);
  assert.deepEqual(binProfile([{ d: 0, h: 5, L: 0, s: 0 }, { d: 0, h: 6, L: 0, s: 5 }]), []);
  assert.deepEqual(binProfile([{ d: 0, h: null, L: 0, s: 0 }, { d: 10, h: null, L: 0, s: 1 }]), []);
});

test('binProfile: n stretches over the distance, altitude follows the road', () => {
  const bins = binProfile(climb, 10);
  assert.equal(bins.length, 10);
  assert.ok(bins[0].d < bins[9].d);
  assert.ok(bins[0].h < bins[9].h);
  assert.ok(bins[9].d <= 1000 && bins[9].h <= 200);
});

test('binProfile: the fuel rate of each stretch is fuel over time, in L/h', () => {
  for (const b of binProfile(climb, 10)) assert.ok(Math.abs(b.rate - 3.6) < 1e-9, String(b.rate));
});

test('binProfile: a stop inside a stretch lowers its rate (time passes, little fuel)', () => {
  // first half as before; then 60 s stopped at 500 m burning 0.36 L/h; then the rest
  const pts = climb.slice(0, 51);
  const stop = pts[50];
  for (let k = 1; k <= 60; k++) pts.push({ d: stop.d, h: stop.h, L: stop.L + k * 0.0001, s: stop.s + k });
  const resume = pts[pts.length - 1];
  for (let i = 51; i <= 100; i++) pts.push({ d: i * 10, h: 100 + i, L: resume.L + (i - 50) * 0.001, s: resume.s + (i - 50) });
  const bins = binProfile(pts, 10);
  const slowest = Math.min(...bins.map((b) => b.rate));
  assert.ok(slowest < 2, String(slowest));
});

test('binProfile: points without altitude are skipped', () => {
  const pts = climb.map((p, i) => (i % 2 ? { ...p, h: null } : p));
  assert.equal(binProfile(pts, 10).length, 10);
});

test('extremes: lowest and highest stretch', () => {
  const bins = [{ d: 0, h: 50 }, { d: 1, h: 20 }, { d: 2, h: 80 }, { d: 3, h: 20 }];
  assert.deepEqual(extremes(bins), { min: { d: 1, h: 20 }, max: { d: 2, h: 80 } });
  assert.equal(extremes([]), null);
});
