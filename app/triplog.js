// triplog.js — the trip log: one CSV row per GPS sample, kept on the phone, exported on request.
//
// Records the numbers of a drive so it can be replayed through the model on a computer.
// It stores whatever app.js gives it. app.js never gives it coordinates, so none are logged.
// The log stays on this phone (localStorage, newest 3 trips) until "Export log" hands it to the
// share sheet. Row formatting, the CSV text, the file name and the storage rules are tested in
// triplog.test.js.

const LOGS_KEY = 'fuelprice.logs';
const LOGS_KEPT = 3;
const SAVE_EVERY = 30000; // ms: a crash or an iOS reload must not lose the drive

export const LOG_COLUMNS = [ // [name, decimals]
  ['t_s', 1], ['dt_s', 2], ['v_ms', 3], ['gps_acc_m', 1], ['alt_m', 1], ['alt_acc_m', 1],
  ['a_ms2', 3], ['theta_raw_rad', 5], ['theta_rad', 5],
  ['p_inertia_W', 0], ['p_grade_W', 0], ['p_rolling_W', 0], ['p_drag_W', 0], ['p_ac_W', 0], ['p_total_W', 0],
  ['f_Lh', 3], ['f_smooth_Lh', 3],
];

let current = null; // the log being recorded: { id, name, meta, rows, timer }

function pad2(n) { return String(n).padStart(2, '0'); }

/** File name from the start time, in local time: fuelcost-log-20261123-2205.csv */
export function logFileName(startMs) {
  const d = new Date(startMs);
  return `fuelcost-log-${d.getFullYear()}${pad2(d.getMonth() + 1)}${pad2(d.getDate())}-${pad2(d.getHours())}${pad2(d.getMinutes())}.csv`;
}

/**
 * One CSV row from named values. Missing, null and NaN values become empty cells; numbers are
 * rounded to the decimals of their column; the note goes in the last cell.
 */
export function formatRow(values, note = '') {
  const cells = LOG_COLUMNS.map(([name, decimals]) => {
    const x = values[name];
    return x == null || Number.isNaN(x) ? '' : String(Number(x.toFixed(decimals)));
  });
  return `${cells.join(',')},${note}`;
}

/** The whole CSV text: `# key=value` header lines, the column names, then the rows. */
export function buildCsv({ meta, rows }) {
  const head = Object.entries(meta).map(([k, v]) => `# ${k}=${v}`);
  head.push('# p_total_W includes the A/C load; f_Lh is the unsmoothed fuel rate; no coordinates are recorded');
  return [...head, [...LOG_COLUMNS.map(([n]) => n), 'note'].join(','), ...rows].join('\n') + '\n';
}

/** The saved logs, oldest first: [{ id, name, csv }]. Empty if storage is blocked or corrupt. */
export function loadLogs() {
  try {
    const x = JSON.parse(localStorage.getItem(LOGS_KEY));
    return Array.isArray(x) ? x : [];
  } catch { return []; }
}

/** Save (or update, by id) a log, keeping the newest LOGS_KEPT. If storage is full, drops the oldest. */
export function storeLog(log) {
  let logs = loadLogs().filter((l) => l.id !== log.id);
  logs.push({ id: log.id, name: log.name, csv: buildCsv(log) });
  logs = logs.slice(-LOGS_KEPT);
  while (logs.length) {
    try { localStorage.setItem(LOGS_KEY, JSON.stringify(logs)); return; }
    catch { logs.shift(); } // storage full: drop the oldest and retry
  }
}

/** True if at least one log is saved on this phone. */
export function hasSavedLogs() {
  return loadLogs().length > 0;
}

/**
 * Start recording a trip. Replaces any log being recorded. Saves itself every 30 s.
 * @param {object} p
 * @param {number} p.startMs  start time (ms since 1970); also the log's id
 * @param {object} p.meta     facts about the trip, written as `# key=value` header lines
 */
export function startLog({ startMs, meta }) {
  stopLog();
  const log = { id: String(startMs), name: logFileName(startMs), meta, rows: [], timer: null };
  log.timer = setInterval(() => storeLog(log), SAVE_EVERY);
  current = log;
}

/** True while a log is being recorded. */
export function logActive() {
  return current !== null;
}

/** Add a row to the log being recorded. Does nothing when no log is active. */
export function logAdd(values, note = '') {
  if (current) current.rows.push(formatRow(values, note));
}

/**
 * Stop recording and save.
 * @returns {boolean} true if a log was being recorded
 */
export function stopLog() {
  if (!current) return false;
  clearInterval(current.timer);
  storeLog(current);
  current = null;
  return true;
}

/** Hand the newest saved log to the share sheet (AirDrop, Mail, Files); download it if sharing is unavailable. */
export async function exportLatestLog() {
  const last = loadLogs().at(-1);
  if (!last) return;
  const file = new File([last.csv], last.name, { type: 'text/csv' });
  try {
    if (navigator.canShare?.({ files: [file] })) {
      await navigator.share({ files: [file], title: 'VerDrive log' });
      return;
    }
  } catch (err) {
    if (err.name === 'AbortError') return; // the user closed the share sheet
  }
  const url = URL.createObjectURL(file);
  const link = document.createElement('a');
  link.href = url;
  link.download = last.name;
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 10000);
}
