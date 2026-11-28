// Run with: node --test
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { cleanName, normalizePresets, savePreset, deletePreset, getPreset, presetNames, NAME_MAX } from './presets.js';

const RULES = {
  vehicles: ['city', 'sedan', 'suv', 'van', 'scooter', 'moto'],
  fuels: ['gasoline', 'diesel', 'lpg'],
  gasolineOnly: (v) => v === 'scooter' || v === 'moto',
};
const EMPTY = { last: null, presets: {} };
const PANDA = { vehicle: 'city', fuel: 'lpg', price: 0.75, average: 6.1, advanced: { g: '1050' } };

test('cleanName: trims, collapses spaces, caps the length', () => {
  assert.equal(cleanName('  My   Panda '), 'My Panda');
  assert.equal(cleanName(''), '');
  assert.equal(cleanName(null), '');
  assert.equal(cleanName('x'.repeat(60)).length, NAME_MAX);
});

test('normalizePresets: nothing usable gives an empty set; bad entries dropped; two-wheelers forced to gasoline', () => {
  for (const raw of [null, 'x', {}, { presets: 5 }]) assert.deepEqual(normalizePresets(raw, RULES), EMPTY);
  const s = normalizePresets({ last: 'ghost', presets: {
    Panda: PANDA,
    Plane: { vehicle: 'plane', fuel: 'gasoline', price: 1 },
    Free: { vehicle: 'sedan', fuel: 'gasoline', price: 0 },
    Bike: { vehicle: 'moto', fuel: 'diesel', price: 1.9 },
  } }, RULES);
  assert.deepEqual(presetNames(s), ['Bike', 'Panda']);
  assert.equal(s.presets.Bike.fuel, 'gasoline');
  assert.deepEqual(s.presets.Panda, PANDA);
  assert.equal(s.last, null);
});

test('savePreset: stores a copy under the clean name, replaces the same name, sets last; empty name does nothing', () => {
  let s = savePreset(EMPTY, '  Panda ', { ...PANDA, average: undefined });
  assert.deepEqual(s.presets.Panda, { vehicle: 'city', fuel: 'lpg', price: 0.75, advanced: { g: '1050' } });
  assert.equal(s.last, 'Panda');
  s = savePreset(s, 'Panda', { vehicle: 'city', fuel: 'gasoline', price: 1.9 });
  assert.deepEqual(s.presets.Panda, { vehicle: 'city', fuel: 'gasoline', price: 1.9 });
  assert.equal(savePreset(s, '   ', PANDA), s);
  assert.deepEqual(EMPTY, { last: null, presets: {} }); // input not changed
});

test('getPreset / deletePreset', () => {
  let s = savePreset(savePreset(EMPTY, 'Panda', PANDA), 'Van', { vehicle: 'van', fuel: 'diesel', price: 1.7 });
  assert.deepEqual(getPreset(s, ' Panda'), PANDA);
  assert.equal(getPreset(s, 'nope'), null);
  s = deletePreset(s, 'Van');
  assert.deepEqual(presetNames(s), ['Panda']);
  assert.equal(s.last, null); // Van was the last saved
  assert.equal(deletePreset(s, 'nope'), s);
});

test('presetNames: sorted ignoring case', () => {
  const s = ['b', 'A', 'c'].reduce((acc, n) => savePreset(acc, n, PANDA), EMPTY);
  assert.deepEqual(presetNames(s), ['A', 'b', 'c']);
});
