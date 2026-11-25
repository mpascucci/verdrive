// Run with: node --test   (from the project root)
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { distanceBetween, speedFromFixes } from './gps.js';

const near = (a, b, tol) => Math.abs(a - b) <= tol;

test('distanceBetween: 0.001° of latitude is about 111.2 m', () => {
  const d = distanceBetween({ lat: 45, lon: 7 }, { lat: 45.001, lon: 7 });
  assert.ok(near(d, 111.19, 0.2), `got ${d}`);
});

test('distanceBetween: a degree of longitude shrinks with the cosine of the latitude (about half at 60°)', () => {
  const equator = distanceBetween({ lat: 0, lon: 7 }, { lat: 0, lon: 7.001 });
  const at60 = distanceBetween({ lat: 60, lon: 7 }, { lat: 60, lon: 7.001 });
  assert.ok(near(at60 / equator, 0.5, 0.001), `ratio ${at60 / equator}`);
});

test('distanceBetween: the same point is 0 m, and the distance is the same in both directions', () => {
  const a = { lat: 45, lon: 7 }, b = { lat: 45.002, lon: 7.003 };
  assert.equal(distanceBetween(a, a), 0);
  assert.ok(near(distanceBetween(a, b), distanceBetween(b, a), 1e-9));
});

test('speedFromFixes: 111.2 m in 10 s is about 11.1 m/s', () => {
  const v = speedFromFixes({ lat: 45, lon: 7, t: 0 }, { lat: 45.001, lon: 7, t: 10000 });
  assert.ok(near(v, 11.119, 0.02), `got ${v}`);
});

test('speedFromFixes: no earlier fix gives null', () => {
  assert.equal(speedFromFixes(null, { lat: 45, lon: 7, t: 1000 }), null);
});

test('speedFromFixes: no time passed, or time going backwards, gives null', () => {
  const prev = { lat: 45, lon: 7, t: 5000 };
  assert.equal(speedFromFixes(prev, { lat: 45.001, lon: 7, t: 5000 }), null);
  assert.equal(speedFromFixes(prev, { lat: 45.001, lon: 7, t: 4000 }), null);
});

test('speedFromFixes: standing still gives 0 m/s', () => {
  assert.equal(speedFromFixes({ lat: 45, lon: 7, t: 0 }, { lat: 45, lon: 7, t: 2000 }), 0);
});
