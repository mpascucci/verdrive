// Run with: node --test
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { normalizeStore, settingsFor, activeSettings, saveVehicle, setActive, recentVehicles } from './vehicles.js';

const RULES = {
  vehicles: ['city', 'sedan', 'suv', 'van', 'scooter', 'moto'],
  fuels: ['gasoline', 'diesel', 'lpg'],
  gasolineOnly: (v) => v === 'scooter' || v === 'moto',
};
const ADV = { g: '1450', ratedKw: '96' };

test('normalizeStore: nothing usable gives null', () => {
  for (const raw of [null, undefined, 'x', 5, {}, { vehicles: {} }, { vehicle: 'sedan', fuel: 'gasoline', price: 0 }]) {
    assert.equal(normalizeStore(raw, RULES), null, JSON.stringify(raw));
  }
});

test('normalizeStore: the old flat format is migrated, keeping average and advanced', () => {
  const s = normalizeStore({ vehicle: 'sedan', fuel: 'diesel', price: 1.7, average: 5.2, advanced: ADV }, RULES);
  assert.deepEqual(s, { version: 2, active: 'sedan', recent: ['sedan'], vehicles: { sedan: { fuel: 'diesel', price: 1.7, average: 5.2, advanced: ADV } } });
  assert.deepEqual(activeSettings(s), { vehicle: 'sedan', fuel: 'diesel', price: 1.7, average: 5.2, advanced: ADV });
});

test('normalizeStore: the new format passes through; invalid entries are dropped; active falls back to a valid one', () => {
  const raw = { version: 2, active: 'ghost', vehicles: {
    sedan: { fuel: 'gasoline', price: 1.8 },
    plane: { fuel: 'gasoline', price: 1 },
    suv: { fuel: 'water', price: 1.8 },
    van: { fuel: 'diesel', price: -1 },
  } };
  const s = normalizeStore(raw, RULES);
  assert.deepEqual(Object.keys(s.vehicles), ['sedan']);
  assert.equal(s.active, 'sedan');
});

test('normalizeStore: a two-wheeler stored with diesel is corrected to gasoline', () => {
  const s = normalizeStore({ vehicle: 'moto', fuel: 'diesel', price: 1.8 }, RULES);
  assert.equal(s.vehicles.moto.fuel, 'gasoline');
});

test('saveVehicle: first run creates the store and makes the vehicle active', () => {
  const s = saveVehicle(null, { vehicle: 'sedan', fuel: 'gasoline', price: 1.85 });
  assert.deepEqual(s, { version: 2, active: 'sedan', recent: ['sedan'], vehicles: { sedan: { fuel: 'gasoline', price: 1.85 } } });
});

test('saveVehicle: each vehicle keeps its own settings; saving another one makes it active without touching the first', () => {
  let s = saveVehicle(null, { vehicle: 'sedan', fuel: 'diesel', price: 1.7, average: 5.2, advanced: ADV });
  s = saveVehicle(s, { vehicle: 'moto', fuel: 'gasoline', price: 1.9, average: 4 });
  assert.equal(s.active, 'moto');
  assert.deepEqual(settingsFor(s, 'sedan'), { vehicle: 'sedan', fuel: 'diesel', price: 1.7, average: 5.2, advanced: ADV });
  assert.deepEqual(settingsFor(s, 'moto'), { vehicle: 'moto', fuel: 'gasoline', price: 1.9, average: 4 });
  assert.equal(settingsFor(s, 'suv'), null);
});

test('saveVehicle: the entry is replaced as a whole (leaving out average or advanced removes them), and the input store is not changed', () => {
  const before = saveVehicle(null, { vehicle: 'sedan', fuel: 'gasoline', price: 1.8, average: 5, advanced: ADV });
  const copy = JSON.stringify(before);
  const after = saveVehicle(before, { vehicle: 'sedan', fuel: 'gasoline', price: 1.9, average: undefined });
  assert.deepEqual(settingsFor(after, 'sedan'), { vehicle: 'sedan', fuel: 'gasoline', price: 1.9 });
  assert.equal(JSON.stringify(before), copy);
});

test('a saved store survives a JSON round trip and normalizing', () => {
  let s = saveVehicle(null, { vehicle: 'sedan', fuel: 'gasoline', price: 1.85, advanced: ADV });
  s = saveVehicle(s, { vehicle: 'scooter', fuel: 'gasoline', price: 1.85, average: 3.1 });
  assert.deepEqual(normalizeStore(JSON.parse(JSON.stringify(s)), RULES), s);
  assert.equal(activeSettings(null), null);
});

test('setActive: switches to a saved vehicle without changing any settings; an unsaved vehicle changes nothing', () => {
  let s = saveVehicle(null, { vehicle: 'sedan', fuel: 'diesel', price: 1.7, average: 5.2, advanced: ADV });
  s = saveVehicle(s, { vehicle: 'moto', fuel: 'gasoline', price: 1.9 });
  assert.equal(s.active, 'moto');
  const back = setActive(s, 'sedan');
  assert.equal(back.active, 'sedan');
  assert.deepEqual(back.vehicles, s.vehicles);
  assert.equal(s.active, 'moto'); // the input is not changed
  assert.equal(setActive(s, 'suv'), s);
  assert.equal(setActive(null, 'sedan'), null);
});

test('recent: saving or switching puts a vehicle first; the list never has duplicates or unknown vehicles', () => {
  let s = saveVehicle(null, { vehicle: 'sedan', fuel: 'gasoline', price: 1.8 });
  s = saveVehicle(s, { vehicle: 'moto', fuel: 'gasoline', price: 1.8 });
  s = saveVehicle(s, { vehicle: 'scooter', fuel: 'gasoline', price: 1.8 });
  assert.deepEqual(s.recent, ['scooter', 'moto', 'sedan']);
  assert.deepEqual(recentVehicles(s), ['scooter', 'moto']);
  s = setActive(s, 'sedan');
  assert.deepEqual(s.recent, ['sedan', 'scooter', 'moto']);
  assert.deepEqual(recentVehicles(s), ['sedan', 'scooter']);
  s = saveVehicle(s, { vehicle: 'moto', fuel: 'gasoline', price: 1.9 }); // saving again counts as use
  assert.deepEqual(s.recent, ['moto', 'sedan', 'scooter']);
  assert.deepEqual(recentVehicles(s, 1), ['moto']);
  assert.equal(setActive(s, 'suv'), s); // an unsaved vehicle changes nothing
  assert.deepEqual(recentVehicles(null), []);
});

test('recent: derived when missing (old stores), repaired when it holds unknown or repeated ids, and kept through a round trip', () => {
  const old = normalizeStore({ version: 2, active: 'moto', vehicles: { sedan: { fuel: 'gasoline', price: 1.8 }, moto: { fuel: 'gasoline', price: 1.8 } } }, RULES);
  assert.deepEqual(old.recent, ['moto', 'sedan']); // active first, then the rest
  const messy = normalizeStore({ version: 2, active: 'sedan', recent: ['ghost', 'moto', 'moto', 'suv'],
    vehicles: { sedan: { fuel: 'gasoline', price: 1.8 }, moto: { fuel: 'gasoline', price: 1.8 } } }, RULES);
  assert.deepEqual(messy.recent, ['sedan', 'moto']);
  let s = saveVehicle(null, { vehicle: 'sedan', fuel: 'gasoline', price: 1.8 });
  s = saveVehicle(s, { vehicle: 'moto', fuel: 'gasoline', price: 1.8 });
  assert.deepEqual(normalizeStore(JSON.parse(JSON.stringify(s)), RULES), s);
});
