// Run with: node --test   (from the project root)
import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import {
  LOG_COLUMNS, logFileName, formatRow, buildCsv, loadLogs, storeLog, hasSavedLogs,
  startLog, stopLog, logAdd, logActive,
} from './triplog.js';

// A small fake localStorage; `limit` (characters) makes setItem throw like a full storage.
let data, limit;
beforeEach(() => {
  stopLog(); // make sure no recording is left over from the previous test
  data = {};
  limit = Infinity;
  globalThis.localStorage = {
    getItem: (k) => (k in data ? data[k] : null),
    setItem: (k, v) => {
      if (String(v).length > limit) throw new Error('QuotaExceededError');
      data[k] = String(v);
    },
  };
});

const log = (id, rows = []) => ({ id: String(id), name: `log-${id}.csv`, meta: { a: 1 }, rows });
const cols = LOG_COLUMNS.length;

test('logFileName: local date and time, zero padded', () => {
  assert.equal(logFileName(new Date(2026, 10, 23, 22, 5).getTime()), 'fuelcost-log-20261123-2205.csv');
  assert.equal(logFileName(new Date(2026, 0, 5, 7, 3).getTime()), 'fuelcost-log-20260105-0703.csv');
});

test('formatRow: rounds to each column, leaves missing, null and NaN empty, ends with the note', () => {
  const cells = formatRow({ t_s: 1.234, v_ms: 13.88888, alt_m: null, a_ms2: NaN, p_total_W: 15822.4, theta_rad: 0.0426312 }, 'start').split(',');
  assert.equal(cells.length, cols + 1);
  const at = (name) => cells[LOG_COLUMNS.findIndex(([n]) => n === name)];
  assert.equal(at('t_s'), '1.2');
  assert.equal(at('v_ms'), '13.889');
  assert.equal(at('alt_m'), '');
  assert.equal(at('a_ms2'), '');
  assert.equal(at('dt_s'), '');
  assert.equal(at('p_total_W'), '15822');
  assert.equal(at('theta_rad'), '0.04263');
  assert.equal(cells.at(-1), 'start');
});

test('formatRow: no note gives an empty last cell; zero is kept as 0, not blanked', () => {
  const cells = formatRow({ v_ms: 0 }).split(',');
  assert.equal(cells.length, cols + 1);
  assert.equal(cells[LOG_COLUMNS.findIndex(([n]) => n === 'v_ms')], '0');
  assert.equal(cells.at(-1), '');
});

test('buildCsv: # header lines, then the column names, then the rows, ending with a newline', () => {
  const csv = buildCsv({ meta: { vehicle: 'suv', passengers: 2 }, rows: ['r1', 'r2'] });
  const lines = csv.split('\n');
  assert.equal(lines[0], '# vehicle=suv');
  assert.equal(lines[1], '# passengers=2');
  assert.ok(lines[2].startsWith('# p_total_W includes the A/C load'));
  assert.equal(lines[3], [...LOG_COLUMNS.map(([n]) => n), 'note'].join(','));
  assert.deepEqual(lines.slice(4), ['r1', 'r2', '']);
});

test('buildCsv: states that no coordinates are recorded and has no coordinate column', () => {
  const csv = buildCsv({ meta: {}, rows: [] });
  assert.ok(csv.includes('no coordinates are recorded'));
  assert.ok(!LOG_COLUMNS.some(([n]) => /lat|lon/i.test(n)));
});

test('loadLogs: empty when nothing is saved, when the data is corrupt, or when it is not a list', () => {
  assert.deepEqual(loadLogs(), []);
  data['fuelprice.logs'] = '{not json';
  assert.deepEqual(loadLogs(), []);
  data['fuelprice.logs'] = '{"a":1}';
  assert.deepEqual(loadLogs(), []);
});

test('loadLogs: empty when reading storage throws', () => {
  globalThis.localStorage = { getItem() { throw new Error('blocked'); }, setItem() {} };
  assert.deepEqual(loadLogs(), []);
  assert.equal(hasSavedLogs(), false);
});

test('storeLog: saves id, name and the CSV, and hasSavedLogs becomes true', () => {
  assert.equal(hasSavedLogs(), false);
  storeLog(log(1, ['row']));
  assert.equal(hasSavedLogs(), true);
  const [saved] = loadLogs();
  assert.equal(saved.id, '1');
  assert.equal(saved.name, 'log-1.csv');
  assert.ok(saved.csv.includes('\nrow\n'));
});

test('storeLog: saving the same id again replaces it instead of adding a second copy', () => {
  storeLog(log(1, ['old']));
  storeLog(log(1, ['old', 'new']));
  const logs = loadLogs();
  assert.equal(logs.length, 1);
  assert.ok(logs[0].csv.includes('new'));
});

test('storeLog: keeps only the newest 3 logs', () => {
  for (let i = 1; i <= 5; i++) storeLog(log(i));
  assert.deepEqual(loadLogs().map((l) => l.id), ['3', '4', '5']);
});

test('storeLog: when storage is full it drops the oldest logs until the rest fits', () => {
  const big = (id) => log(id, ['x'.repeat(1000)]);
  storeLog(big(1));
  storeLog(big(2));
  limit = 1700; // room for about one log of this size
  storeLog(big(3));
  assert.deepEqual(loadLogs().map((l) => l.id), ['3']);
});

test('storeLog: when even one log does not fit it gives up quietly and keeps what was saved', () => {
  storeLog(log(1));
  limit = 10;
  assert.doesNotThrow(() => storeLog(log(2, ['x'.repeat(500)])));
  assert.deepEqual(loadLogs().map((l) => l.id), ['1']);
});

test('recording: logAdd does nothing when no log is active', () => {
  assert.equal(logActive(), false);
  logAdd({ v_ms: 1 });
  assert.equal(stopLog(), false);
  assert.equal(hasSavedLogs(), false);
});

test('recording: start, add rows, stop saves a CSV with the meta, the rows and the notes', () => {
  startLog({ startMs: 1000, meta: { vehicle: 'suv' } });
  assert.equal(logActive(), true);
  logAdd({ t_s: 1, v_ms: 5 }, 'start');
  logAdd({ t_s: 2, v_ms: 6 });
  assert.equal(stopLog(), true);
  assert.equal(logActive(), false);
  const [saved] = loadLogs();
  assert.equal(saved.id, '1000');
  assert.ok(saved.csv.includes('# vehicle=suv'));
  const rows = saved.csv.trim().split('\n').slice(3); // after 1 meta line, the note line and the column names
  assert.equal(rows.length, 2);
  assert.ok(rows[0].endsWith(',start'));
  assert.ok(rows[0].startsWith('1,,5'));
  assert.equal(stopLog(), false); // stopping twice is safe
});

test('recording: starting a new log saves the one that was running', () => {
  startLog({ startMs: 1, meta: {} });
  logAdd({ v_ms: 1 });
  startLog({ startMs: 2, meta: {} });
  assert.deepEqual(loadLogs().map((l) => l.id), ['1']);
  stopLog();
  assert.deepEqual(loadLogs().map((l) => l.id), ['1', '2']);
});

test('recording: the log saves itself on a timer, so a crash does not lose the drive', () => {
  const realSet = globalThis.setInterval, realClear = globalThis.clearInterval;
  let tick = null, cleared = 0;
  globalThis.setInterval = (fn, ms) => { tick = { fn, ms }; return 7; };
  globalThis.clearInterval = (id) => { if (id === 7) cleared += 1; };
  try {
    startLog({ startMs: 5, meta: {} });
    assert.equal(tick.ms, 30000);
    logAdd({ v_ms: 1 });
    assert.equal(hasSavedLogs(), false);
    tick.fn(); // 30 s later
    assert.equal(loadLogs().length, 1);
    stopLog();
    assert.equal(cleared, 1, 'the timer is cleared at stop');
  } finally {
    globalThis.setInterval = realSet;
    globalThis.clearInterval = realClear;
  }
});
