// Run with: node --test
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { checkAdvanced, COHERENCE_TOLERANCE, checkAverage, averageFromFuel, kFromAverage, buildAdvanced, buildAdvancedMoto, checkMoto, simulatedWltp, PASSENGER_MASS, LPG_PER_GASOLINE } from './profile.js';
import { consumptionFromCo2, simulateCycle, REAL_WORLD_FACTOR } from './model.js';
import { WLTC3B_KMH } from './wltc.js';

const RAW = { g: 1500, maxLaden: 2000, displacement: 1498, ratedKw: 96, body: 'hatchback', startStop: false, co2: 120 };

test('checkAdvanced: a complete form has no errors and numbers come out as numbers', () => {
  const { values, errors } = checkAdvanced({ ...RAW, g: '1500', co2: '120,5' });
  assert.deepEqual(errors, {});
  assert.equal(values.g, 1500);
  assert.equal(values.co2, 120.5);
});

test('checkAdvanced: missing required fields, no body, out of range, F.1 not above G', () => {
  const e = checkAdvanced({ ...RAW, g: '', displacement: 99999, body: '' }).errors;
  assert.ok(e.g && e.displacement && e.body); // without a preset mass, G is needed
  assert.ok(checkAdvanced({ ...RAW, maxLaden: 1400 }).errors.maxLaden);
  assert.ok(checkAdvanced({ ...RAW, co2: 5 }).errors.co2);
  assert.ok(checkAdvanced({ ...RAW, ratedKw: 'abc' }).errors.ratedKw);
});

test('checkAdvanced: V.7 is optional', () => {
  assert.deepEqual(checkAdvanced({ ...RAW, co2: '' }).errors, {});
});

test('buildAdvanced: parameters come from the model rules, k is calibrated', () => {
  const { profile } = buildAdvanced({ raw: RAW, fuel: 'gasoline', tier1K: 0.45 });
  assert.equal(profile.m, 1500);
  assert.equal(profile.cdA, 0.65);
  assert.ok(Math.abs(profile.f0 - 1498 / 2000) < 1e-9);
  assert.ok(Math.abs(profile.pMax - 96 * 900) < 1e-9);
  assert.ok(Math.abs(profile.testMass - 1596.25) < 1e-9);
  assert.equal(profile.kSource, 'v7');
  assert.ok(profile.k > 0.15 && profile.k < 0.6, String(profile.k));
});

test('buildAdvanced: simulating the WLTP with the stored k gives V.7 × 1.15', () => {
  const { profile } = buildAdvanced({ raw: RAW, fuel: 'gasoline', tier1K: 0.45 });
  const target = consumptionFromCo2({ co2: 120, fuel: 'gasoline' }) * REAL_WORLD_FACTOR;
  assert.ok(Math.abs(simulatedWltp(profile) - target) < 1e-6);
});

test('buildAdvanced: LPG reads V.7 as gasoline, then × LPG_PER_GASOLINE (not the LPG CO₂ factor)', () => {
  const gas = buildAdvanced({ raw: RAW, fuel: 'gasoline', tier1K: 0.45 }).profile;
  const lpg = buildAdvanced({ raw: RAW, fuel: 'lpg', tier1K: 0.54 }).profile;
  assert.equal(lpg.kSource, 'v7');
  assert.ok(Math.abs(lpg.official - gas.official * LPG_PER_GASOLINE) < 1e-9);
  assert.ok(Math.abs(simulatedWltp(lpg) - lpg.official * REAL_WORLD_FACTOR) < 1e-6);
  // f0 is the same for both fuels, so k grows a little more than the litre ratio
  assert.ok(lpg.k / gas.k > LPG_PER_GASOLINE && lpg.k / gas.k < 1.3, String(lpg.k / gas.k));
  // an own average is still used as it is
  assert.equal(buildAdvanced({ raw: RAW, fuel: 'lpg', tier1K: 0.54, average: 8 }).profile.official, 8);
});

test('buildAdvanced: the average wins over V.7 and gets no 1.15 factor; V.7 alone does', () => {
  const avg = buildAdvanced({ raw: RAW, fuel: 'gasoline', tier1K: 0.45, average: 6.5 }).profile;
  assert.equal(avg.kSource, 'average');
  assert.equal(avg.official, 6.5);
  assert.ok(Math.abs(simulatedWltp(avg) - 6.5) < 1e-6);
  const v7 = buildAdvanced({ raw: RAW, fuel: 'gasoline', tier1K: 0.45 }).profile;
  assert.equal(v7.kSource, 'v7');
  assert.ok(avg.k > v7.k); // 6.5 is above 5.19 x 1.15 = 5.97
});

test('buildAdvanced: no official figure keeps the Quick k; a figure below idle also keeps it', () => {
  const none = buildAdvanced({ raw: { ...RAW, co2: '' }, fuel: 'gasoline', tier1K: 0.45 }).profile;
  assert.equal(none.k, 0.45);
  assert.equal(none.kSource, 'tier1');
  assert.ok(none.note);
  const low = buildAdvanced({ raw: { ...RAW, co2: '' }, fuel: 'gasoline', tier1K: 0.45, average: 1 }).profile;
  assert.equal(low.k, 0.45);
  assert.ok(low.note);
});

test('buildAdvanced: the fuel matters (same CO₂ means fewer litres of diesel), vans use category N, errors pass through', () => {
  const g = buildAdvanced({ raw: RAW, fuel: 'gasoline', tier1K: 0.45 }).profile;
  const d = buildAdvanced({ raw: RAW, fuel: 'diesel', tier1K: 0.33 }).profile;
  assert.ok(d.official < g.official);
  const van = buildAdvanced({ raw: { ...RAW, body: 'van', g: 2000, maxLaden: 3000 }, fuel: 'diesel', tier1K: 0.33 }).profile;
  assert.equal(van.category, 'N');
  assert.ok(van.testMass > 2025 + 0.15 * 975);
  assert.ok(buildAdvanced({ raw: { ...RAW, g: '' }, fuel: 'gasoline', tier1K: 0.45 }).errors.g);
});

test('buildAdvanced: start-stop needs a higher k (less idle fuel, so the same total comes from the power part)', () => {
  const off = buildAdvanced({ raw: RAW, fuel: 'gasoline', tier1K: 0.45 }).profile.k;
  const on = buildAdvanced({ raw: { ...RAW, startStop: true }, fuel: 'gasoline', tier1K: 0.45 }).profile.k;
  assert.ok(on > off);
});

test('checkAverage: blank is fine, a number in range is returned, out of range or junk is an error', () => {
  assert.deepEqual(checkAverage(''), { value: null, error: '' });
  assert.deepEqual(checkAverage(null), { value: null, error: '' });
  assert.deepEqual(checkAverage('4,5'), { value: 4.5, error: '' });
  assert.ok(checkAverage(0.5).error);
  assert.ok(checkAverage(80).error);
  assert.ok(checkAverage('abc').error);
});

test('kFromAverage: a motorcycle average gives a k that reproduces it on the cycle; a higher average gives a higher k', () => {
  const moto = { m: 300, cdA: 0.35, f0: 0.4, pMax: 150000 };
  const k5 = kFromAverage({ average: 5, ...moto });
  // The simulated cycle gives back the average. (k is large for a motorcycle: see MODEL.md section 16.)
  assert.ok(Math.abs(simulateCycle({ speeds: WLTC3B_KMH, ...moto, k: k5 }).lPer100 - 5) < 1e-9);
  assert.ok(kFromAverage({ average: 6, ...moto }) > k5);
  assert.equal(kFromAverage({ average: 0.1, ...moto }), null);
});

test('averageFromFuel: litres / km x 100, rounded to 0.01', () => {
  assert.deepEqual(averageFromFuel({ litres: 9.3, km: 210 }), { value: 4.43, error: '' });
  assert.deepEqual(averageFromFuel({ litres: '6,5', km: '100' }), { value: 6.5, error: '' });
  assert.equal(averageFromFuel({ litres: 40, km: 500 }).value, 8);
});

test('averageFromFuel: blank gives no value and no error; zero or negative and absurd results are errors', () => {
  assert.deepEqual(averageFromFuel({ litres: '', km: 100 }), { value: null, error: '' });
  assert.deepEqual(averageFromFuel({ litres: 5, km: null }), { value: null, error: '' });
  assert.ok(averageFromFuel({ litres: 0, km: 100 }).error);
  assert.ok(averageFromFuel({ litres: 5, km: -3 }).error);
  const absurd = averageFromFuel({ litres: 50, km: 10 }); // 500 L/100 km: litres and km mixed up
  assert.equal(absurd.value, null);
  assert.ok(absurd.error);
  assert.ok(averageFromFuel({ litres: 0.5, km: 100 }).error); // 0.5 L/100 km
});

const MOTO_PRESET = { cdA: 0.35, f0: 0.4 };

test('checkMoto: G and P.2 are required and limited', () => {
  assert.deepEqual(checkMoto({ g: 190, ratedKw: 70 }).errors, {});
  assert.ok(checkMoto({ g: '', ratedKw: 70 }).errors.g); // no preset mass: G is needed
  assert.ok(checkMoto({ g: 190, ratedKw: '' }).errors.ratedKw);
  assert.ok(checkMoto({ g: 5, ratedKw: 70 }).errors.g);
  assert.ok(checkMoto({ g: 190, ratedKw: 900 }).errors.ratedKw);
});

test('buildAdvancedMoto: mass is G plus the 75 kg rider, clamp is 0.9 x P.2, drag and idle stay at the preset', () => {
  const { profile } = buildAdvancedMoto({ raw: { g: 190, ratedKw: 70 }, preset: MOTO_PRESET, tier1K: 0.45 });
  assert.equal(profile.m, 265);
  assert.ok(Math.abs(profile.pMax - 63000) < 1e-9);
  assert.equal(profile.cdA, 0.35);
  assert.equal(profile.f0, 0.4);
  assert.equal(profile.startStop, false);
});

test('buildAdvancedMoto: without an average k stays at the Quick value with a note; with one, the average is reproduced', () => {
  const quick = buildAdvancedMoto({ raw: { g: 190, ratedKw: 70 }, preset: MOTO_PRESET, tier1K: 0.45 }).profile;
  assert.equal(quick.k, 0.45);
  assert.equal(quick.kSource, 'tier1');
  assert.ok(quick.note);
  const tuned = buildAdvancedMoto({ raw: { g: 190, ratedKw: 70 }, preset: MOTO_PRESET, tier1K: 0.45, average: 5 }).profile;
  assert.equal(tuned.kSource, 'average');
  assert.equal(tuned.note, '');
  assert.ok(Math.abs(simulatedWltp(tuned) - 5) < 1e-6);
});

test('buildAdvancedMoto: a heavier bike needs a smaller k for the same average; errors pass through; unreachable average keeps Quick k', () => {
  const k = (g) => buildAdvancedMoto({ raw: { g, ratedKw: 70 }, preset: MOTO_PRESET, tier1K: 0.45, average: 5 }).profile.k;
  assert.ok(k(250) < k(150));
  assert.ok(buildAdvancedMoto({ raw: { g: '', ratedKw: 70 }, preset: MOTO_PRESET, tier1K: 0.45 }).errors.g);
  const low = buildAdvancedMoto({ raw: { g: 190, ratedKw: 70 }, preset: MOTO_PRESET, tier1K: 0.45, average: 1 }).profile;
  assert.equal(low.kSource, 'average'); // 1 L/100 km is above the 0.7 the idle alone burns on the cycle
  const none = buildAdvancedMoto({ raw: { g: 190, ratedKw: 70 }, preset: { cdA: 0.35, f0: 3 }, tier1K: 0.45, average: 1 }).profile;
  assert.equal(none.k, 0.45);
  assert.ok(none.note);
});

test('G blank with a preset mass: the car uses the preset mass and says so; other fields still apply', () => {
  const { profile, errors } = buildAdvanced({ raw: { ...RAW, g: '' }, fuel: 'gasoline', tier1K: 0.45, presetMass: 1500 });
  assert.equal(errors, undefined);
  assert.equal(profile.m, 1500);
  assert.ok(Math.abs(profile.testMass - 1596.25) < 1e-9); // same as with G = 1500
  assert.match(profile.note, /G not given/);
  assert.ok(Math.abs(profile.f0 - 1498 / 2000) < 1e-9);
  const withG = buildAdvanced({ raw: RAW, fuel: 'gasoline', tier1K: 0.45, presetMass: 1100 }).profile;
  assert.equal(withG.m, 1500); // a typed G wins over the preset
  assert.doesNotMatch(withG.note, /G not given/);
});

test('G blank: F.1 must still be above the mass used', () => {
  const e = buildAdvanced({ raw: { ...RAW, g: '', maxLaden: 1400 }, fuel: 'gasoline', tier1K: 0.45, presetMass: 1500 }).errors;
  assert.ok(e.maxLaden);
});

test('G blank on a motorcycle: the preset mass (rider included) is used, no extra 75 kg', () => {
  const noG = buildAdvancedMoto({ raw: { g: '', ratedKw: 70 }, preset: MOTO_PRESET, tier1K: 0.45, presetMass: 300 }).profile;
  assert.equal(noG.m, 300);
  assert.match(noG.note, /G not given/);
  const withG = buildAdvancedMoto({ raw: { g: 190, ratedKw: 70 }, preset: MOTO_PRESET, tier1K: 0.45, presetMass: 300 }).profile;
  assert.equal(withG.m, 265);
  assert.ok(checkMoto({ g: '', ratedKw: 70 }, 300).errors.g === undefined);
});

test('F blank: the payload share is zero (test mass = mass + 25), a note says so, and the rest still works', () => {
  const { profile, errors } = buildAdvanced({ raw: { ...RAW, maxLaden: '' }, fuel: 'gasoline', tier1K: 0.45 });
  assert.equal(errors, undefined);
  assert.equal(profile.testMass, 1525);
  assert.match(profile.note, /No laden mass/);
  assert.ok(profile.k > 0.15 && profile.k < 0.6);
  const withF = buildAdvanced({ raw: RAW, fuel: 'gasoline', tier1K: 0.45 }).profile;
  assert.ok(withF.testMass > profile.testMass); // 1596.25 against 1525
  assert.doesNotMatch(withF.note, /No laden mass/);
});

test('F blank and G blank together: preset mass + 25, both notes; a given F is still checked against the mass', () => {
  const both = buildAdvanced({ raw: { ...RAW, g: '', maxLaden: '' }, fuel: 'gasoline', tier1K: 0.45, presetMass: 1500 }).profile;
  assert.equal(both.testMass, 1525);
  assert.match(both.note, /G not given/);
  assert.match(both.note, /No laden mass/);
  assert.ok(buildAdvanced({ raw: { ...RAW, maxLaden: 1400 }, fuel: 'gasoline', tier1K: 0.45 }).errors.maxLaden);
  assert.ok(checkAdvanced({ ...RAW, maxLaden: '' }).errors.maxLaden === undefined);
});

test('moto, G blank and F given: mass with rider = F - 65, with a note about the luggage allowance', () => {
  const { profile } = buildAdvancedMoto({ raw: { g: '', ratedKw: 70, maxLaden: 370 }, preset: MOTO_PRESET, tier1K: 0.45, presetMass: 300 });
  assert.equal(profile.m, 370 - PASSENGER_MASS);
  assert.equal(profile.m, 305);
  assert.match(profile.note, /estimated from the laden mass/);
  // the same as running order (F - 140) plus the rider
  assert.equal(profile.m, 370 - 75 - 65 + 75);
});

test('moto: a typed G wins over F; with neither the preset is used; F alone satisfies the mass requirement even without a preset', () => {
  const both = buildAdvancedMoto({ raw: { g: 190, ratedKw: 70, maxLaden: 370 }, preset: MOTO_PRESET, tier1K: 0.45, presetMass: 300 }).profile;
  assert.equal(both.m, 265);
  assert.doesNotMatch(both.note, /estimated from the laden mass/);
  const none = buildAdvancedMoto({ raw: { g: '', ratedKw: 70, maxLaden: '' }, preset: MOTO_PRESET, tier1K: 0.45, presetMass: 300 }).profile;
  assert.equal(none.m, 300);
  assert.equal(checkMoto({ g: '', ratedKw: 70, maxLaden: 370 }).errors.g, undefined);
  assert.ok(checkMoto({ g: '', ratedKw: 70, maxLaden: '' }).errors.g);
});

test('moto: an implausible laden mass is refused, and a lighter bike gives a smaller mass', () => {
  assert.ok(checkMoto({ g: '', ratedKw: 70, maxLaden: 100 }, 300).errors.maxLaden);
  assert.ok(checkMoto({ g: '', ratedKw: 70, maxLaden: 2000 }, 300).errors.maxLaden);
  const m = (F) => buildAdvancedMoto({ raw: { g: '', ratedKw: 7, maxLaden: F }, preset: MOTO_PRESET, tier1K: 0.45, presetMass: 300 }).profile.m;
  assert.ok(m(280) < m(450)); // a moped against a tourer
});

test('car: G.1 + 75 kg driver is the vehicle mass when typed (preferred); G is used when G.1 is blank', () => {
  const g1 = buildAdvanced({ raw: { ...RAW, g: '', g1: 1425 }, fuel: 'gasoline', tier1K: 0.45, presetMass: 1100 }).profile;
  assert.equal(g1.m, 1500);
  assert.ok(Math.abs(g1.testMass - 1596.25) < 1e-9); // the same as with G = 1500
  assert.match(g1.note, /G\.1/);
  assert.doesNotMatch(g1.note, /G not given/);
  const both = buildAdvanced({ raw: { ...RAW, g: 1503, g1: 1425 }, fuel: 'gasoline', tier1K: 0.45, presetMass: 1100 }).profile;
  assert.equal(both.m, 1500); // G.1 wins when G differs by rounding
  assert.match(both.note, /G\.1/);
  const onlyG = buildAdvanced({ raw: { ...RAW, g: 1550, g1: '' }, fuel: 'gasoline', tier1K: 0.45, presetMass: 1100 }).profile;
  assert.equal(onlyG.m, 1550);
  assert.doesNotMatch(onlyG.note, /G\.1|G not given/);
});

test('car: G.1 alone is enough without a preset mass; limits and the F check use the mass from G.1', () => {
  assert.equal(buildAdvanced({ raw: { ...RAW, g: '', g1: 1425 }, fuel: 'gasoline', tier1K: 0.45 }).errors, undefined);
  assert.ok(checkAdvanced({ ...RAW, g: '', g1: 100 }).errors.g1);
  assert.ok(checkAdvanced({ ...RAW, g: '', g1: 1425, maxLaden: 1450 }).errors.maxLaden); // F below G.1 + 75
  assert.deepEqual(checkAdvanced({ ...RAW, g: '', g1: 1425, maxLaden: 1950 }).errors, {});
  assert.ok(checkAdvanced({ ...RAW, g: '', g1: '' }).errors.g); // nothing at all and no preset: G is needed
});

test('moto: G.1 + 75 kg rider comes first, then G + 75, then F - 65, then the preset', () => {
  const m = (raw) => buildAdvancedMoto({ raw: { ratedKw: 70, ...raw }, preset: MOTO_PRESET, tier1K: 0.45, presetMass: 300 }).profile;
  const a = m({ g1: 180, g: 200, maxLaden: 370 });
  assert.equal(a.m, 255);
  assert.match(a.note, /G\.1/);
  assert.equal(m({ g: 200, maxLaden: 370 }).m, 275);
  assert.equal(m({ maxLaden: 370 }).m, 305);
  assert.equal(m({}).m, 300);
  assert.equal(checkMoto({ g: '', g1: 180, ratedKw: 70 }).errors.g, undefined);
  assert.ok(checkMoto({ g: '', g1: 5, ratedKw: 70 }).errors.g1);
});

test('coherence: G and G.1 both typed must be 75 kg apart (5 kg of rounding accepted); a mismatch is an error on G.1', () => {
  const ok = (g, g1) => checkAdvanced({ ...RAW, g, g1 }).errors.g1;
  assert.equal(ok(1500, 1425), undefined);
  assert.equal(ok(1500, 1420), undefined); // 80 kg apart: within the tolerance
  assert.equal(ok(1500, 1430), undefined); // 70 kg apart
  assert.equal(COHERENCE_TOLERANCE, 5);
  assert.match(ok(1500, 1500), /G minus G\.1 is 0 kg/);
  assert.match(ok(1500, 1300), /200 kg/);
  assert.ok(ok(1425, 1500)); // swapped
  // no error when only one of them is typed
  assert.equal(checkAdvanced({ ...RAW, g: 1500, g1: '' }).errors.g1, undefined);
  assert.equal(checkAdvanced({ ...RAW, g: '', g1: 1425 }).errors.g1, undefined);
});

test('coherence: a mismatch stops the build; an agreement is confirmed in the note', () => {
  assert.ok(buildAdvanced({ raw: { ...RAW, g: 1500, g1: 1300 }, fuel: 'gasoline', tier1K: 0.45 }).errors.g1);
  const ok = buildAdvanced({ raw: { ...RAW, g: 1500, g1: 1425 }, fuel: 'gasoline', tier1K: 0.45 }).profile;
  assert.equal(ok.m, 1500);
  assert.match(ok.note, /G and G\.1 agree/);
});

test('coherence: not applied to motorcycles, whose G excludes the rider (G.1 still comes first)', () => {
  const r = buildAdvancedMoto({ raw: { g: 200, g1: 190, ratedKw: 70 }, preset: MOTO_PRESET, tier1K: 0.45, presetMass: 300 });
  assert.equal(r.errors, undefined);
  assert.equal(r.profile.m, 265);
});
