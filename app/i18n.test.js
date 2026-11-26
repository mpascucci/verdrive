// Run with: node --test   (from the project root)
import { test, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { t, nf, setLang, getLang, initialLang, missingKeys, LANGS } from './i18n.js';
import { checkAverage } from './profile.js';

afterEach(() => setLang('en'));

test('every English key has an Italian text', () => {
  assert.deepEqual(missingKeys('it'), []);
});

test('t: placeholders are filled; an unknown key comes back as itself', () => {
  assert.equal(t('gps.alt', { acc: 'GPS ±4 m', h: 120 }), 'GPS ±4 m · altitude 120 m');
  setLang('it');
  assert.equal(t('gps.alt', { acc: 'GPS ±4 m', h: 120 }), 'GPS ±4 m · altitudine 120 m');
  assert.equal(t('no.such.key'), 'no.such.key');
});

test('t: entries can be functions (plurals)', () => {
  assert.equal(t('tree.days', { n: 1 }), '~1 day');
  assert.equal(t('tree.days', { n: 3 }), '~3 days');
  setLang('it');
  assert.equal(t('tree.days', { n: 1 }), '~1 giorno');
});

test('nf: decimal point in English, decimal comma in Italian', () => {
  assert.equal(nf(14.25, 1), '14.3');
  assert.equal(nf(3, 2), '3.00');
  setLang('it');
  assert.equal(nf(14.25, 1), '14,3');
  assert.equal(nf(1234.5, 1), '1234,5');
});

test('initialLang: saved language first, else Italian for an Italian browser, else English', () => {
  assert.equal(initialLang('it', ['en-GB']), 'it');
  assert.equal(initialLang(null, ['it-IT', 'en']), 'it');
  assert.equal(initialLang(null, ['fr-FR', 'en']), 'en');
  assert.equal(initialLang('xx', []), 'en');
  assert.deepEqual(Object.keys(LANGS), ['en', 'it']);
});

test('setLang ignores unknown languages; model messages follow the language', () => {
  setLang('de');
  assert.equal(getLang(), 'en');
  setLang('it');
  assert.match(checkAverage(80).error, /^Consumo medio: deve essere tra 1 e 40 L\/100 km\.$/);
});
