// model.js — pure physics/fuel model. No DOM, no sensors, so it can be tested alone.
// Units are SI everywhere (m/s, m/s², kg, m², W) unless a name says otherwise.

// Gravitational acceleration (m/s²)
export const G = 9.81;

/**
 * Tractive power: the mechanical power the car needs at the wheels.
 *
 *   P = v · [ λ·m·a  +  m·g·sinθ  +  m·g·Crr  +  ½·ρ·CdA·v² ]
 *            inertia     grade        rolling      air drag
 *
 * @param {object} p
 * @param {number} p.v       speed (m/s)
 * @param {number} p.a       acceleration (m/s²); negative when slowing down
 * @param {number} p.m       mass including occupants (kg)
 * @param {number} p.cdA     drag area Cd·A (m²)
 * @param {number} [p.theta] road angle (radians); positive uphill, negative downhill; 0 = flat
 * @param {number} [p.crr]   rolling resistance coefficient (dimensionless)
 * @param {number} [p.lambda] rotating-mass factor (dimensionless)
 * @param {number} [p.rho]   air density (kg/m³)
 * @returns {number} power in watts; negative when braking, decelerating or going downhill
 */
export function tractivePower({
  v,
  a,
  m,
  cdA,
  theta = 0,
  crr = 0.010,
  lambda = 1.05,
  rho = 1.2,
}) {
  const inertia = lambda * m * a;          // N: force to change the car's speed
  const grade = m * G * Math.sin(theta);   // N: weight component along the road (+ uphill, − downhill)
  const rolling = m * G * crr;             // N: tyre friction, roughly constant
  const drag = 0.5 * rho * cdA * v * v;    // N: air resistance, grows with v²

  // Power = force × speed. At v = 0 this is exactly 0 W, whatever the forces.
  return v * (inertia + grade + rolling + drag);
}

// Below this speed the car counts as stopped (m/s). Filters GPS speed noise.
export const STOPPED_SPEED = 0.5;

// Above this speed, P <= 0 means coasting in gear: fuel cut-off (m/s, ~20 km/h).
export const COAST_MIN_SPEED = 20 / 3.6;

/**
 * Fuel rate (L/h) from tractive power: a Willans line.
 *
 *   f = f0 + k · P_kW      for P > 0
 *
 * Special cases, checked in this order:
 *   1. P is clamped to ±pMax (removes GPS spikes).
 *   2. Stopped (v < STOPPED_SPEED): 0 with start-stop, otherwise idle f0.
 *   3. Coasting (P <= 0 and v >= COAST_MIN_SPEED): 0 (fuel cut-off in gear).
 *   4. P <= 0 at low speed: engine idles, so f0.
 *   5. P > 0: Willans line.
 *
 * Any A/C load must be added to p by the caller.
 *
 * @param {object} p
 * @param {number} p.p       tractive power (W), may be negative
 * @param {number} p.v       speed (m/s)
 * @param {number} p.f0      idle fuel rate (L/h)
 * @param {number} p.k       fuel per kW (L/h per kW)
 * @param {number} p.pMax    power clamp limit (W), positive
 * @param {boolean} [p.startStop] engine switches off when stopped
 * @returns {number} fuel rate in L/h, never negative
 */
export function fuelRate({ p, v, f0, k, pMax, startStop = false }) {
  // 1. clamp power to [-pMax, +pMax]
  const power = Math.max(-pMax, Math.min(pMax, p));

  // 2. stopped
  if (v < STOPPED_SPEED) return startStop ? 0 : f0;

  if (power <= 0) {
    // 3. coasting in gear: no fuel
    if (v >= COAST_MIN_SPEED) return 0;
    // 4. slow and decelerating: idle
    return f0;
  }

  // 5. Willans line (power converted from W to kW)
  return f0 + k * (power / 1000);
}

/**
 * Convert a fuel rate and a speed into L/100 km: f / (v·3.6) · 100.
 *
 * @param {object} p
 * @param {number} p.f  fuel rate (L/h)
 * @param {number} p.v  speed (m/s)
 * @returns {number|null} L/100 km, or null when the car is (almost) stopped
 */
export function perHundredKm({ f, v }) {
  if (v < STOPPED_SPEED) return null;
  return (f / (v * 3.6)) * 100;
}

/**
 * Exponential moving average with time constant tau.
 *   α = 1 − e^(−dt/τ);  result = prev + α·(value − prev)
 * Smooth f and v separately, then divide.
 *
 * @param {object} p
 * @param {number} p.prev   previous smoothed value
 * @param {number} p.value  new raw value
 * @param {number} p.dt     time since the previous sample (s)
 * @param {number} [p.tau]  time constant (s)
 * @returns {number} new smoothed value
 */
export function smooth({ prev, value, dt, tau = 2 }) {
  const alpha = 1 - Math.exp(-dt / tau);
  return prev + alpha * (value - prev);
}

// Unit switch thresholds (m/s), with hysteresis around 10 km/h.
export const UNIT_UP_SPEED = 12 / 3.6;
export const UNIT_DOWN_SPEED = 8 / 3.6;

/**
 * Which unit to display: 'perHour' (L/h) when slow, 'per100km' when faster.
 * Switches up above ~12 km/h and down below ~8 km/h; in between keeps `previous`.
 *
 * @param {object} p
 * @param {number} p.v  speed (m/s)
 * @param {'perHour'|'per100km'} [p.previous] unit currently shown
 * @returns {'perHour'|'per100km'}
 */
export function displayUnit({ v, previous = 'perHour' }) {
  if (v >= UNIT_UP_SPEED) return 'per100km';
  if (v <= UNIT_DOWN_SPEED) return 'perHour';
  return previous;
}

/**
 * Cost from a quantity of fuel and a price per litre.
 * Works for litres (→ €) and L/h (→ €/h) alike.
 */
export function toCost({ litres, price }) {
  return litres * price;
}

/**
 * Road angle from an altitude change over a travelled distance.
 *
 *   sinθ = dh / dist,   θ = asin(dh / dist)
 *
 * GPS altitude is noisy (several metres), so a short distance would turn that noise into
 * wild slopes. Below `minDist` there is no answer yet (null: the caller keeps the last value).
 * The ratio is clamped to ±maxGrade to cut off impossible values from altitude glitches.
 *
 * @param {object} p
 * @param {number} p.dh          altitude change (m); positive when climbing
 * @param {number} p.dist        distance travelled along the road (m)
 * @param {number} [p.minDist]   shortest distance that gives an answer (m)
 * @param {number} [p.maxGrade]  clamp on dh/dist (dimensionless; 0.25 = 25%)
 * @returns {number|null} θ in radians (positive uphill), or null when dist < minDist
 */
export function slopeFromAltitude({ dh, dist, minDist = 50, maxGrade = 0.25 }) {
  if (!(dist >= minDist)) return null; // also catches NaN and non-positive distances
  const ratio = Math.max(-maxGrade, Math.min(maxGrade, dh / dist));
  return Math.asin(ratio);
}

/**
 * Smooth the road angle over distance, not time: a slope belongs to a place on the road.
 *
 *   α = 1 − e^(−dist/length);   θ_new = θ_prev + α · (θ − θ_prev)
 *
 * This is `smooth` with metres in place of seconds. After the car has travelled `length`
 * metres in total, about 63% of a step change in the road is reflected (95% after 3 lengths),
 * however many updates that took.
 *
 * - `theta` null (not enough distance yet, see slopeFromAltitude): hold `prev`.
 * - `prev` null (no slope so far): the first value starts the filter.
 * The caller passes the distance since the last accepted update, and keeps adding distance
 * while theta is null.
 *
 * @param {object} p
 * @param {number|null} p.prev   previous smoothed angle (rad), or null if none yet
 * @param {number|null} p.theta  new raw angle (rad), or null if there is no new value
 * @param {number} p.dist        distance since the last accepted update (m)
 * @param {number} [p.length]    smoothing length (m)
 * @returns {number|null} smoothed angle (rad), or null if there has never been one
 */
export function smoothSlope({ prev, theta, dist, length = 100 }) {
  if (theta == null) return prev ?? null;
  if (prev == null) return theta;
  return smooth({ prev, value: theta, dt: dist, tau: length });
}

/**
 * CO₂ emitted per litre of fuel burned (kg/L). Gasoline and diesel are the factors behind the
 * roadmap's V.7 conversion (CO₂ / 23.1 and / 26.4 g/km per L/100 km). LPG depends on the
 * propane/butane mix and density, so 1.6 is a mid value (sources: 1.6–1.65).
 */
export const CO2_PER_LITRE = { gasoline: 2.31, diesel: 2.64, lpg: 1.6 };

/** CO₂ a typical tree absorbs per year (kg). Rough: sources range from about 15 to 25 kg. */
export const TREE_KG_PER_YEAR = 20;

/**
 * CO₂ emitted by burning `litres` of `fuel`: litres × factor.
 * An unknown fuel gives NaN (no input validation, as elsewhere in the model).
 *
 * @param {object} p
 * @param {number} p.litres  fuel burned (L)
 * @param {'gasoline'|'diesel'|'lpg'} p.fuel
 * @returns {number} CO₂ in kg
 */
export function co2FromFuel({ litres, fuel }) {
  return litres * CO2_PER_LITRE[fuel];
}

/**
 * Official consumption from the certificate's V.7 CO₂ figure (Tier 2, step 1).
 * L/100 km = CO₂ (g/km) / (kg per litre × 10). The ×10 turns kg/L and g/km into L/100 km
 * (see MODEL.md section 9). Gives the roadmap's 23.1 (gasoline) and 26.4 (diesel) divisors. Unknown fuel gives NaN.
 *
 * @param {object} p
 * @param {number} p.co2  V.7, CO₂ in g/km
 * @param {'gasoline'|'diesel'|'lpg'} p.fuel
 * @returns {number} consumption in L/100 km
 */
export function consumptionFromCo2({ co2, fuel }) {
  return co2 / (CO2_PER_LITRE[fuel] * 10);
}

/** Idle fuel rate per litre of engine displacement (L/h per L). Rule of thumb, to refine (Tier 3 measures f₀). */
export const IDLE_PER_LITRE = 0.5;

/** Share of the rated engine power (P.2) that reaches the wheels, used as the clamp P_max. */
export const WHEEL_POWER_SHARE = 0.9;

/** Typical drag area CdA (m²) by body type. Rough values, in line with the Tier 1 presets (0.60–1.10). */
export const CDA_BY_BODY = { hatchback: 0.65, sedan: 0.65, estate: 0.70, suv: 0.90, van: 1.10 };

/**
 * Idle fuel rate f₀ from the engine capacity (certificate field P.1).
 *
 * @param {object} p
 * @param {number} p.displacement  P.1 in cm³
 * @returns {number} L/h
 */
export function idleFromDisplacement({ displacement }) {
  return (displacement / 1000) * IDLE_PER_LITRE;
}

/**
 * Power clamp P_max from the maximum net power (certificate field P.2): 0.9 × P.2.
 *
 * @param {object} p
 * @param {number} p.ratedKw  P.2 in kW
 * @returns {number} W
 */
export function maxPowerFromRated({ ratedKw }) {
  return ratedKw * 1000 * WHEEL_POWER_SHARE;
}

/**
 * Drag area from the body type. Unknown body type gives undefined.
 *
 * @param {object} p
 * @param {'hatchback'|'sedan'|'estate'|'suv'|'van'} p.body
 * @returns {number} m²
 */
export function dragAreaFromBody({ body }) {
  return CDA_BY_BODY[body];
}

/** Share of the maximum vehicle load added to the WLTP test mass: cars (category M) and vans/trucks (N). */
export const PAYLOAD_SHARE = { M: 0.15, N: 0.28 };

/** Fixed allowance added to the WLTP test mass (kg). */
export const TEST_MASS_ALLOWANCE = 25;

/**
 * Mass the WLTP test was run at (Regulation (EU) 2017/1151, Annex XXI, 3.2.24–3.2.26):
 * actual mass + 25 kg + share × maximum vehicle load, where
 * maximum vehicle load = maxLaden − actual mass − 25 kg, and the share is 15% (cars) or 28% (N).
 * G (mass in running order) already includes the 75 kg driver.
 *
 * @param {object} p
 * @param {number} p.g           certificate G, mass in running order (kg)
 * @param {number} p.maxLaden    certificate F.1, technically permissible maximum laden mass (kg)
 * @param {number} [p.optional]  fitted optional equipment (kg), default 0
 * @param {'M'|'N'} [p.category] 'M' for cars (default), 'N' for vans and trucks
 * @returns {number} kg
 */
export function testMass({ g, maxLaden, optional = 0, category = 'M' }) {
  const actual = g + optional;
  const maxLoad = maxLaden - actual - TEST_MASS_ALLOWANCE;
  return actual + TEST_MASS_ALLOWANCE + PAYLOAD_SHARE[category] * maxLoad;
}

/**
 * Simulate a speed profile with the model and total the fuel (Tier 2, step 4).
 * The profile is one speed per second (km/h). For each second the model runs on the interval's
 * mean speed and its acceleration (speed change over 1 s), on a flat road, A/C off, then
 * `fuelRate` gives L/h, which over 1 s is f / 3600 litres.
 *
 * @param {object} p
 * @param {number[]} p.speeds  speed trace in km/h, 1 Hz (n values give n − 1 seconds)
 * @param {number} p.m         mass (kg)
 * @param {number} p.cdA       drag area (m²)
 * @param {number} p.f0        idle fuel rate (L/h)
 * @param {number} p.k         fuel per kW (L/h per kW)
 * @param {number} p.pMax      power clamp (W)
 * @param {boolean} [p.startStop]
 * @param {number} [p.crr] @param {number} [p.lambda] @param {number} [p.rho]  as in `tractivePower`
 * @returns {{ litres: number, km: number, lPer100: number }}
 */
export function simulateCycle({ speeds, m, cdA, f0, k, pMax, startStop = false, crr, lambda, rho }) {
  let litres = 0;
  let metres = 0;
  for (let i = 1; i < speeds.length; i++) {
    const v0 = speeds[i - 1] / 3.6;
    const v1 = speeds[i] / 3.6;
    const v = (v0 + v1) / 2; // m/s, mean over the second
    const a = v1 - v0;       // m/s², over 1 s
    const p = tractivePower({ v, a, m, cdA, crr, lambda, rho });
    litres += fuelRate({ p, v, f0, k, pMax, startStop }) / 3600;
    metres += v;
  }
  const km = metres / 1000;
  return { litres, km, lPer100: (litres / km) * 100 };
}

/** Real-world factor applied to the official consumption before calibrating k (roadmap value, to check against drive logs). */
export const REAL_WORLD_FACTOR = 1.15;

/**
 * Solve for the fuel-per-kW constant k so that the simulated cycle burns exactly `target` L/100 km
 * (Tier 2, step 5). Fuel over the cycle is a straight line in k (section 13 of MODEL.md), so two runs
 * (k = 0 and k = 1) give the line and k comes out in one division.
 *
 * The caller decides the target: pass the official consumption (from V.7) to reproduce it, or
 * multiply it by `REAL_WORLD_FACTOR` first to calibrate for real driving.
 *
 * @param {object} p  `target` (L/100 km) plus everything `simulateCycle` takes except `k`
 * @returns {number|null} k in L/h per kW, or null when no positive k can reach the target
 *   (idle alone already burns more than the target, or the cycle never needs power)
 */
export function calibrateK({ target, ...cycle }) {
  const l0 = simulateCycle({ ...cycle, k: 0 }).lPer100;
  const l1 = simulateCycle({ ...cycle, k: 1 }).lPer100;
  const slope = l1 - l0;
  if (!(slope > 0)) return null;
  const k = (target - l0) / slope;
  return k > 0 ? k : null;
}

/**
 * How many days one typical tree needs to absorb `co2` kg: co2 / (kg per year) × 365.
 *
 * @param {object} p
 * @param {number} p.co2   CO₂ in kg
 * @param {number} [p.kgPerYear]  absorption of the tree (kg/year)
 * @returns {number} days
 */
export function treeDays({ co2, kgPerYear = TREE_KG_PER_YEAR }) {
  return (co2 / kgPerYear) * 365;
}

/**
 * Smoothing length for `smoothSlope`: the distance expected to be driven while `points` GPS
 * readings arrive, kept between `min` and `max` metres:
 *
 *   length = clamp(vAvg · points · dt, min, max)
 *
 * `vAvg` is the averaged speed and `dt` the averaged time between GPS readings, so the filter
 * always averages about the same number of readings, whatever the phone's update rate. It also
 * means the slope lags by about the same time at any speed: slow in town the length shrinks
 * (short hills are not flattened), on the motorway it grows (more altitude noise averaged out).
 * Defaults at 1 reading per second: 32 m at and below 8 m/s (about 29 km/h), 100 m at 25 m/s
 * (90 km/h), 150 m at and above 37.5 m/s (135 km/h). Without a usable speed or interval
 * (null, NaN, dt <= 0) it returns `fallback`, 100 m.
 *
 * @param {object} p
 * @param {number|null} p.vAvg  averaged speed (m/s)
 * @param {number|null} p.dt    averaged time between GPS readings (s)
 * @param {number} [p.points]   number of readings the filter should cover
 * @param {number} [p.min]      shortest length (m)
 * @param {number} [p.max]      longest length (m)
 * @param {number} [p.fallback] length when speed or interval is unknown (m)
 * @returns {number} length in metres
 */
export function slopeLength({ vAvg, dt, points = 4, min = 32, max = 150, fallback = 100 }) {
  const ok = (x) => typeof x === 'number' && x >= 0; // null >= 0 is true in JS, hence the typeof
  if (!ok(vAvg) || !ok(dt) || dt === 0) return fallback;
  return Math.max(min, Math.min(max, vAvg * points * dt));
}

/**
 * Classifies the altitude change between two consecutive GPS readings (MODEL.md section 17).
 *
 * Between two readings the road can rise or fall by at most `maxGrade` times the distance driven,
 * plus `noise` metres of GPS noise and rounding. A bigger change cannot be the road: it is the
 * GPS correcting itself (a first fix settling, or a stale altitude being replaced).
 *
 *   |alt − prevAlt| > maxGrade · step + noise   →  'jump'
 *   alt === prevAlt                             →  'same'  (no news: a stale altitude repeats exactly)
 *   otherwise                                   →  'move'  (a believable change: the altitude is alive)
 *   either altitude missing                     →  'none'
 *
 * A missing, negative or NaN `step` counts as 0 m (the strictest limit).
 *
 * @param {object} p
 * @param {number|null} p.prevAlt   altitude at the previous reading (m)
 * @param {number|null} p.alt       altitude at this reading (m)
 * @param {number} p.step           distance driven between the two readings (m)
 * @param {number} [p.maxGrade]     steepest road accepted, as rise over distance (same as slopeFromAltitude)
 * @param {number} [p.noise]        allowance for GPS noise and rounding (m)
 * @returns {'jump'|'same'|'move'|'none'}
 */
export function altitudeStep({ prevAlt, alt, step, maxGrade = 0.25, noise = 3 }) {
  const ok = (x) => typeof x === 'number' && !Number.isNaN(x);
  if (!ok(prevAlt) || !ok(alt)) return 'none';
  const dist = step > 0 ? step : 0; // also catches NaN and undefined
  const dh = Math.abs(alt - prevAlt);
  if (dh > maxGrade * dist + noise) return 'jump';
  return dh === 0 ? 'same' : 'move';
}
