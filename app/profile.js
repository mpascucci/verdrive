// profile.js — Tier 2 (Advanced): certificate fields in, model parameters out. Pure: no DOM, no storage.
// The physics is in model.js; this file only chains it: fields -> checks -> parameters -> calibrated k.
import {
  testMass, TEST_MASS_ALLOWANCE, idleFromDisplacement, maxPowerFromRated, dragAreaFromBody,
  consumptionFromCo2, calibrateK, simulateCycle, REAL_WORLD_FACTOR,
} from './model.js';
import { WLTC3B_KMH } from './wltc.js';

/** Accepted range [min, max] and unit for each typed field. Outside it the value is almost surely a typo. */
export const FIELD_LIMITS = {
  g:            { min: 500, max: 4000, unit: 'kg',    name: 'G (mass in running order)' },
  g1:           { min: 425, max: 3925, unit: 'kg',    name: 'G.1 (empty mass)' },
  maxLaden:     { min: 600, max: 8000, unit: 'kg',    name: 'F.1 or F.2 (maximum laden mass)' },
  displacement: { min: 400, max: 8500, unit: 'cm³',   name: 'P.1 (engine capacity)' },
  ratedKw:      { min: 5,   max: 800,  unit: 'kW',    name: 'P.2 (maximum power)' },
  co2:          { min: 20,  max: 600,  unit: 'g/km',  name: 'V.7 (CO₂)' },
  average:      { min: 1,   max: 40,   unit: 'L/100 km', name: 'Average consumption' },
};
/** Limits for the motorcycle form (scooters and motorcycles): lighter and less powerful than cars. */
export const MOTO_LIMITS = {
  g:        { min: 40,  max: 600, unit: 'kg', name: 'G (mass in running order)' },
  g1:       { min: 40,  max: 600, unit: 'kg', name: 'G.1 (empty mass)' },
  ratedKw:  { min: 1,   max: 250, unit: 'kW', name: 'P.2 (maximum power)' },
  maxLaden: { min: 180, max: 900, unit: 'kg', name: 'F.2 (maximum laden mass)' },
};
/** The rider (75 kg). For L-category vehicles the mass in running order excludes the driver (Regulation (EU) 168/2013, Art. 5). */
export const RIDER_MASS = 75;
/** The passenger (65 kg), also excluded from the mass in running order of L-category vehicles (Art. 5). */
export const PASSENGER_MASS = 65;
/** Fields that must be typed. G is optional (blank: the vehicle type's typical mass is used) and so is the laden mass (blank: no payload share). */
export const REQUIRED = ['displacement', 'ratedKw'];
const F_MISSING = 'No laden mass (F.1 or F.2) given: the WLTP test mass is the vehicle mass + 25 kg, without the payload share.';
const F_ESTIMATE = (mass) => `G not given: mass with rider estimated from the laden mass (${Math.round(mass)} kg). It is rough and a little high, because the laden mass includes the manufacturer's luggage allowance.`;
/** G.1 is the empty mass: G (mass in running order, driver included) minus the conventional 75 kg driver. */
/** G and G.1 should differ by the 75 kg driver; a few kilograms of rounding are accepted. */
export const COHERENCE_TOLERANCE = 5;
const G_AGREE = (mass) => `G and G.1 agree (75 kg apart). Mass ${Math.round(mass)} kg.`;
const G1_NOTE = (mass) => `Mass from G.1 (empty mass) + 75 kg driver: ${Math.round(mass)} kg.`;
const G_MISSING = (mass) => `G not given: the typical mass of this vehicle type (${Math.round(mass)} kg) is used.`;
export const BODY_LABELS = { hatchback: 'Hatchback', sedan: 'Sedan', estate: 'Estate', suv: 'SUV', van: 'Van' };

/** Typed text or number to a number; empty, blank or junk gives null. */
function num(x) {
  if (x === null || x === undefined || String(x).trim() === '') return null;
  const n = Number(String(x).replace(',', '.'));
  return Number.isFinite(n) ? n : null;
}

/**
 * Check the user's own average consumption (L/100 km, optional). Blank is fine and gives `value: null`.
 *
 * @param {string|number|null} x
 * @returns {{ value: number|null, error: string }}  `error` is empty when the value can be used
 */
export function checkAverage(x) {
  const value = num(x);
  const { min, max, unit, name } = FIELD_LIMITS.average;
  if (value === null) {
    const typed = x !== null && x !== undefined && String(x).trim() !== '';
    return { value: null, error: typed ? `${name} should be a number between ${min} and ${max} ${unit}.` : '' };
  }
  if (value < min || value > max) return { value, error: `${name} should be between ${min} and ${max} ${unit}.` };
  return { value, error: '' };
}

/**
 * Average consumption from the fuel used and the distance covered: litres ÷ km × 100, rounded to 0.01.
 * Used by the calculator dialog. Blank gives `value: null` and no error; a bad or out-of-range result
 * gives an error message.
 *
 * @param {object} p
 * @param {string|number|null} p.litres  fuel used (L)
 * @param {string|number|null} p.km      distance covered (km)
 * @returns {{ value: number|null, error: string }}
 */
export function averageFromFuel({ litres, km }) {
  const l = num(litres);
  const d = num(km);
  if (l === null || d === null) return { value: null, error: '' };
  if (!(l > 0) || !(d > 0)) return { value: null, error: 'Both values must be above zero.' };
  const value = Math.round((l / d) * 10000) / 100;
  const { error } = checkAverage(value);
  return error ? { value: null, error: `${value} L/100 km looks wrong. ${error}` } : { value, error: '' };
}

/**
 * The user's own average consumption sets k. The model is run over the WLTC speed trace, used here as a
 * generic mix of town, road and motorway, and k is solved so the simulated consumption equals `average`.
 * No real-world factor: a real average already is real driving.
 *
 * @param {object} p  `average` (L/100 km), `m`, `cdA`, `f0`, `pMax`, optional `startStop`
 * @returns {number|null} k in L/h per kW, or null when no positive k reaches the average
 */
export function kFromAverage({ average, ...car }) {
  return calibrateK({ target: average, speeds: WLTC3B_KMH, ...car });
}

/**
 * Check the typed fields. Returns `{ values, errors }`: numbers (or null) for each field, and a message
 * per field that is missing or out of range. No errors means the values can be used.
 *
 * The vehicle mass is G.1 + 75 kg, else G, else `presetMass` (the typical mass of the vehicle type); without any of
 * them, G is needed.
 *
 * @param {object} raw  g, maxLaden, displacement, ratedKw, body, startStop, co2
 * @param {number|null} [presetMass]  typical mass of the vehicle type (kg), used when G is blank
 */
export function checkAdvanced(raw, presetMass = null) {
  const values = {
    g: num(raw.g), g1: num(raw.g1), maxLaden: num(raw.maxLaden), displacement: num(raw.displacement),
    ratedKw: num(raw.ratedKw), co2: num(raw.co2),
    body: raw.body, startStop: Boolean(raw.startStop),
  };
  const errors = {};
  for (const key of Object.keys(FIELD_LIMITS)) {
    const { min, max, unit, name } = FIELD_LIMITS[key];
    const v = values[key];
    if (v === null) {
      if (REQUIRED.includes(key) || (key === 'g' && presetMass === null && values.g1 === null)) errors[key] = `${name} is needed.`;
    } else if (v < min || v > max) {
      errors[key] = `${name} should be between ${min} and ${max} ${unit}.`;
    }
  }
  if (!(raw.body in BODY_LABELS)) errors.body = 'Choose a body type.';
  // Both typed: G is G.1 plus the 75 kg driver, so a different gap means a typo in one of them.
  if (!errors.g && !errors.g1 && values.g !== null && values.g1 !== null
      && Math.abs(values.g - values.g1 - RIDER_MASS) > COHERENCE_TOLERANCE) {
    errors.g1 = `G minus G.1 is ${Math.round(values.g - values.g1)} kg, but the driver is ${RIDER_MASS} kg. Check both values, or leave one blank.`;
  }
  const gUsed = values.g1 !== null ? values.g1 + RIDER_MASS : (values.g ?? presetMass);
  if (!errors.g && !errors.maxLaden && values.maxLaden !== null && gUsed !== null && values.maxLaden <= gUsed) {
    errors.maxLaden = 'The maximum laden mass (F.1 or F.2) must be above the vehicle mass.';
  }
  return { values, errors };
}

/**
 * Check the motorcycle form: P.2 is required; G is optional (blank: estimated from the laden mass F, else the preset mass); all within `MOTO_LIMITS`.
 *
 * @param {object} raw  g, ratedKw, maxLaden
 * @param {number|null} [presetMass]  typical mass of the vehicle type with rider (kg), used when G and F are blank
 * @returns {{ values: object, errors: object }}
 */
export function checkMoto(raw, presetMass = null) {
  const values = { g: num(raw.g), g1: num(raw.g1), ratedKw: num(raw.ratedKw), maxLaden: num(raw.maxLaden) };
  const errors = {};
  for (const key of Object.keys(MOTO_LIMITS)) {
    const { min, max, unit, name } = MOTO_LIMITS[key];
    if (values[key] === null) {
      // P.2 is needed. G is needed only if there is neither a laden mass nor a preset mass; the laden mass is optional.
      if (key === 'ratedKw' || (key === 'g' && values.g1 === null && values.maxLaden === null && presetMass === null)) errors[key] = `${name} is needed.`;
    }
    else if (values[key] < min || values[key] > max) errors[key] = `${name} should be between ${min} and ${max} ${unit}.`;
  }
  return { values, errors };
}

/**
 * Parameters for a scooter or motorcycle from its certificate (G and P.2).
 * - mass = G + 75 kg rider (G excludes the driver for L-category vehicles); without G, the laden mass F gives
 *   F − 65 kg (F − 75 − 65 for the running-order mass, plus the rider back); without either, the preset mass;
 * - power clamp = 0.9 × P.2;
 * - drag area and idle fuel stay at the vehicle preset (`preset.cdA`, `preset.f0`): the engine capacity is not
 *   used because idle fuel does not scale with it for small engines;
 * - k comes from the user's own average consumption when given, else stays at the Quick value.
 *
 * @param {object} p
 * @param {object} p.raw       g, ratedKw
 * @param {{cdA:number, f0:number}} p.preset  the vehicle preset
 * @param {number} p.tier1K    Quick k (fallback)
 * @param {number|null} [p.average]  the user's own average (L/100 km), already checked
 * @param {number|null} [p.presetMass]  typical mass of the vehicle type, rider included (kg); used when G is blank
 * @returns {{ errors: object } | { profile: object }}
 */
export function buildAdvancedMoto({ raw, preset, tier1K, average = null, presetMass = null }) {
  const { values, errors } = checkMoto(raw, presetMass);
  if (Object.keys(errors).length) return { errors };
  // Mass with the rider, from the best information available:
  // 0. G.1 typed (empty mass, without the driver): G.1 + 75 kg rider.
  // 1. Else G typed: G + 75 kg rider (the regulation excludes the rider from the L-category running-order mass).
  // 2. Else the laden mass F: the running-order mass is about F − (75 + 65) kg (driver and passenger are excluded
  //    from it, Art. 5 of Regulation 168/2013), so with the rider back in it is F − 65. It still contains the
  //    manufacturer's luggage allowance, so it is a little high.
  // 3. Else the preset mass of the vehicle type (rider included).
  let m;
  let massNote = '';
  if (values.g1 !== null) { m = values.g1 + RIDER_MASS; massNote = G1_NOTE(m); }
  else if (values.g !== null) m = values.g + RIDER_MASS;
  else if (values.maxLaden !== null) { m = values.maxLaden - PASSENGER_MASS; massNote = F_ESTIMATE(m); }
  else { m = presetMass; massNote = G_MISSING(m); }
  const pMax = maxPowerFromRated({ ratedKw: values.ratedKw });
  const car = { m, cdA: preset.cdA, f0: preset.f0, pMax };
  let k = tier1K;
  let kSource = 'tier1';
  let note = 'Enter your average consumption (Calc button in the car settings) to tune the fuel use to your bike.';
  if (average !== null) {
    const solved = kFromAverage({ average, ...car });
    if (solved === null) note = 'The average is too low for this idle rate: k keeps its Quick value.';
    else { k = solved; kSource = 'average'; note = ''; }
  }
  return {
    profile: { ...car, k, kSource, startStop: false, official: kSource === 'average' ? average : null, testMass: m, category: 'M', note: [massNote, note].filter(Boolean).join(' ') },
  };
}

/**
 * Build the Tier 2 parameters from the typed fields.
 *
 * `k` is calibrated on the WLTP cycle. The target is, in order of preference: the user's own average
 * consumption (`average`, used as it is), or the official consumption from V.7 × 1.15. With neither,
 * or if the figures cannot be matched, `k` stays at the Tier 1 value for the fuel.
 *
 * @param {object} p
 * @param {object} p.raw      the typed fields (see `checkAdvanced`)
 * @param {'gasoline'|'diesel'|'lpg'} p.fuel
 * @param {number} p.tier1K   the Tier 1 k for that fuel (fallback)
 * @param {number|null} [p.average]  the user's own average consumption (L/100 km), already checked
 * @param {number|null} [p.presetMass]  typical mass of the vehicle type, driver included (kg); used when G is blank
 * @returns {{ errors: object } | { profile: object }}
 */
export function buildAdvanced({ raw, fuel, tier1K, average = null, presetMass = null }) {
  const { values, errors } = checkAdvanced(raw, presetMass);
  if (Object.keys(errors).length) return { errors };

  const cdA = dragAreaFromBody({ body: values.body });
  const f0 = idleFromDisplacement({ displacement: values.displacement });
  const pMax = maxPowerFromRated({ ratedKw: values.ratedKw });
  const category = values.body === 'van' ? 'N' : 'M';
  // Vehicle mass with the driver: G.1 + 75 kg driver (preferred), else G, else the preset mass (which includes the driver, like G).
  const gGiven = values.g !== null || values.g1 !== null;
  const g = values.g1 !== null ? values.g1 + RIDER_MASS : (values.g ?? presetMass);
  // Without a laden mass there is no spare load to take a share of: the payload share is 0 (test mass = mass + 25 kg).
  const maxLaden = values.maxLaden ?? g + TEST_MASS_ALLOWANCE;
  const mTest = testMass({ g, maxLaden, category });

  let official = null;
  let kSource = 'tier1';
  let target = null;
  if (average !== null) { official = average; target = average; kSource = 'average'; }
  else if (values.co2 !== null) {
    official = consumptionFromCo2({ co2: values.co2, fuel });
    target = official * REAL_WORLD_FACTOR;
    kSource = 'v7';
  }

  let k = tier1K;
  let note = target === null ? 'No consumption figure given: the fuel constant k keeps its Quick value.' : '';
  if (target !== null) {
    const solved = calibrateK({
      target, speeds: WLTC3B_KMH,
      m: mTest, cdA, f0, pMax, startStop: values.startStop,
    });
    if (solved === null) {
      kSource = 'tier1';
      note = 'The consumption figure is too low for this idle rate: k keeps its Quick value. Check P.1, V.7 and your average.';
    } else {
      k = solved;
      if (k < 0.15 || k > 0.8) note = 'The calibrated k is unusual. Check the figures against the certificate.';
    }
  }

  return {
    profile: {
      m: g, cdA, f0, pMax, k, kSource, startStop: values.startStop,
      official, testMass: mTest, category, note: [gGiven ? (values.g1 !== null ? (values.g !== null ? G_AGREE(g) : G1_NOTE(g)) : '') : G_MISSING(g), values.maxLaden === null ? F_MISSING : '', note].filter(Boolean).join(' '),
    },
  };
}

/** What the model burns on the WLTP cycle with a profile (L/100 km). Used to show the check on screen. */
export function simulatedWltp(profile) {
  return simulateCycle({
    speeds: WLTC3B_KMH, m: profile.testMass, cdA: profile.cdA, f0: profile.f0,
    k: profile.k, pMax: profile.pMax, startStop: profile.startStop,
  }).lPer100;
}
