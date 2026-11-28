// Run with: node --test   (from the project root)
// The two file lists of the installed app must cover every app file:
//   - WATCHED in update.js: the files whose content makes the version id (a file left out: its changes never update phones);
//   - PRECACHE in sw.js: the files stored for offline use (a file left out: the app breaks offline).
// And every listed file must exist (a missing one makes the service worker's install fail).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

const APP = import.meta.dirname;
const listIn = (file, name) => {
  const src = fs.readFileSync(path.join(APP, file), 'utf8');
  const m = src.match(new RegExp(`const ${name} = \\[([\\s\\S]*?)\\];`));
  assert.ok(m, `${name} not found in ${file}`);
  return [...m[1].matchAll(/'([^']+)'/g)].map((x) => x[1]);
};
const WATCHED = listIn('update.js', 'WATCHED');
const PRECACHE = listIn('sw.js', 'PRECACHE');

// the app's own code and text: every script except tests and the service worker itself, the page, its styles
const appFiles = fs.readdirSync(APP)
  .filter((f) => (f.endsWith('.js') && !f.endsWith('.test.js') && f !== 'sw.js') || ['index.html', 'style.css', 'CREDITS.md'].includes(f));

test('every app file is in WATCHED (update.js), so a change to it is a new version', () => {
  assert.deepEqual(appFiles.filter((f) => !WATCHED.includes(f)), []);
});

test('every app file is in PRECACHE (sw.js), so the app works offline', () => {
  assert.deepEqual(appFiles.filter((f) => !PRECACHE.includes(f)), []);
});

test('every file in WATCHED and PRECACHE exists', () => {
  const missing = [...WATCHED, ...PRECACHE].filter((f) => f !== './' && !fs.existsSync(path.join(APP, f)));
  assert.deepEqual(missing, []);
});
