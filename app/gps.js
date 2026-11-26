// gps.js — everything about reading the GPS, and nothing else.
//
// Wraps navigator.geolocation.watchPosition. It hands app.js one clean sample per fix:
//   { v, accuracy, t, alt, altAcc }
//   v         speed in m/s (from the device, or worked out from two fixes when the device gives none)
//   accuracy  horizontal accuracy (m)
//   t         time of the fix (ms since 1970)
//   alt       altitude (m) or null;  altAcc  its accuracy (m) or null
// Latitude and longitude are used here to derive a speed when needed and are never passed on,
// so no position leaves this file (and none can end up in the trip log).
// The pure functions below are tested in gps.test.js.

const EARTH_RADIUS = 6371000; // m
const WATCH_OPTIONS = { enableHighAccuracy: true, maximumAge: 0, timeout: 15000 };

/**
 * Signal bars (0–5) for a horizontal accuracy, as on the trip screen's GPS bar.
 * 5: ≤ 3 m, 4: ≤ 5 m (GOOD_ACCURACY, live display), 3: < 10 m, 2: < 20 m, 1: < 30 m, 0: worse or none.
 * @param {number|null|undefined} accuracy  metres
 * @returns {number}
 */
export function signalBars(accuracy) {
  if (accuracy == null || !(accuracy >= 0)) return 0;
  if (accuracy <= 3) return 5;
  if (accuracy <= 5) return 4;
  if (accuracy < 10) return 3;
  if (accuracy < 20) return 2;
  if (accuracy < 30) return 1;
  return 0;
}

let watchId = null;
let lastFix = null; // previous position { lat, lon, t }, used when the device gives no speed

/**
 * Distance between two positions along the Earth's surface (haversine formula).
 * @param {{lat:number, lon:number}} a  degrees
 * @param {{lat:number, lon:number}} b  degrees
 * @returns {number} metres
 */
export function distanceBetween(a, b) {
  const rad = Math.PI / 180;
  const dLat = (b.lat - a.lat) * rad;
  const dLon = (b.lon - a.lon) * rad;
  const h = Math.sin(dLat / 2) ** 2 +
    Math.cos(a.lat * rad) * Math.cos(b.lat * rad) * Math.sin(dLon / 2) ** 2;
  return 2 * EARTH_RADIUS * Math.asin(Math.sqrt(h));
}

/**
 * Speed from two fixes: distance divided by the time between them.
 * @param {{lat:number, lon:number, t:number}|null} prev  earlier fix (t in ms)
 * @param {{lat:number, lon:number, t:number}} cur        later fix
 * @returns {number|null} m/s, or null when there is no earlier fix or no time has passed
 */
export function speedFromFixes(prev, cur) {
  if (!prev) return null;
  const dt = (cur.t - prev.t) / 1000;
  if (dt <= 0) return null;
  return distanceBetween(prev, cur) / dt;
}

/**
 * Start watching the GPS. Replaces any watch already running.
 * @param {object} p
 * @param {(sample: object) => void} p.onSample
 * @param {(kind: 'unsupported'|'denied'|'lost') => void} p.onProblem
 *   'unsupported': no location API; 'denied': the user blocked location; 'lost': no signal or a timeout
 */
export function startGps({ onSample, onProblem }) {
  stopGps();
  if (!('geolocation' in navigator)) {
    onProblem('unsupported');
    return;
  }
  watchId = navigator.geolocation.watchPosition(
    (pos) => {
      const c = pos.coords;
      const here = { lat: c.latitude, lon: c.longitude, t: pos.timestamp };
      let v = c.speed;
      if (v == null || Number.isNaN(v)) v = speedFromFixes(lastFix, here);
      lastFix = here;
      if (v == null) return; // first fix with no speed: nothing to show yet
      onSample({ v: Math.max(0, v), accuracy: c.accuracy, t: pos.timestamp, alt: c.altitude, altAcc: c.altitudeAccuracy });
    },
    (err) => onProblem(err.code === err.PERMISSION_DENIED ? 'denied' : 'lost'),
    WATCH_OPTIONS,
  );
}

/** Stop watching. Safe to call when nothing is running. */
export function stopGps() {
  if (watchId != null) navigator.geolocation.clearWatch(watchId);
  watchId = null;
  lastFix = null;
}
