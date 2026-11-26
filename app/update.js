// update.js — offline use and automatic updates of the installed app.
//
// sw.js caches the app and serves it offline (and passes an Access login redirect on).
// This file checks for a new version at launch, when the app comes back to the front, and every
// 30 minutes, and reloads the page to apply it. It never reloads while the app is busy (a trip
// is running): the reload then waits until the app asks for it (see reloadIfUpdateWaiting).
// Needs no version number: a new version is detected from the files themselves.
// buildId is pure and tested in update.test.js.

// The files that make up the app. A change in any of them is a new version.
const WATCHED = ['index.html', 'style.css', 'app.js', 'model.js', 'gps.js', 'triplog.js', 'update.js', 'profile.js', 'wltc.js', 'vehicles.js', 'elevation.js', 'i18n.js', 'segments.js'];
const CHECK_EVERY = 30 * 60 * 1000; // ms

let isBusy = () => false;
let waiting = false; // a new version has arrived but the app was busy

/**
 * A short id from the content of the files (FNV-1a hash, first 7 hex digits). It changes whenever
 * any app file changes, so the label on screen shows which version is running and whether an
 * update arrived.
 * @param {string} text  all the watched files joined together
 * @returns {string} 7 hex digits
 */
export function buildId(text) {
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) h = Math.imul(h ^ text.charCodeAt(i), 0x01000193);
  return (h >>> 0).toString(16).padStart(8, '0').slice(0, 7);
}

// The current content of all watched files, fetched fresh (not from the HTTP cache).
async function fingerprint() {
  const texts = await Promise.all(WATCHED.map(async (f) => {
    const r = await fetch(f, { cache: 'no-cache' });
    if (!r.ok) throw new Error(f);
    return r.text();
  }));
  return texts.join('\u0000');
}

function applyUpdate() {
  if (isBusy()) waiting = true;
  else location.reload();
}

/**
 * If an update arrived while the app was busy, reload now.
 * Call it at a safe moment (for example when the trip setup screen opens).
 * @returns {boolean} true if the page is reloading
 */
export function reloadIfUpdateWaiting() {
  if (!waiting) return false;
  location.reload();
  return true;
}

/**
 * Start registering the service worker and checking for updates.
 * @param {object} p
 * @param {() => boolean} p.isBusy      true while a reload would lose work (a trip is running)
 * @param {(id: string) => void} p.onVersion  called once with the build id of the running files
 */
export function startUpdates({ isBusy: busy, onVersion }) {
  isBusy = busy;

  // the version label works even where there is no service worker
  const baselineP = fingerprint().catch(() => null); // null when offline: no label, no check
  baselineP.then((fp) => { if (fp) onVersion(buildId(fp)); });

  if (!('serviceWorker' in navigator)) return;
  const hadController = Boolean(navigator.serviceWorker.controller); // false on the very first visit
  navigator.serviceWorker.addEventListener('controllerchange', () => { if (hadController) applyUpdate(); });

  navigator.serviceWorker.register('./sw.js').then(async (reg) => {
    const baseline = await baselineP;
    const check = async () => {
      try {
        await reg.update(); // picks up a changed sw.js
        const now = await fingerprint(); // also catches changed app files when sw.js is unchanged
        if (baseline && now !== baseline) applyUpdate();
      } catch { /* offline: try again later */ }
    };
    document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') check(); });
    setInterval(check, CHECK_EVERY);
  }).catch(() => { /* not on HTTPS/localhost, or blocked: the app still runs, just not offline */ });
}
