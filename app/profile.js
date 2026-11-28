// profile.js — Tier 2 (Advanced): certificate fields in, model parameters out. Pure: no DOM, no storage.
// The physics is in model.js; this file only chains it: fields -> checks -> parameters -> calibrated k.
import {
  testMass, TEST_MASS_ALLOWANCE, idleFromDisplacement, maxPowerFromRated, dragAreaFromBody,
  consumptionFromCo2, calibrateK, simulateCycle, REAL_WORLD_FACTOR,
} from './model.js';
import { WLTC3B_KMH } from './wltc.js';
import { t, nf, parseDecimal, numText } from './i18n.js';

/**
 * Litres of LPG burned per litre of gasoline for the same work: ~1.2 (energy ratio about 32 / 26 MJ/L,
 * real-world +15–25%). Same ratio as the Quick values in app.js (k 0.54 / 0.45). Used to turn the V.7
 * figure, read as gasoline, into LPG litres.
 */
export const LPG_PER_GASOLINE = 1.2;

/** Accepted range [min, max] and unit for each typed field. Outside it the value is almost surely a typo. */
export const FIELD_LIMITS = {
  g:            { min: 500, max: 4000, unit: 'kg',    name: 'field.g' },
  g1:           { min: 425, max: 3925, unit: 'kg',    name: 'field.g1' },
  maxLaden:     { min: 600, max: 8000, unit: 'kg',    name: 'field.maxLaden' },
  displacement: { min: 400, max: 8500, unit: 'cm³',   name: 'field.displacement' },
  ratedKw:      { min: 5,   max: 800,  unit: 'kW',    name: 'field.ratedKw' },
  co2:          { min: 20,  max: 600,  unit: 'g/km',  name: 'field.co2' },
  average:      { min: 1,   max: 40,   unit: 'L/100 km', name: 'field.average' },
  cda:          { min: 0.3, max: 2.5,  unit: 'm²',    name: 'field.cda' },
};
/** Limits for the motorcycle form (scooters and motorcycles): lighter and less powerful than cars. */
export const MOTO_LIMITS = {
  g:        { min: 40,  max: 600, unit: 'kg', name: 'field.g' },
  g1:       { min: 40,  max: 600, unit: 'kg', name: 'field.g1' },
  ratedKw:  { min: 1,   max: 250, unit: 'kW', name: 'field.ratedKw' },
  maxLaden: { min: 180, max: 900, unit: 'kg', name: 'field.maxLadenMoto' },
  cda:      { min: 0.15, max: 1.2, unit: 'm²', name: 'field.cda' },
};
/** The rider (75 kg). For L-category vehicles the mass in running order excludes the driver (Regulation (EU) 168/2013, Art. 5). */
export const RIDER_MASS = 75;
/** The passenger (65 kg), also excluded from the mass in running order of L-category vehicles (Art. 5). */
export const PASSENGER_MASS = 65;
/** Fields that must be typed. G is optional (blank: the vehicle type's typical mass is used) and so is the laden mass (blank: no payload share). */
export const REQUIRED = ['displacement', 'ratedKw'];
const F_MISSING = () => t('note.fMissing');
const F_ESTIMATE = (mass) => t('note.fEstimate', { m: Math.round(mass) });
/** G.1 is the empty mass: G (mass in running order, driver included) minus the conventional 75 kg driver. */
/** G and G.1 should differ by the 75 kg driver; a few kilograms of rounding are accepted. */
export const COHERENCE_TOLERANCE = 5;
const G_AGREE = (mass) => t('note.gAgree', { m: Math.round(mass) });
const G1_NOTE = (mass) => t('note.g1', { m: Math.round(mass) });
const G_MISSING = (mass) => t('note.gMissing', { m: Math.round(mass) });
const CDA_NOTE = (cdA) => t('note.cda', { v: nf(cdA, 2) });
export const BODY_LABELS = { hatchback: 'Hatchback', sedan: 'Sedan', estate: 'Estate', mpv: 'MPV', suv: 'SUV', van: 'Van' };

/** Typed text or number to a number: "." or "," as decimal separator; blank gives null, junk gives NaN. */
const num = parseDecimal;
/** The range of a field for a message, with the language's decimal separator. */
const rangeVars = ({ min, max, unit }, name) => ({ name, min: numText(min), max: numText(max), unit });

/**
 * Check the user's own average consumption (L/100 km, optional). Blank is fine and gives `value: null`.
 *
 * @param {string|number|null} x
 * @returns {{ value: number|null, error: string }}  `error` is empty when the value can be used
 */
export function checkAverage(x) {
  const value = num(x);
  const { min, max } = FIELD_LIMITS.average;
  const vars = rangeVars(FIELD_LIMITS.average, t(FIELD_LIMITS.average.name));
  if (value === null) return { value: null, error: '' };
  if (Number.isNaN(value)) return { value: null, error: t('err.numberRange', vars) };
  if (value < min || value > max) return { value, error: t('err.range', vars) };
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
  if (Number.isNaN(l) || Number.isNaN(d)) return { value: null, error: t('err.notNumber') };
  if (l === null || d === null) return { value: null, error: '' };
  if (!(l > 0) || !(d > 0)) return { value: null, error: t('err.aboveZero') };
  const value = Math.round((l / d) * 10000) / 100;
  const { error } = checkAverage(value);
  return error ? { value: null, error: t('err.avgWrong', { v: value, err: error }) } : { value, error: '' };
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
 * @param {object} raw  g, maxLaden, displacement, ratedKw, body, startStop, co2, cda (optional drag area, m²)
 * @param {number|null} [presetMass]  typical mass of the vehicle type (kg), used when G is blank
 */
export function checkAdvanced(raw, presetMass = null) {
  const values = {
    g: num(raw.g), g1: num(raw.g1), maxLaden: num(raw.maxLaden), displacement: num(raw.displacement),
    ratedKw: num(raw.ratedKw), co2: num(raw.co2), cda: num(raw.cda),
    body: raw.body, startStop: Boolean(raw.startStop),
  };
  const errors = {};
  for (const key of Object.keys(FIELD_LIMITS)) {
    const { min, max } = FIELD_LIMITS[key];
    const name = t(FIELD_LIMITS[key].name);
    const v = values[key];
    if (v === null) {
      if (REQUIRED.includes(key) || (key === 'g' && presetMass === null && values.g1 === null)) errors[key] = t('err.needed', { name });
    } else if (Number.isNaN(v)) {
      errors[key] = t('err.numberRange', rangeVars(FIELD_LIMITS[key], name));
    } else if (v < min || v > max) {
      errors[key] = t('err.range', rangeVars(FIELD_LIMITS[key], name));
    }
  }
  if (!(raw.body in BODY_LABELS)) errors.body = t('err.body');
  // Both typed: G is G.1 plus the 75 kg driver, so a different gap means a typo in one of them.
  if (!errors.g && !errors.g1 && values.g !== null && values.g1 !== null
      && Math.abs(values.g - values.g1 - RIDER_MASS) > COHERENCE_TOLERANCE) {
    errors.g1 = t('err.gMinusG1', { d: Math.round(values.g - values.g1), r: RIDER_MASS });
  }
  const gUsed = values.g1 !== null ? values.g1 + RIDER_MASS : (values.g ?? presetMass);
  if (!errors.g && !errors.maxLaden && values.maxLaden !== null && gUsed !== null && values.maxLaden <= gUsed) {
    errors.maxLaden = t('err.laden');
  }
  return { values, errors };
}

/**
 * Check the motorcycle form: P.2 is required; G is optional (blank: estimated from the laden mass F, else the preset mass); all within `MOTO_LIMITS`.
 *
 * @param {object} raw  g, ratedKw, maxLaden, cda (optional drag area, m²)
 * @param {number|null} [presetMass]  typical mass of the vehicle type with rider (kg), used when G and F are blank
 * @returns {{ values: object, errors: object }}
 */
export function checkMoto(raw, presetMass = null) {
  const values = { g: num(raw.g), g1: num(raw.g1), ratedKw: num(raw.ratedKw), maxLaden: num(raw.maxLaden), cda: num(raw.cda) };
  const errors = {};
  for (const key of Object.keys(MOTO_LIMITS)) {
    const { min, max } = MOTO_LIMITS[key];
    const name = t(MOTO_LIMITS[key].name);
    if (values[key] === null) {
      // P.2 is needed. G is needed only if there is neither a laden mass nor a preset mass; the laden mass is optional.
      if (key === 'ratedKw' || (key === 'g' && values.g1 === null && values.maxLaden === null && presetMass === null)) errors[key] = t('err.needed', { name });
    }
    else if (Number.isNaN(values[key])) errors[key] = t('err.numberRange', rangeVars(MOTO_LIMITS[key], name));
    else if (values[key] < min || values[key] > max) errors[key] = t('err.range', rangeVars(MOTO_LIMITS[key], name));
  }
  return { values, errors };
}

/**
 * Parameters for a scooter or motorcycle from its certificate (G and P.2).
 * - mass = G + 75 kg rider (G excludes the driver for L-category vehicles); without G, the laden mass F gives
 *   F − 65 kg (F − 75 − 65 for the running-order mass, plus the rider back); without either, the preset mass;
 * - power clamp = 0.9 × P.2;
 * - drag area: the typed CdA if given, else the vehicle preset (`preset.cdA`);
 * - idle fuel stays at the vehicle preset (`preset.f0`): the engine capacity is not used because idle fuel
 *   does not scale with it for small engines;
 * - k comes from the user's own average consumption when given, else stays at the Quick value.
 *
 * @param {object} p
 * @param {object} p.raw       g, ratedKw, cda
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
  const cdA = values.cda ?? preset.cdA;
  const car = { m, cdA, f0: preset.f0, pMax };
  let k = tier1K;
  let kSource = 'tier1';
  let note = t('note.motoAverage');
  if (average !== null) {
    const solved = kFromAverage({ average, ...car });
    if (solved === null) note = t('note.motoLow');
    else { k = solved; kSource = 'average'; note = ''; }
  }
  return {
    profile: { ...car, k, kSource, startStop: false, official: kSource === 'average' ? average : null, testMass: m, category: 'M', note: [massNote, values.cda !== null ? CDA_NOTE(cdA) : '', note].filter(Boolean).join(' ') },
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

  // Drag area: the typed CdA (from the maker or the web) when given, else the typical value for the body type.
  const cdA = values.cda ?? dragAreaFromBody({ body: values.body });
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
    // A bi-fuel LPG car has one V.7 and we cannot tell which fuel it was measured on: read it as the
    // gasoline figure, then convert to LPG litres (decision 2026-11-26, see LPG_PER_GASOLINE).
    official = fuel === 'lpg'
      ? consumptionFromCo2({ co2: values.co2, fuel: 'gasoline' }) * LPG_PER_GASOLINE
      : consumptionFromCo2({ co2: values.co2, fuel });
    target = official * REAL_WORLD_FACTOR;
    kSource = 'v7';
  }

  let k = tier1K;
  let note = target === null ? t('note.noFigure') : '';
  if (target !== null) {
    const solved = calibrateK({
      target, speeds: WLTC3B_KMH,
      m: mTest, cdA, f0, pMax, startStop: values.startStop,
    });
    if (solved === null) {
      kSource = 'tier1';
      note = t('note.tooLow');
    } else {
      k = solved;
      if (k < 0.15 || k > 0.8) note = t('note.unusualK');
    }
  }

  return {
    profile: {
      m: g, cdA, f0, pMax, k, kSource, startStop: values.startStop,
      official, testMass: mTest, category, note: [gGiven ? (values.g1 !== null ? (values.g !== null ? G_AGREE(g) : G1_NOTE(g)) : '') : G_MISSING(g), values.maxLaden === null ? F_MISSING() : '', values.cda !== null ? CDA_NOTE(cdA) : '', note].filter(Boolean).join(' '),
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
