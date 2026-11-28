// Run with: node --test
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { tractivePower, fuelRate, perHundredKm, smooth, toCost, slopeFromAltitude, smoothSlope, co2FromFuel, treeDays, slopeLength, consumptionFromCo2, idleFromDisplacement, maxPowerFromRated, dragAreaFromBody, testMass, simulateCycle, calibrateK, altitudeStep, styleLevel, styleFactors, styleMark, STYLE_ZERO_EXTRA, STYLE_MARK_MAX, CALM_TAU, REAL_WORLD_FACTOR, CDA_BY_BODY, CO2_PER_LITRE, TREE_KG_PER_YEAR } from './model.js';

import { WLTC3B_KMH } from './wltc.js';

const kmh = (x) => x / 3.6; // km/h -> m/s

// Tier 1 SUV preset from the roadmap
const SUV = { m: 2000, cdA: 0.90 };

test('SUV at 100 km/h, steady speed ≈ 17 kW', () => {
  const p = tractivePower({ ...SUV, v: kmh(100), a: 0 });
  assert.ok(Math.abs(p - 17000) < 300, `got ${p} W`);
});

test('stopped and not accelerating gives exactly 0 W', () => {
  assert.equal(tractivePower({ ...SUV, v: 0, a: 0 }), 0);
});

test('stopped gives 0 W even if acceleration is non-zero', () => {
  // power = force × speed, so v = 0 means no power
  assert.equal(tractivePower({ ...SUV, v: 0, a: 2 }), 0);
});

test('braking hard at moderate speed gives negative power', () => {
  const p = tractivePower({ ...SUV, v: kmh(50), a: -2 });
  assert.ok(p < 0, `got ${p} W`);
});

test('accelerating needs more power than cruising at the same speed', () => {
  const cruise = tractivePower({ ...SUV, v: kmh(50), a: 0 });
  const accel = tractivePower({ ...SUV, v: kmh(50), a: 1 });
  assert.ok(accel > cruise);
});

test('drag power scales with v³ (doubling speed gives 8×)', () => {
  // isolate drag: no rolling resistance, no acceleration
  const base = { m: 1000, cdA: 0.7, crr: 0, a: 0 };
  const p1 = tractivePower({ ...base, v: 10 });
  const p2 = tractivePower({ ...base, v: 20 });
  assert.ok(Math.abs(p2 / p1 - 8) < 1e-9);
});

test('rolling power scales linearly with speed (no drag, no accel)', () => {
  const base = { m: 1000, cdA: 0, a: 0 };
  const p1 = tractivePower({ ...base, v: 10 });
  const p2 = tractivePower({ ...base, v: 20 });
  assert.ok(Math.abs(p2 / p1 - 2) < 1e-9);
});

// ---- grade (theta) ----

// A road slope given as a percentage (5 = 5% grade) to the angle theta in radians.
const gradeToTheta = (percent) => Math.atan(percent / 100);

test('grade: leaving theta out is the same as theta = 0 (flat road)', () => {
  const base = { ...SUV, v: kmh(100), a: 0 };
  assert.equal(tractivePower(base), tractivePower({ ...base, theta: 0 }));
});

test('grade: 5% uphill at 100 km/h adds m·g·sinθ·v ≈ 27.2 kW (SUV ≈ 44 kW total)', () => {
  const base = { ...SUV, v: kmh(100), a: 0 };
  const theta = gradeToTheta(5);
  const extra = tractivePower({ ...base, theta }) - tractivePower(base);
  assert.ok(Math.abs(extra - 27216) < 50, `extra ${extra} W`);
  assert.ok(Math.abs(tractivePower({ ...base, theta }) - 44240) < 100);
});

test('grade: uphill and downhill by the same angle change the power by equal and opposite amounts', () => {
  const base = { ...SUV, v: kmh(80), a: 0 };
  const theta = gradeToTheta(4);
  const flat = tractivePower(base);
  const up = tractivePower({ ...base, theta }) - flat;
  const down = tractivePower({ ...base, theta: -theta }) - flat;
  assert.ok(up > 0 && down < 0);
  assert.ok(Math.abs(up + down) < 1e-6);
});

test('grade: 5% downhill at 100 km/h gives negative power (≈ −10.2 kW)', () => {
  const p = tractivePower({ ...SUV, v: kmh(100), a: 0, theta: gradeToTheta(-5) });
  assert.ok(Math.abs(p - -10192) < 100, `got ${p} W`);
});

test('grade: at about 3.1% downhill the SUV holds 100 km/h with zero power', () => {
  const p = tractivePower({ ...SUV, v: kmh(100), a: 0, theta: gradeToTheta(-3.125) });
  assert.ok(Math.abs(p) < 50, `got ${p} W`);
});

test('grade: stopped on a slope still needs 0 W (the brakes hold the car, not the engine)', () => {
  assert.equal(tractivePower({ ...SUV, v: 0, a: 0, theta: gradeToTheta(10) }), 0);
});

test('grade: slope power scales linearly with speed (no drag, no rolling, no accel)', () => {
  const only = { m: 2000, cdA: 0, crr: 0, a: 0, theta: gradeToTheta(5) };
  const p1 = tractivePower({ ...only, v: 10 });
  const p2 = tractivePower({ ...only, v: 20 });
  assert.ok(Math.abs(p2 / p1 - 2) < 1e-9);
});

test('grade + fuelRate: SUV at 100 km/h burns ≈ 20.9 L/h on a 5% climb and 0 on a 5% descent', () => {
  const ENG = { f0: 1.0, k: 0.45, pMax: 150000 };
  const base = { ...SUV, v: kmh(100), a: 0 };
  const climb = fuelRate({ ...ENG, v: base.v, p: tractivePower({ ...base, theta: gradeToTheta(5) }) });
  const descent = fuelRate({ ...ENG, v: base.v, p: tractivePower({ ...base, theta: gradeToTheta(-5) }) });
  assert.ok(Math.abs(climb - 20.9) < 0.1, `climb ${climb}`);
  assert.equal(descent, 0);
});

// ---- fuelRate ----

// Tier 1 SUV engine preset (gasoline); pMax is an example limit of 150 kW
const ENGINE = { f0: 1.0, k: 0.45, pMax: 150000 };

test('fuelRate: SUV at 17 kW, 100 km/h ≈ 8.65 L/h', () => {
  const f = fuelRate({ ...ENGINE, p: 17000, v: kmh(100) });
  assert.ok(Math.abs(f - 8.65) < 1e-9, `got ${f}`);
});

test('fuelRate: stopped without start-stop gives idle f0', () => {
  assert.equal(fuelRate({ ...ENGINE, p: 0, v: 0 }), 1.0);
});

test('fuelRate: stopped with start-stop gives 0', () => {
  assert.equal(fuelRate({ ...ENGINE, p: 0, v: 0, startStop: true }), 0);
});

test('fuelRate: coasting (P < 0, 60 km/h) gives 0', () => {
  assert.equal(fuelRate({ ...ENGINE, p: -5000, v: kmh(60) }), 0);
});

test('fuelRate: slow and decelerating (P < 0, 10 km/h) gives f0', () => {
  assert.equal(fuelRate({ ...ENGINE, p: -5000, v: kmh(10) }), 1.0);
});

test('fuelRate: power above pMax is clamped', () => {
  const atMax = fuelRate({ ...ENGINE, p: 150000, v: kmh(100) });
  const spike = fuelRate({ ...ENGINE, p: 1e7, v: kmh(100) });
  assert.equal(spike, atMax);
});

test('fuelRate: very negative power is clamped like ordinary negative power', () => {
  // fast: still coasting -> 0; slow: still idle -> f0
  assert.equal(fuelRate({ ...ENGINE, p: -1e7, v: kmh(60) }), 0);
  assert.equal(fuelRate({ ...ENGINE, p: -1e7, v: kmh(10) }), 1.0);
});

test('fuelRate: never negative', () => {
  for (const p of [-1e7, -5000, 0, 5000, 1e7]) {
    for (const v of [0, kmh(10), kmh(60), kmh(130)]) {
      for (const startStop of [false, true]) {
        const f = fuelRate({ ...ENGINE, p, v, startStop });
        assert.ok(f >= 0, `p=${p} v=${v} gave ${f}`);
      }
    }
  }
});

// ---- display: perHundredKm, smooth, toCost ----

test('perHundredKm: SUV at 100 km/h, 8.65 L/h gives 8.65 L/100 km', () => {
  const r = perHundredKm({ f: 8.65, v: kmh(100) });
  assert.ok(Math.abs(r - 8.65) < 1e-9, `got ${r}`);
});

test('perHundredKm: null when (almost) stopped', () => {
  assert.equal(perHundredKm({ f: 1.0, v: 0 }), null);
  assert.equal(perHundredKm({ f: 1.0, v: 0.3 }), null);
});

test('smooth: converges to a constant input', () => {
  let s = 0;
  for (let i = 0; i < 100; i++) s = smooth({ prev: s, value: 10, dt: 1 });
  assert.ok(Math.abs(s - 10) < 1e-6, `got ${s}`);
});

test('smooth: dt = 0 leaves the value unchanged', () => {
  assert.equal(smooth({ prev: 3, value: 10, dt: 0 }), 3);
});

test('smooth: a larger dt moves further toward the input', () => {
  const small = smooth({ prev: 0, value: 10, dt: 0.5 });
  const large = smooth({ prev: 0, value: 10, dt: 2 });
  assert.ok(large > small && large < 10);
});

test('smooth: after dt = tau, covers 1 − 1/e of the gap', () => {
  const s = smooth({ prev: 0, value: 10, dt: 2, tau: 2 });
  assert.ok(Math.abs(s - 10 * (1 - Math.exp(-1))) < 1e-9);
});

test('toCost: litres × price, also for L/h → €/h', () => {
  assert.ok(Math.abs(toCost({ litres: 8.65, price: 1.8 }) - 15.57) < 1e-9);
});

// ---- slopeFromAltitude ----

test('slopeFromAltitude: 5 m climb over 100 m gives θ = atan(0.05) ≈ 2.87°', () => {
  const theta = slopeFromAltitude({ dh: 5, dist: 100 });
  assert.ok(Math.abs(theta - Math.atan(0.05)) < 1e-12);
  assert.ok(Math.abs(theta * 180 / Math.PI - 2.866) < 0.01);
});

test('slopeFromAltitude: a descent gives a negative angle, equal and opposite to the climb', () => {
  const up = slopeFromAltitude({ dh: 5, dist: 100 });
  const down = slopeFromAltitude({ dh: -5, dist: 100 });
  assert.ok(down < 0);
  assert.ok(Math.abs(up + down) < 1e-12);
});

test('slopeFromAltitude: flat gives 0', () => {
  assert.equal(slopeFromAltitude({ dh: 0, dist: 100 }), 0);
});

test('slopeFromAltitude: too short a distance gives null (noise, no answer yet)', () => {
  assert.equal(slopeFromAltitude({ dh: 3, dist: 10 }), null);
  assert.equal(slopeFromAltitude({ dh: 3, dist: 49.9 }), null);
});

test('slopeFromAltitude: exactly minDist is accepted', () => {
  assert.notEqual(slopeFromAltitude({ dh: 2, dist: 50 }), null);
});

test('slopeFromAltitude: zero, negative or NaN distance gives null', () => {
  assert.equal(slopeFromAltitude({ dh: 1, dist: 0 }), null);
  assert.equal(slopeFromAltitude({ dh: 1, dist: -80 }), null);
  assert.equal(slopeFromAltitude({ dh: 1, dist: NaN }), null);
});

test('slopeFromAltitude: an impossible altitude jump is clamped to ±25%', () => {
  const limit = Math.atan(0.25);
  assert.ok(Math.abs(slopeFromAltitude({ dh: 30, dist: 60 }) - limit) < 1e-12);
  assert.ok(Math.abs(slopeFromAltitude({ dh: -30, dist: 60 }) + limit) < 1e-12);
  assert.ok(Math.abs(slopeFromAltitude({ dh: 80, dist: 60 }) - limit) < 1e-12); // |dh| > dist: the clamp keeps the angle at the limit
});

test('slopeFromAltitude: a real 20% climb is not clamped by the default limit', () => {
  const theta = slopeFromAltitude({ dh: 20, dist: 100 });
  assert.ok(Math.abs(theta - Math.atan(0.20)) < 1e-12);
});

test('slopeFromAltitude: minDist and maxGrade can be changed', () => {
  assert.notEqual(slopeFromAltitude({ dh: 1, dist: 20, minDist: 10 }), null);
  assert.ok(Math.abs(slopeFromAltitude({ dh: 20, dist: 100, maxGrade: 0.1 }) - Math.atan(0.1)) < 1e-12);
});

test('slopeFromAltitude feeds tractivePower: 5 m over 100 m adds ≈ 27.3 kW for the SUV at 100 km/h', () => {
  const base = { ...SUV, v: kmh(100), a: 0 };
  const theta = slopeFromAltitude({ dh: 5, dist: 100 });
  const extra = tractivePower({ ...base, theta }) - tractivePower(base);
  assert.ok(Math.abs(extra - 27250) < 50, `extra ${extra} W`);
});

// ---- smoothSlope ----

const FIVE_PERCENT = Math.asin(0.05);

test('smoothSlope: theta null holds the previous value', () => {
  assert.equal(smoothSlope({ prev: 0.03, theta: null, dist: 60 }), 0.03);
});

test('smoothSlope: no slope so far and nothing new stays null', () => {
  assert.equal(smoothSlope({ prev: null, theta: null, dist: 60 }), null);
});

test('smoothSlope: the first value starts the filter', () => {
  assert.equal(smoothSlope({ prev: null, theta: FIVE_PERCENT, dist: 60 }), FIVE_PERCENT);
});

test('smoothSlope: a constant slope converges', () => {
  let s = 0;
  for (let i = 0; i < 100; i++) s = smoothSlope({ prev: s, theta: FIVE_PERCENT, dist: 50 });
  assert.ok(Math.abs(s - FIVE_PERCENT) < 1e-9, `got ${s}`);
});

test('smoothSlope: dist = 0 leaves the value unchanged', () => {
  assert.equal(smoothSlope({ prev: 0.01, theta: 0.08, dist: 0 }), 0.01);
});

test('smoothSlope: a longer distance moves further toward the new value, without overshooting', () => {
  const short = smoothSlope({ prev: 0, theta: FIVE_PERCENT, dist: 50 });
  const long = smoothSlope({ prev: 0, theta: FIVE_PERCENT, dist: 300 });
  assert.ok(short > 0 && long > short && long < FIVE_PERCENT);
});

test('smoothSlope: the default length is 100 m: after 100 m it covers 1 − 1/e ≈ 63% of the gap', () => {
  const s = smoothSlope({ prev: 0, theta: FIVE_PERCENT, dist: 100 });
  assert.ok(Math.abs(s - FIVE_PERCENT * (1 - Math.exp(-1))) < 1e-12);
  assert.equal(s, smoothSlope({ prev: 0, theta: FIVE_PERCENT, dist: 100, length: 100 }));
});

test('smoothSlope: two 50 m steps equal one 100 m step', () => {
  const half = smoothSlope({ prev: 0, theta: FIVE_PERCENT, dist: 50 });
  const twice = smoothSlope({ prev: half, theta: FIVE_PERCENT, dist: 50 });
  const once = smoothSlope({ prev: 0, theta: FIVE_PERCENT, dist: 100 });
  assert.ok(Math.abs(twice - once) < 1e-12);
});

test('smoothSlope: a step from flat to a 5% climb is about 63% in after 100 m and 95% after 300 m', () => {
  let s = 0;
  for (let i = 0; i < 2; i++) s = smoothSlope({ prev: s, theta: FIVE_PERCENT, dist: 50 });
  assert.ok(Math.abs(s / FIVE_PERCENT - (1 - Math.exp(-1))) < 1e-9);
  for (let i = 0; i < 4; i++) s = smoothSlope({ prev: s, theta: FIVE_PERCENT, dist: 50 });
  assert.ok(Math.abs(s / FIVE_PERCENT - (1 - Math.exp(-3))) < 1e-9);
});

test('smoothSlope: a 100 m ramp of 5% reaches about 63% of its slope by its end', () => {
  let s = 0;
  for (let i = 0; i < 2; i++) s = smoothSlope({ prev: s, theta: FIVE_PERCENT, dist: 50 });
  assert.ok(s > 0.6 * FIVE_PERCENT && s < 0.66 * FIVE_PERCENT);
});

test('smoothSlope: the length can be changed (shorter reacts faster)', () => {
  const slow = smoothSlope({ prev: 0, theta: FIVE_PERCENT, dist: 50, length: 200 });
  const fast = smoothSlope({ prev: 0, theta: FIVE_PERCENT, dist: 50, length: 50 });
  assert.ok(fast > slow);
});

test('slope chain: noisy altitude pairs 50 m apart give a much steadier slope after smoothing', () => {
  // true slope 5% (dh = 2.5 m per 50 m) with ±2 m altitude noise on each pair
  const noise = [2, -2, 1.5, -1.5, 2, -1, 0.5, -2, 1, -0.5, 2, -2, 1.2, -1.8, 0.8, -1.1, 1.9, -2, 0.4, -0.9];
  const raw = noise.map((n) => slopeFromAltitude({ dh: 2.5 + n, dist: 50 }));
  let s = null;
  const smoothed = raw.map((theta) => (s = smoothSlope({ prev: s, theta, dist: 50 })));
  const spread = (xs) => Math.max(...xs) - Math.min(...xs);
  assert.ok(spread(smoothed.slice(4)) < spread(raw.slice(4)) / 2);
});

// ---------- CO2 and trees ----------
test('co2FromFuel: 1 L of gasoline is 2.31 kg, diesel 2.64, LPG 1.6', () => {
  assert.equal(co2FromFuel({ litres: 1, fuel: 'gasoline' }), 2.31);
  assert.equal(co2FromFuel({ litres: 1, fuel: 'diesel' }), 2.64);
  assert.equal(co2FromFuel({ litres: 1, fuel: 'lpg' }), 1.6);
});

test('co2FromFuel: scales with litres, zero litres gives zero', () => {
  assert.ok(Math.abs(co2FromFuel({ litres: 7, fuel: 'gasoline' }) - 16.17) < 1e-9);
  assert.equal(co2FromFuel({ litres: 0, fuel: 'diesel' }), 0);
});

test('co2FromFuel: matches the roadmap V.7 conversion (CO2 g/km = 23.1 × L/100 km)', () => {
  // 6 L/100 km of gasoline over 100 km is 6 L: 138.6 g/km
  const gPerKm = co2FromFuel({ litres: 6, fuel: 'gasoline' }) * 1000 / 100;
  assert.ok(Math.abs(gPerKm - 23.1 * 6) < 1e-9);
  const dieselPerKm = co2FromFuel({ litres: 5, fuel: 'diesel' }) * 1000 / 100;
  assert.ok(Math.abs(dieselPerKm - 26.4 * 5) < 1e-9);
});

test('co2FromFuel: an unknown fuel gives NaN', () => {
  assert.ok(Number.isNaN(co2FromFuel({ litres: 1, fuel: 'hydrogen' })));
});

test('treeDays: a tree absorbing 20 kg/year needs 365 days for 20 kg', () => {
  assert.equal(TREE_KG_PER_YEAR, 20);
  assert.equal(treeDays({ co2: 20 }), 365);
});

test('treeDays: 20 km at 7 L/100 km gasoline is about 2 months', () => {
  const co2 = co2FromFuel({ litres: 1.4, fuel: 'gasoline' }); // 3.234 kg
  const days = treeDays({ co2 });
  assert.ok(days > 55 && days < 62, `got ${days}`);
});

test('treeDays: zero CO2 gives 0, proportional, kgPerYear can change', () => {
  assert.equal(treeDays({ co2: 0 }), 0);
  assert.ok(Math.abs(treeDays({ co2: 10 }) * 2 - treeDays({ co2: 20 })) < 1e-9);
  assert.equal(treeDays({ co2: 10, kgPerYear: 10 }), 365);
});

test('CO2_PER_LITRE: diesel emits more per litre than gasoline, LPG less', () => {
  assert.ok(CO2_PER_LITRE.diesel > CO2_PER_LITRE.gasoline);
  assert.ok(CO2_PER_LITRE.lpg < CO2_PER_LITRE.gasoline);
});

// ---------- slope smoothing length ----------
test('slopeLength: 4 readings at 1 s and 90 km/h give 100 m (the old fixed value)', () => {
  assert.ok(Math.abs(slopeLength({ vAvg: kmh(90), dt: 1 }) - 100) < 1e-9);
});

test('slopeLength: grows with speed between the clamps', () => {
  const a = slopeLength({ vAvg: kmh(60), dt: 1 });
  const b = slopeLength({ vAvg: kmh(80), dt: 1 });
  const c = slopeLength({ vAvg: kmh(100), dt: 1 });
  assert.ok(a < b && b < c);
  assert.ok(Math.abs(b - kmh(80) * 4) < 1e-9);
});

test('slopeLength: slower GPS gives a longer length, faster GPS a shorter one (same 4 readings)', () => {
  assert.ok(Math.abs(slopeLength({ vAvg: 20, dt: 1 }) - 80) < 1e-9);
  assert.ok(Math.abs(slopeLength({ vAvg: 20, dt: 1.5 }) - 120) < 1e-9);
  assert.ok(Math.abs(slopeLength({ vAvg: 20, dt: 0.5 }) - 40) < 1e-9);
});

test('slopeLength: the number of readings is a parameter', () => {
  assert.ok(Math.abs(slopeLength({ vAvg: 20, dt: 1, points: 3 }) - 60) < 1e-9);
  assert.ok(Math.abs(slopeLength({ vAvg: 20, dt: 1, points: 6 }) - 120) < 1e-9);
});

test('slopeLength: never shorter than 32 m, whatever the speed or the GPS rate', () => {
  assert.equal(slopeLength({ vAvg: 8, dt: 1 }), 32);
  assert.equal(slopeLength({ vAvg: 5, dt: 1 }), 32);
  assert.equal(slopeLength({ vAvg: 0, dt: 1 }), 32);
  assert.equal(slopeLength({ vAvg: 0, dt: 2 }), 32); // fixed length, not scaled by the GPS rate
  assert.equal(slopeLength({ vAvg: 10, dt: 0.5 }), 32);
  assert.ok(slopeLength({ vAvg: 8.5, dt: 1 }) > 32); // above 8 m/s at 1 Hz it follows the speed
});

test('slopeLength: capped at 150 m when fast', () => {
  assert.equal(slopeLength({ vAvg: kmh(135), dt: 1 }), 150);
  assert.equal(slopeLength({ vAvg: kmh(200), dt: 1 }), 150);
  assert.ok(slopeLength({ vAvg: kmh(130), dt: 1 }) < 150);
});

test('slopeLength: no usable speed or interval gives the fallback; min, max and fallback can change', () => {
  assert.equal(slopeLength({ vAvg: null, dt: 1 }), 100);
  assert.equal(slopeLength({ vAvg: NaN, dt: 1 }), 100);
  assert.equal(slopeLength({ vAvg: 20, dt: null }), 100);
  assert.equal(slopeLength({ vAvg: 20, dt: 0 }), 100);
  assert.equal(slopeLength({ vAvg: 20, dt: -1 }), 100);
  assert.equal(slopeLength({ vAvg: null, dt: 1, fallback: 70 }), 70);
  assert.equal(slopeLength({ vAvg: 1, dt: 1, points: 5, min: 20, max: 80 }), 20);
  assert.equal(slopeLength({ vAvg: 30, dt: 1, points: 5, min: 20, max: 80 }), 80);
  assert.equal(slopeLength({ vAvg: 10, dt: 1, points: 5, min: 20, max: 80 }), 50);
});

test('slopeLength: feeds smoothSlope', () => {
  const length = slopeLength({ vAvg: kmh(135), dt: 1 }); // 150 m
  const r = smoothSlope({ prev: 0, theta: 0.1, dist: 150, length });
  assert.ok(Math.abs(r - 0.1 * (1 - Math.exp(-1))) < 1e-9);
});

test('consumptionFromCo2: the roadmap divisors 23.1 (gasoline) and 26.4 (diesel)', () => {
  assert.ok(Math.abs(consumptionFromCo2({ co2: 231, fuel: 'gasoline' }) - 10) < 1e-9);
  assert.ok(Math.abs(consumptionFromCo2({ co2: 264, fuel: 'diesel' }) - 10) < 1e-9);
  assert.ok(Math.abs(consumptionFromCo2({ co2: 120, fuel: 'gasoline' }) - 120 / 23.1) < 1e-9);
});

test('consumptionFromCo2: LPG, zero, proportional, unknown fuel', () => {
  assert.ok(Math.abs(consumptionFromCo2({ co2: 160, fuel: 'lpg' }) - 10) < 1e-9);
  assert.equal(consumptionFromCo2({ co2: 0, fuel: 'gasoline' }), 0);
  const a = consumptionFromCo2({ co2: 100, fuel: 'diesel' });
  assert.ok(Math.abs(consumptionFromCo2({ co2: 200, fuel: 'diesel' }) - 2 * a) < 1e-9);
  assert.ok(Number.isNaN(consumptionFromCo2({ co2: 100, fuel: 'hydrogen' })));
});

test('consumptionFromCo2: inverse of co2FromFuel over 100 km', () => {
  const litres = 6.5; // per 100 km
  const gPerKm = (co2FromFuel({ litres, fuel: 'gasoline' }) * 1000) / 100;
  assert.ok(Math.abs(consumptionFromCo2({ co2: gPerKm, fuel: 'gasoline' }) - litres) < 1e-9);
});

test('idleFromDisplacement: 0.5 L/h per litre; 1.0 L gives 0.5, 2.0 L gives 1.0, 0 gives 0', () => {
  assert.equal(idleFromDisplacement({ displacement: 1000 }), 0.5);
  assert.equal(idleFromDisplacement({ displacement: 2000 }), 1.0);
  assert.equal(idleFromDisplacement({ displacement: 0 }), 0);
  assert.ok(idleFromDisplacement({ displacement: 1998 }) > idleFromDisplacement({ displacement: 999 }));
});

test('maxPowerFromRated: 0.9 x P.2, in watts', () => {
  assert.ok(Math.abs(maxPowerFromRated({ ratedKw: 100 }) - 90000) < 1e-9);
  assert.equal(maxPowerFromRated({ ratedKw: 0 }), 0);
});

test('dragAreaFromBody: table values, unknown body gives undefined, SUV above hatchback', () => {
  for (const b of Object.keys(CDA_BY_BODY)) assert.equal(dragAreaFromBody({ body: b }), CDA_BY_BODY[b]);
  assert.equal(dragAreaFromBody({ body: 'tank' }), undefined);
  assert.ok(dragAreaFromBody({ body: 'suv' }) > dragAreaFromBody({ body: 'hatchback' }));
  assert.ok(dragAreaFromBody({ body: 'van' }) <= 1.10 && dragAreaFromBody({ body: 'hatchback' }) >= 0.60);
});

test('testMass: car with G 1500 and F.1 2000 gives 1500 + 25 + 0.15 x 475 = 1596.25', () => {
  assert.ok(Math.abs(testMass({ g: 1500, maxLaden: 2000 }) - 1596.25) < 1e-9);
});

test('testMass: van uses 28%, optional equipment counts, no spare load gives G + 25', () => {
  assert.ok(Math.abs(testMass({ g: 2000, maxLaden: 3000, category: 'N' }) - (2025 + 0.28 * 975)) < 1e-9);
  assert.ok(Math.abs(testMass({ g: 1500, maxLaden: 2000, optional: 50 }) - (1550 + 25 + 0.15 * 425)) < 1e-9);
  assert.equal(testMass({ g: 1500, maxLaden: 1525 }), 1525);
});

const CAR = { m: 1600, cdA: 0.65, f0: 0.7, k: 0.45, pMax: 90000 };

test('simulateCycle: steady 100 km/h for 100 s matches the SUV check (8.65 L/100 km)', () => {
  const r = simulateCycle({ speeds: new Array(101).fill(100), m: 2000, cdA: 0.9, f0: 1.0, k: 0.45, pMax: 1e6 });
  assert.ok(Math.abs(r.km - 100 / 3.6 * 100 / 1000) < 1e-9);
  assert.ok(Math.abs(r.lPer100 - 8.66) < 0.02);
});

test('simulateCycle: standing still burns f0 without start-stop and nothing with it', () => {
  const idle = simulateCycle({ speeds: [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0], ...CAR });
  assert.ok(Math.abs(idle.litres - (0.7 * 10) / 3600) < 1e-12);
  assert.equal(idle.km, 0);
  assert.equal(simulateCycle({ speeds: [0, 0, 0], ...CAR, startStop: true }).litres, 0);
});

test('simulateCycle: WLTC distance is 23.27 km, and a plausible car burns 5 to 9 L/100 km', () => {
  const r = simulateCycle({ speeds: WLTC3B_KMH, ...CAR });
  assert.ok(Math.abs(r.km - 23.27) < 0.01);
  assert.ok(r.lPer100 > 5 && r.lPer100 < 9, String(r.lPer100));
});

test('simulateCycle: fuel is linear in k (needed by the calibration)', () => {
  const at = (k) => simulateCycle({ speeds: WLTC3B_KMH, ...CAR, k }).litres;
  const mid = (at(0.3) + at(0.5)) / 2;
  assert.ok(Math.abs(at(0.4) - mid) < 1e-9);
});

test('simulateCycle: heavier or draggier cars burn more; start-stop saves fuel', () => {
  const base = simulateCycle({ speeds: WLTC3B_KMH, ...CAR }).lPer100;
  assert.ok(simulateCycle({ speeds: WLTC3B_KMH, ...CAR, m: 2000 }).lPer100 > base);
  assert.ok(simulateCycle({ speeds: WLTC3B_KMH, ...CAR, cdA: 0.9 }).lPer100 > base);
  assert.ok(simulateCycle({ speeds: WLTC3B_KMH, ...CAR, startStop: true }).lPer100 < base);
});

const { k: _k, ...CAR_NO_K } = CAR;

test('calibrateK: simulating with the solved k reproduces the target', () => {
  for (const target of [4.5, 6, 7.64, 9]) {
    const k = calibrateK({ target, speeds: WLTC3B_KMH, ...CAR_NO_K });
    const r = simulateCycle({ speeds: WLTC3B_KMH, ...CAR_NO_K, k });
    assert.ok(Math.abs(r.lPer100 - target) < 1e-9, `${target} -> ${r.lPer100}`);
  }
});

test('calibrateK: the reference car (7.64 L/100 km at k 0.45) gives back k = 0.45', () => {
  const target = simulateCycle({ speeds: WLTC3B_KMH, ...CAR }).lPer100;
  assert.ok(Math.abs(calibrateK({ target, speeds: WLTC3B_KMH, ...CAR_NO_K }) - 0.45) < 1e-9);
});

test('calibrateK: higher target gives higher k; the real-world factor raises k', () => {
  const at = (target) => calibrateK({ target, speeds: WLTC3B_KMH, ...CAR_NO_K });
  assert.ok(at(7) > at(6));
  assert.ok(at(6 * REAL_WORLD_FACTOR) > at(6));
  assert.equal(REAL_WORLD_FACTOR, 1.15);
});

test('calibrateK: V.7 end to end (120 g/km gasoline) lands near a sensible k', () => {
  const target = consumptionFromCo2({ co2: 120, fuel: 'gasoline' });
  const k = calibrateK({ target, speeds: WLTC3B_KMH, ...CAR_NO_K });
  assert.ok(k > 0.2 && k < 0.5, String(k));
});

test('calibrateK: null when idle alone exceeds the target, or the cycle needs no power', () => {
  assert.equal(calibrateK({ target: 1, speeds: WLTC3B_KMH, ...CAR_NO_K }), null);
  assert.equal(calibrateK({ target: 6, speeds: [0, 0, 0, 0], ...CAR_NO_K }), null);
});

// ----- altitudeStep: is an altitude change believable? (MODEL.md section 17) -----

test('altitudeStep: a normal change is a move; the same value is same', () => {
  assert.equal(altitudeStep({ prevAlt: 80, alt: 81, step: 12 }), 'move');
  assert.equal(altitudeStep({ prevAlt: 80, alt: 78, step: 15 }), 'move'); // 2 m in one reading, as on the real 10% hills
  assert.equal(altitudeStep({ prevAlt: 101.2, alt: 101.2, step: 12 }), 'same');
});

test('altitudeStep: the limit is 0.25 × step + 3 m, both ways', () => {
  // 12 m driven: limit 6 m
  assert.equal(altitudeStep({ prevAlt: 100, alt: 106, step: 12 }), 'move'); // exactly the limit is accepted
  assert.equal(altitudeStep({ prevAlt: 100, alt: 106.01, step: 12 }), 'jump');
  assert.equal(altitudeStep({ prevAlt: 100, alt: 94, step: 12 }), 'move');
  assert.equal(altitudeStep({ prevAlt: 100, alt: 93.99, step: 12 }), 'jump');
});

test('altitudeStep: the two jumps of the first real drive (2026-11-25)', () => {
  assert.equal(altitudeStep({ prevAlt: 95.5, alt: 101.2, step: 0.66 }), 'jump'); // first fix settling, parked
  assert.equal(altitudeStep({ prevAlt: 101.2, alt: 76, step: 12.9 }), 'jump');  // stale altitude replaced
});

test('altitudeStep: when stopped only the noise allowance is left', () => {
  assert.equal(altitudeStep({ prevAlt: 92, alt: 95, step: 0 }), 'move');
  assert.equal(altitudeStep({ prevAlt: 92, alt: 95.5, step: 0 }), 'jump');
});

test('altitudeStep: missing altitude gives none; a bad step counts as 0 m', () => {
  assert.equal(altitudeStep({ prevAlt: null, alt: 90, step: 10 }), 'none');
  assert.equal(altitudeStep({ prevAlt: 90, alt: null, step: 10 }), 'none');
  assert.equal(altitudeStep({ prevAlt: 90, alt: NaN, step: 10 }), 'none');
  for (const step of [undefined, null, NaN, -20]) {
    assert.equal(altitudeStep({ prevAlt: 90, alt: 94, step }), 'jump', String(step));
    assert.equal(altitudeStep({ prevAlt: 90, alt: 92, step }), 'move', String(step));
  }
});

test('altitudeStep: maxGrade and noise are parameters', () => {
  assert.equal(altitudeStep({ prevAlt: 0, alt: 5, step: 10, maxGrade: 0.5 }), 'move'); // limit 8 m
  assert.equal(altitudeStep({ prevAlt: 0, alt: 2, step: 0, noise: 1 }), 'jump');
});

test('slopeFromAltitude: the distance is horizontal (GPS speed), so dh/dist is tanθ and sinθ is rise over the road length', () => {
  const theta = slopeFromAltitude({ dh: 20, dist: 100 }); // a 20% road-sign grade
  assert.ok(Math.abs(Math.tan(theta) - 0.20) < 1e-12);
  assert.ok(Math.abs(Math.sin(theta) - 20 / Math.hypot(20, 100)) < 1e-12); // 0.196, not 0.20
});

// ---- styleLevel ----
test('styleLevel: from the sum of the two marks, eco above 8, ok above 6, brisk above 4, bad at 4 or less', () => {
  assert.equal(styleLevel(10), 'eco');
  assert.equal(styleLevel(9), 'eco');
  assert.equal(styleLevel(8), 'ok');
  assert.equal(styleLevel(7), 'ok');
  assert.equal(styleLevel(6), 'brisk');
  assert.equal(styleLevel(5), 'brisk');
  assert.equal(styleLevel(4), 'bad');
  assert.equal(styleLevel(0), 'bad');
  for (const bad of [NaN, Infinity, null, undefined]) assert.equal(styleLevel(bad), null);
});

test('styleLevel: against a calm shadow (speed smoothed with CALM_TAU), hard stop-and-go is brisk, gentle is ok, steady is eco', () => {
  const car = { m: 1500, cdA: 0.65 };
  const fuel = (v, a) => fuelRate({ p: tractivePower({ v, a, ...car }), v, f0: 0.8, k: 0.45, pMax: 90000 });
  const drive = (speedAt) => {
    let vPrev = speedAt(0), vS = vPrev, vSPrev = vPrev, real = 0, calm = 0, d = 0, dS = 0;
    for (let t = 1; t <= 600; t++) {
      const v = speedAt(t);
      real += fuel(v, v - vPrev); d += v; vPrev = v;
      vS = smooth({ prev: vS, value: v, dt: 1, tau: CALM_TAU });
      calm += fuel(vS, vS - vSPrev); dS += vS; vSPrev = vS;
    }
    return (real / d) / (calm / dS);
  };
  // stop-and-go between 29 and 72 km/h: speed up at `up` m/s², hold `hold` s, brake at `down` m/s², hold
  const cycle = (up, down, hold) => {
    const period = 12 / up + hold + 12 / down + hold;
    return (t) => {
      const s = t % period;
      if (s < 12 / up) return 8 + up * s;
      if (s < 12 / up + hold) return 20;
      if (s < 12 / up + hold + 12 / down) return 20 - down * (s - 12 / up - hold);
      return 8;
    };
  };
  assert.ok(Math.abs(drive(() => 25) - 1) < 1e-9);                         // steady 90 km/h: same as calm
  // no speed above any cap here: the speed mark is full (5/5), the accelerations mark decides
  const level = (ratio) => styleLevel(styleMark(ratio) + STYLE_MARK_MAX);
  assert.equal(level(drive(cycle(2.5, 3, 5))), 'brisk');             // hard accelerations and brakings (0/5)
  assert.equal(level(drive(cycle(0.8, 1, 10))), 'ok');               // the same stops, taken gently (3/5)
  assert.equal(level(drive((t) => 14 + 3 * Math.sin(t / 30))), 'eco'); // slow swells over a minute (5/5)
});

test('styleFactors: the two causes multiply to the total; an empty total gives null', () => {
  const f = styleFactors({ real: { litres: 1.3, dist: 10000 }, smooth: { litres: 1.0, dist: 10000 }, calm: { litres: 0.8, dist: 9000 } });
  assert.ok(Math.abs(f.accel - 1.3) < 1e-12);                   // same distance: 1.3 / 1.0
  assert.ok(Math.abs(f.speed - (1.0 / 10000) / (0.8 / 9000)) < 1e-12);
  assert.ok(Math.abs(f.total - f.accel * f.speed) < 1e-12);
  assert.equal(styleFactors({ real: { litres: 1, dist: 0 }, smooth: { litres: 1, dist: 1 }, calm: { litres: 1, dist: 1 } }), null);
  assert.equal(styleFactors({ real: { litres: 1, dist: 1 }, smooth: { litres: 0, dist: 1 }, calm: { litres: 1, dist: 1 } }), null);
});

test('styleFactors: driving above the cap costs fuel; below it the speed factor is 1', () => {
  const car = { m: 1500, cdA: 0.65 };
  const fuel = (v) => fuelRate({ p: tractivePower({ v, a: 0, ...car }), v, f0: 0.8, k: 0.45, pMax: 90000 });
  const at = (v, cap) => styleFactors({
    real: { litres: fuel(v), dist: v }, smooth: { litres: fuel(v), dist: v }, calm: { litres: fuel(Math.min(v, cap)), dist: Math.min(v, cap) },
  });
  assert.equal(at(25, 110 / 3.6).speed, 1);                     // 90 km/h under a 110 cap: no speed cost
  const fast = at(130 / 3.6, 110 / 3.6);                          // steady 130 km/h against a 110 cap
  assert.ok(fast.speed > 1.15 && fast.speed < 1.35, String(fast.speed));
  assert.equal(fast.accel, 1);                                    // steady: no acceleration cost
});

test('styleMark: 5/5 at calm fuel or less, 0/5 at +50% or more, one mark per 10%', () => {
  assert.equal(STYLE_MARK_MAX, 5);
  assert.equal(styleMark(1), 5);
  assert.equal(styleMark(0.95), 5);
  assert.equal(styleMark(1.18), 3);   // +18% → 3.2 → 3
  assert.equal(styleMark(1.30), 2);
  assert.equal(styleMark(1 + STYLE_ZERO_EXTRA), 0);
  assert.equal(styleMark(2), 0);
  assert.equal(styleMark(NaN), null);
  assert.equal(styleMark(0), null);
});
