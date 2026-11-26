// app.js — interface: screens, settings storage, the trip pipeline, wake lock. GPS is in gps.js, the
// trip log in triplog.js, updates in update.js,
// all the physics in model.js.
import {
  tractivePower, fuelRate, smooth, toCost,
  slopeFromAltitude, smoothSlope, slopeLength, altitudeStep, co2FromFuel, treeDays, CO2_PER_LITRE, TREE_KG_PER_YEAR,
} from './model.js';
import { startGps, stopGps } from './gps.js';
import { startUpdates, reloadIfUpdateWaiting } from './update.js';
import { buildAdvanced, buildAdvancedMoto, simulatedWltp, checkAverage, kFromAverage, averageFromFuel } from './profile.js';
import { normalizeStore, settingsFor, activeSettings, saveVehicle, setActive, recentVehicles } from './vehicles.js';
import { startLog, stopLog, logAdd, logActive, hasSavedLogs, exportLatestLog } from './triplog.js';

// ---------- Tier 1 presets (gasoline), from ROADMAP.md ----------
const PRESETS = {
  city:  { label: 'City car', m: 1100, cdA: 0.60, f0: 0.6, pAc: 1000 },
  sedan: { label: 'Sedan',    m: 1500, cdA: 0.65, f0: 0.8, pAc: 1500 },
  suv:   { label: 'SUV',      m: 2000, cdA: 0.90, f0: 1.0, pAc: 2000 },
  van:   { label: 'Van',      m: 2500, cdA: 1.10, f0: 1.2, pAc: 2000 },
  scooter: { label: 'Scooter', m: 175, cdA: 0.40, f0: 0.25, pAc: 0, gasolineOnly: true },
  moto:    { label: 'Motorcycle', m: 300, cdA: 0.35, f0: 0.4, pAc: 0, gasolineOnly: true },
};
const FUELS = {
  gasoline: { label: 'Gasoline', k: 0.45 },
  diesel:   { label: 'Diesel',   k: 0.33 },
  lpg:      { label: 'LPG (GPL)', k: 0.54 }, // ~20% more litres than gasoline (energy ratio 32 / 26; real-world +15–25%)
};
const P_MAX = 150000;          // W, clamp against GPS spikes (Tier 1 default)
const KG_PER_PERSON = 75;      // presets include the driver; each extra person adds this
// GPS accuracy bands (first drive: ±5 m reached 16 s after the first fix, then held for the whole drive)
const GOOD_ACCURACY = 5;       // m: up to this, green: live display, altitude used for the slope
const POOR_ACCURACY = 20;      // m: up to this, amber: display held (grey), totals go on from the speed,
                               //    altitude not used; above it, red: display held, totals stop
const MAX_GAP = 5;             // s: a longer pause between samples is treated as a gap
const MAX_ACCEL = 6;           // m/s²: clamp on GPS-derived acceleration
const CRUISE_SPEED = 90 / 3.6; // m/s: reference speed for the scale
const DT_TAU = 10;             // s: smoothing of the time between GPS readings
const SLOPE_MIN_SPEED = 3 / 3.6; // m/s: below this every altitude reading restarts the slope window
const ALT_DISPLAY_TAU = 5;     // s: smoothing of the altitude shown (display only, the slope has its own filter)

const $ = (id) => document.getElementById(id);
const screens = ['settings', 'advanced', 'setup', 'trip', 'summary'];
function show(name) {
  for (const s of screens) $(`screen-${s}`).hidden = s !== name;
  $('version').hidden = name === 'trip'; // keep the trip screen clean
  if (name === 'setup') ensureGps();      // warm the GPS up while the trip is being set up
  else if (name !== 'trip') endGps();
  window.scrollTo(0, 0);
}

// ---------- storage (localStorage for now; IndexedDB comes with profiles) ----------
// One entry per vehicle type (see vehicles.js): each keeps its own fuel, price, average and certificate fields.
// `settings` is the flat view of the active vehicle, the one the app opens with.
const KEY = 'fuelprice.settings';
const STORE_RULES = {
  vehicles: Object.keys(PRESETS),
  fuels: Object.keys(FUELS),
  gasolineOnly: (id) => Boolean(PRESETS[id]?.gasolineOnly),
};
function loadStore() {
  try { return normalizeStore(JSON.parse(localStorage.getItem(KEY)), STORE_RULES); }
  catch { return null; } // storage blocked or corrupt: behave as first run
}
let store = loadStore();
function persistStore() {
  try { localStorage.setItem(KEY, JSON.stringify(store)); } catch { /* keep in memory only */ }
}
function saveSettings(s) {
  store = saveVehicle(store, s);
  persistStore();
}

let settings = activeSettings(store);
// Scooters and motorcycles have no air conditioning: its switches are hidden for them.
const hasNoAc = () => Boolean(PRESETS[settings.vehicle]?.gasolineOnly);

// ---------- advanced (Tier 2) profile ----------
// The typed certificate fields live in settings.advanced. The parameters are recomputed from them whenever the
// settings change, so a different fuel gives a new calibrated k. null means Quick (Tier 1) settings.
let advanced = null;
// Scooters and motorcycles have their own, shorter form (G and P.2); cars and vans use the full certificate form.
const isMoto = () => Boolean(PRESETS[settings.vehicle]?.gasolineOnly);
function buildProfile(raw, average) {
  const tier1K = FUELS[settings.fuel].k;
  const presetMass = PRESETS[settings.vehicle].m; // used when G is left blank (includes the driver or rider)
  return isMoto()
    ? buildAdvancedMoto({ raw, preset: PRESETS[settings.vehicle], tier1K, average, presetMass })
    : buildAdvanced({ raw, fuel: settings.fuel, tier1K, average, presetMass });
}
let quickK = null; // k from the user's own average consumption, when there is no advanced profile
function refreshAdvanced() {
  advanced = null;
  quickK = null;
  if (!settings) return;
  const average = checkAverage(settings.average);
  const avg = average.error ? null : average.value; // a stored bad value is ignored
  if (settings.advanced) {
    const r = buildProfile(settings.advanced, avg);
    if (r.profile) { advanced = r.profile; return; }
  }
  if (avg !== null) {
    const p = PRESETS[settings.vehicle];
    quickK = kFromAverage({ average: avg, m: p.m, cdA: p.cdA, f0: p.f0, pMax: P_MAX });
  }
}
refreshAdvanced();
const setup = { passengers: 1, ac: false, cold: true, log: true };

// ---------- settings screen ----------
const form = $('settings-form');
// Motorcycles and scooters have no diesel or LPG option: disable them and fall back to gasoline.
function syncFuelChoices() {
  const gasOnly = Boolean(PRESETS[form.vehicle.value]?.gasolineOnly);
  for (const id of ['diesel', 'lpg']) {
    const input = form.querySelector(`input[name="fuel"][value="${id}"]`);
    input.disabled = gasOnly;
    input.closest('label').classList.toggle('disabled', gasOnly);
  }
  if (gasOnly) form.fuel.value = 'gasoline';
  // The first run asks for the three basic answers only; the optional average appears from the second visit.
  $('average-field').hidden = !settings;
}
// Choosing another vehicle shows what was saved for it. A vehicle never saved keeps the fuel and price on screen
// (likely the same) and starts without an average, which belongs to one vehicle.
form.querySelectorAll('input[name="vehicle"]').forEach((r) => r.addEventListener('change', () => {
  const saved = settingsFor(store, form.vehicle.value);
  if (saved) { form.fuel.value = saved.fuel; form.price.value = saved.price; form.average.value = saved.average ?? ''; }
  else form.average.value = '';
  $('average-err').textContent = '';
  syncFuelChoices();
}));
function fillForm() {
  if (!settings) return;
  form.vehicle.value = settings.vehicle;
  form.fuel.value = settings.fuel;
  form.price.value = settings.price;
  form.average.value = settings.average ?? '';
  $('average-err').textContent = '';
  syncFuelChoices();
}
// Opening the advanced settings first saves, silently, whatever the basic form already holds: the vehicle (a sedan
// if none was chosen), the fuel (gasoline if none), the price (the saved one, else DEFAULT_PRICE) and the average
// (only if valid and reachable). The certificate fields are stored for this vehicle, so it has to exist.
const DEFAULT_PRICE = 1.8; // EUR per litre, used only when no price was typed or saved: visible in the recap, easy to change
function commitBasics() {
  const vehicle = form.vehicle.value || settings?.vehicle || 'sedan';
  form.vehicle.value = vehicle;
  const saved = settingsFor(store, vehicle);
  const fuel = PRESETS[vehicle].gasolineOnly ? 'gasoline' : (form.fuel.value || saved?.fuel || 'gasoline');
  const typed = Number(form.price.value);
  const price = typed > 0 ? typed : (saved?.price ?? settings?.price ?? DEFAULT_PRICE);
  const next = { vehicle, fuel, price, advanced: saved?.advanced };
  const average = checkAverage(form.average.value);
  if (average.value !== null && !average.error) next.average = average.value;
  settings = next;
  refreshAdvanced();
  if (next.average !== undefined && (advanced ? advanced.kSource !== 'average' : quickK === null)) {
    delete next.average; // an average this vehicle cannot reach is left out
    refreshAdvanced();
  }
  saveSettings(settings);
  form.fuel.value = fuel;
  form.price.value = price;
  syncFuelChoices();
}

form.addEventListener('submit', (e) => {
  e.preventDefault();
  const average = checkAverage(form.average.value);
  const next = { vehicle: form.vehicle.value, fuel: form.fuel.value, price: Number(form.price.value), advanced: settingsFor(store, form.vehicle.value)?.advanced };
  if (average.value !== null && !average.error) next.average = average.value;
  const previous = settings;
  settings = next;
  refreshAdvanced();
  // An average the vehicle cannot reach (below its idle fuel) is refused, so the user knows it was not applied.
  const unreachable = next.average !== undefined && (advanced ? advanced.kSource !== 'average' : quickK === null);
  $('average-err').textContent = average.error || (unreachable ? 'This average is too low for this vehicle: it cannot be reached.' : '');
  if ($('average-err').textContent) { settings = previous; refreshAdvanced(); return; }
  saveSettings(settings);
  showSetup();
});
$('settings-cancel').addEventListener('click', showSetup);
$('open-settings').addEventListener('click', () => {
  fillForm();
  $('settings-cancel').hidden = false;
  show('settings');
});

// ---------- calculator for the average consumption (dialog) ----------
// The two numbers are kept on the phone, because the fill-up and the distance reading happen at different times.
const CALC_KEY = 'fuelprice.calc';
function loadCalc() {
  try {
    const c = JSON.parse(localStorage.getItem(CALC_KEY));
    return { litres: String(c?.litres ?? ''), km: String(c?.km ?? '') };
  } catch { return { litres: '', km: '' }; }
}
function saveCalc() {
  try {
    if ($('calc-litres').value === '' && $('calc-km').value === '') localStorage.removeItem(CALC_KEY);
    else localStorage.setItem(CALC_KEY, JSON.stringify({ litres: $('calc-litres').value, km: $('calc-km').value }));
  } catch { /* storage blocked: the numbers stay for this session only */ }
}
const calcDialog = $('calc-dialog');
let calcValue = null;
function updateCalc() {
  const r = averageFromFuel({ litres: $('calc-litres').value, km: $('calc-km').value });
  calcValue = r.value;
  $('calc-result').textContent = r.error || (r.value === null ? 'Enter both values.' : `${r.value} L/100 km`);
  $('calc-use').disabled = r.value === null;
}
$('calc-open').addEventListener('click', () => {
  const saved = loadCalc();
  $('calc-litres').value = saved.litres;
  $('calc-km').value = saved.km;
  updateCalc();
  calcDialog.showModal();
});
$('calc-litres').addEventListener('input', () => { updateCalc(); saveCalc(); });
$('calc-km').addEventListener('input', () => { updateCalc(); saveCalc(); });
$('calc-form').addEventListener('submit', (e) => {
  e.preventDefault();
  if (calcValue === null) return;
  form.average.value = calcValue;
  $('average-err').textContent = '';
  $('calc-litres').value = '';   // this measurement is used up: the next fill-up starts a new one
  $('calc-km').value = '';
  saveCalc();
  calcDialog.close();
});
$('calc-cancel').addEventListener('click', () => calcDialog.close());

// ---------- advanced settings screen (Tier 2) ----------
const advForm = $('advanced-form');
const ADV_FIELDS = ['g', 'g1', 'maxLaden', 'displacement', 'ratedKw', 'co2'];
function advResultText(p) {
  const parts = [isMoto()
    ? `Tier 2 active. Mass with rider ${Math.round(p.m)} kg, power clamp ${(p.pMax / 1000).toFixed(0)} kW.`
    : `Tier 2 active. Test mass ${Math.round(p.testMass)} kg.`];
  if (p.official !== null) {
    parts.push(p.kSource === 'average'
      ? `Your own average ${p.official.toFixed(2)} L/100 km sets k.`
      : `Official consumption ${p.official.toFixed(2)} L/100 km, with the real-world factor ${(p.official * 1.15).toFixed(2)}.`);
    parts.push(`Fuel constant k = ${p.k.toFixed(3)} (Quick: ${FUELS[settings.fuel].k}). The model gives ${simulatedWltp(p).toFixed(2)} L/100 km on the ${isMoto() ? 'reference' : 'WLTP'} cycle.`);
  }
  if (p.note) parts.push(p.note);
  return parts.join(' ');
}
function showAdvancedErrors(errors) {
  advForm.querySelectorAll('.err').forEach((el) => { el.textContent = errors[el.dataset.for] || ''; });
}
function openAdvanced() {
  const moto = isMoto();
  document.querySelectorAll('#screen-advanced [data-cars]').forEach((el) => { el.hidden = moto; });
  document.querySelectorAll('#screen-advanced [data-moto]').forEach((el) => { el.hidden = !moto; });
  $('f-label').textContent = moto ? 'F.2: maximum laden mass (kg), optional' : 'F.1: maximum laden mass (kg), optional';
  $('f-hint').textContent = moto
    ? 'Used to estimate the mass of the bike if there is no G.'
    : 'If there is no F.1, use F.2.';
  const raw = settings.advanced || {};
  for (const f of ADV_FIELDS) advForm.elements[f].value = raw[f] ?? '';
  advForm.elements.body.value = raw.body || '';
  advForm.elements.startStop.checked = Boolean(raw.startStop);
  showAdvancedErrors({});
  $('advanced-remove').hidden = !settings.advanced;
  $('advanced-result').hidden = !advanced;
  if (advanced) $('advanced-result').textContent = advResultText(advanced);
  show('advanced');
}
advForm.addEventListener('submit', (e) => {
  e.preventDefault();
  const raw = { body: advForm.elements.body.value, startStop: advForm.elements.startStop.checked };
  for (const f of ADV_FIELDS) raw[f] = advForm.elements[f].value;
  const r = buildProfile(raw, settings.average ?? null);
  if (r.errors) {
    showAdvancedErrors(r.errors);
    advForm.querySelector('.err:not(:empty)')?.scrollIntoView({ block: 'center' });
    return;
  }
  settings = { ...settings, advanced: raw };
  saveSettings(settings);
  refreshAdvanced();
  showSetup();
});
$('open-advanced').addEventListener('click', () => { commitBasics(); openAdvanced(); });
$('advanced-cancel').addEventListener('click', () => { fillForm(); show('settings'); });
$('advanced-remove').addEventListener('click', () => {
  const { advanced: _gone, ...rest } = settings;
  settings = rest;
  saveSettings(settings);
  refreshAdvanced();
  showSetup();
});

// ---------- trip setup screen ----------
// With two or more saved vehicles, a row of chips switches between them without going through Settings.
const vehicleSwitch = $('vehicle-switch');
function renderVehicleSwitch() {
  // Only the two most recently used vehicles, in the fixed list order so the chips keep their place.
  const recent = recentVehicles(store, 2);
  const saved = Object.keys(PRESETS).filter((id) => recent.includes(id));
  vehicleSwitch.hidden = saved.length < 2;
  vehicleSwitch.replaceChildren(...saved.map((id) => {
    const label = document.createElement('label');
    const input = document.createElement('input');
    input.type = 'radio';
    input.name = 'quick-vehicle';
    input.value = id;
    input.checked = id === settings.vehicle;
    const span = document.createElement('span');
    span.textContent = PRESETS[id].label;
    label.append(input, span);
    return label;
  }));
}
vehicleSwitch.addEventListener('change', (e) => {
  store = setActive(store, e.target.value);
  persistStore();
  settings = activeSettings(store);
  refreshAdvanced();
  showSetup();
});
function showSetup() {
  if (reloadIfUpdateWaiting()) return; // a new version arrived during the trip
  const p = PRESETS[settings.vehicle];
  const badge = document.createElement('span');
  badge.className = 'tier';
  badge.textContent = advanced ? 'Tier 2 · Advanced' : 'Tier 1 · Quick';
  const line = (text) => { const d = document.createElement('div'); d.textContent = text; return d; };
  $('recap').replaceChildren(
    badge,
    line(`${p.label} · ${FUELS[settings.fuel].label} · €${settings.price.toFixed(3)} per litre`),
    ...(settings.average ? [line(`Your average: ${settings.average} L/100 km`)] : []),
  );
  renderVehicleSwitch();
  $('pax-label').textContent = PRESETS[settings.vehicle].gasolineOnly ? 'People on the bike' : 'People in the car';
  $('pax').textContent = setup.passengers;
  $('setup-ac').closest('label').hidden = hasNoAc(); // scooters and motorcycles have no A/C
  $('setup-ac').checked = setup.ac;
  $('setup-cold').checked = setup.cold;
  $('setup-log').checked = setup.log;
  $('export-last').hidden = !hasSavedLogs();
  show('setup');
}
$('pax-minus').addEventListener('click', () => { setup.passengers = Math.max(1, setup.passengers - 1); $('pax').textContent = setup.passengers; });
$('pax-plus').addEventListener('click', () => { setup.passengers = Math.min(9, setup.passengers + 1); $('pax').textContent = setup.passengers; });
$('setup-ac').addEventListener('change', (e) => { setup.ac = e.target.checked; });
$('setup-cold').addEventListener('change', (e) => { setup.cold = e.target.checked; });
$('setup-log').addEventListener('change', (e) => { setup.log = e.target.checked; });
$('start').addEventListener('click', () => startTrip({ demo: false }));
$('demo').addEventListener('click', () => startTrip({ demo: true }));
$('done').addEventListener('click', showSetup);

// ---------- GPS: one watch for trip setup and the trip ----------
// The watch starts when trip setup opens, so the phone has time to settle before the car moves
// (on the first real drive the altitude stayed stale for 90 s after the start). The same watch
// then feeds the trip without restarting. It stops on every other screen.
// Samples received on trip setup are kept and written at the top of the trip log as 'warmup' rows.
const WARMUP_ROWS = 600; // newest 10 minutes at 1 Hz
let gpsOn = false;
let warmup = [];         // [{ v, accuracy, t, alt, altAcc }] received on trip setup

function ensureGps() {
  if (gpsOn) return;
  gpsOn = true;
  warmup = [];
  resetAltitude();
  renderGpsReady(null);
  startGps({ onSample: gpsSample, onProblem: gpsProblem });
}

function endGps() {
  if (!gpsOn) return;
  stopGps();
  gpsOn = false;
  warmup = [];
}

function gpsSample(s) {
  if (trip) { if (!trip.demo) onSample(s); return; } // a demo drive ignores the real GPS
  let note = 'warmup';
  if (s.accuracy <= GOOD_ACCURACY) { const a = checkAltitude(s); if (a) note += ` ${a}`; }
  warmup.push({ ...s, note });
  if (warmup.length > WARMUP_ROWS) warmup.shift();
  renderGpsReady(s);
}

// ----- is the GPS altitude trusted? (altitudeStep in model.js, MODEL.md section 17) -----
// Not trusted when the GPS starts and after every jump; trusted from the first believable change.
// While it is not trusted there is no slope: the grade shows "–" and the fuel uses flat road.
// The state carries over from trip setup into the trip (same GPS watch). Weak fixes are skipped.
let altTrust = { prev: null, t: null, trusted: false };
function resetAltitude() { altTrust = { prev: null, t: null, trusted: false }; }

/** Updates the trust state with one good sample; returns a log note: 'alt_jump', 'alt_ok' or ''. */
function checkAltitude({ v, t, alt }) {
  const dt = altTrust.t == null ? 0 : Math.max(0, (t - altTrust.t) / 1000);
  const kind = altitudeStep({ prevAlt: altTrust.prev, alt, step: v * dt });
  const was = altTrust.trusted;
  if (kind === 'jump') altTrust.trusted = false;
  // A change while parked does not earn trust: on the 2026-11-25 city drive a stale altitude moved 1.1 m
  // while stopped, was trusted, then stayed frozen for 70 s of driving. A jump still withdraws trust.
  else if (kind === 'move' && v >= SLOPE_MIN_SPEED) altTrust.trusted = true;
  altTrust.prev = alt ?? null;
  altTrust.t = t;
  if (kind === 'jump') return 'alt_jump';
  return !was && altTrust.trusted ? 'alt_ok' : '';
}

// The GPS line: setup screen and trip screen share the wording and the coloured dot.
function gpsLine(s) {
  const acc = `GPS ±${Math.ceil(s.accuracy)} m`;
  if (s.accuracy > POOR_ACCURACY) return { state: 'poor', text: trip ? `${acc} · weak signal, reading held` : `${acc} · weak signal` };
  if (s.accuracy > GOOD_ACCURACY) return { state: 'fair', text: trip ? `${acc} · reading held` : `${acc} · not precise yet` };
  if (s.alt == null) return { state: 'ok', text: `${acc} · no altitude` };
  if (!altTrust.trusted) return { state: 'settle', text: `${acc} · altitude settling` };
  return { state: 'ok', text: trip ? acc : `${acc} · altitude ${Math.round(s.alt)} m` };
}

// The GPS line on trip setup, from the latest warm-up sample (null: nothing received yet).
// Start trip is always allowed while the GPS works: with a rough fix the trip screen holds the
// reading (grey) until the accuracy reaches GOOD_ACCURACY. Only a blocked or missing GPS disables it.
function renderGpsReady(s) {
  const el = $('gps-ready');
  const { state, text } = s ? gpsLine(s) : { state: 'wait', text: 'Waiting for GPS…' };
  el.textContent = text;
  el.dataset.state = state;
  $('start').disabled = false;
}

// ---------- trip ----------
let trip = null;

function engineParams() {
  const p = PRESETS[settings.vehicle];
  // Tier 2 (advanced) values replace the presets; G includes the driver, like the preset masses.
  const t = advanced || { m: p.m, cdA: p.cdA, f0: p.f0, k: quickK ?? FUELS[settings.fuel].k, pMax: P_MAX, startStop: false };
  return {
    m: t.m + KG_PER_PERSON * (trip.passengers - 1),
    cdA: t.cdA,
    f0: t.f0,
    k: t.k,
    pMax: t.pMax,
    startStop: t.startStop,
    pAc: trip.ac ? p.pAc : 0,
  };
}

// Fuel rate (L/h) for a speed, acceleration and road angle (rad), with the current A/C state.
// theta 0 = flat road: used when no slope is known yet, and for the cruise reference.
function fuelAt(v, a, theta = 0) {
  const e = engineParams();
  const p = tractivePower({ v, a, theta, m: e.m, cdA: e.cdA }) + e.pAc;
  return fuelRate({ p, v, f0: e.f0, k: e.k, pMax: e.pMax, startStop: e.startStop });
}

// Cost at steady cruise: the reference the scale and colour bands are relative to.
function cruiseReference() {
  return toCost({ litres: fuelAt(CRUISE_SPEED, 0), price: settings.price });
}

function startTrip({ demo }) {
  trip = {
    passengers: setup.passengers,
    ac: setup.ac && !hasNoAc(),
    cold: setup.cold,
    demo,
    startMs: Date.now(),
    paused: false,
    lastT: null,      // time of the previous sample (ms)
    vPrev: 0,         // speed at the previous sample (m/s)
    aS: 0,            // smoothed acceleration (m/s²)
    fS: 0,            // smoothed fuel rate (L/h)
    vS: 0,            // smoothed speed (m/s)
    dtS: null,        // smoothed time between GPS readings (s), for the slope smoothing length
    hasData: false,
    altS: null,       // smoothed altitude for display (m)
    theta: null,      // smoothed road angle (rad); null = no slope known yet
    altAnchor: null,  // altitude at the last accepted slope update (m)
    slopeDist: 0,     // distance travelled since that update (m)
    distance: 0,      // m
    seconds: 0,       // s of moving-or-stopped time, pauses excluded
    litres: 0,
    acLitres: 0,      // fuel attributable to A/C (estimated)
    idleLitres: 0,    // fuel burned while stopped
    ref: null,        // cost at steady cruise (€/h)
    demoTimer: null,
  };
  trip.ref = cruiseReference();
  if (setup.log) {
    startLog({ startMs: trip.startMs, meta: logMeta() });
    // what the GPS said while the trip was being set up: negative times, before the start
    if (!demo) for (const s of warmup) {
      logAdd({ t_s: (s.t - trip.startMs) / 1000, v_ms: s.v, gps_acc_m: s.accuracy, alt_m: s.alt, alt_acc_m: s.altAcc }, s.note);
    }
  }
  warmup = [];
  $('trip-ac').closest('label').hidden = hasNoAc();
  $('trip-ac').closest('.controls').classList.toggle('no-ac', hasNoAc());
  $('trip-ac').checked = trip.ac;
  $('pause').textContent = 'Pause';
  $('value').textContent = '—';
  $('value').dataset.band = 'none';
  $('unit').textContent = '€/h';
  $('speed').textContent = '0';
  $('grade-value').textContent = '–';
  $('grade-value').dataset.dir = '';
  $('altitude').textContent = '–';
  $('trip-cost').textContent = '0.00';
  $('avg-mark').hidden = true;
  $('avg-value').textContent = '–';
  $('now-mark').style.left = '0%';
  if (demo) resetAltitude(); // the demo has its own altitude; a real trip keeps what trip setup learned
  setStatus('Waiting for GPS…', 'wait');
  setHeld(false);
  show('trip');
  requestWakeLock();

  if (demo) startDemo();
  else ensureGps(); // normally already running since trip setup
}

function setStatus(text, state = 'poor') { $('status').textContent = text; $('status').dataset.state = state; }

// ----- GPS source: see gps.js -----
function gpsProblem(kind) {
  let text;
  if (kind === 'unsupported') text = 'This browser has no location support.';
  else if (kind === 'denied') text = 'Location is blocked. Allow it for this site in your browser settings, then reload.';
  else text = 'GPS signal lost. Waiting for it to return…';
  if (kind !== 'lost') gpsOn = false; // the watch is dead: try again next time trip setup opens
  if (trip) { if (!trip.demo) setStatus(text); return; }
  $('gps-ready').textContent = text;
  $('gps-ready').dataset.state = 'poor';
  if (kind !== 'lost') $('start').disabled = true; // no GPS at all: no trip (the demo drive still works)
}

// ----- demo source: a looping 2-minute drive, one sample per second -----
const DEMO = [ // [seconds, km/h] waypoints, linearly interpolated
  [0, 0], [4, 0], [14, 50], [34, 50], [48, 100], [78, 100], [92, 60], [96, 60], [108, 0], [118, 0],
];
function demoSpeed(t) {
  const s = t % DEMO[DEMO.length - 1][0];
  for (let i = 1; i < DEMO.length; i++) {
    if (s <= DEMO[i][0]) {
      const [t0, v0] = DEMO[i - 1], [t1, v1] = DEMO[i];
      return (v0 + ((s - t0) / (t1 - t0)) * (v1 - v0)) / 3.6;
    }
  }
  return 0;
}
// slope of the demo road (sine of the angle): a 5% climb, then a 4% descent
function demoGrade(t) {
  const s = t % DEMO[DEMO.length - 1][0];
  if (s >= 14 && s < 34) return 0.05;
  if (s >= 48 && s < 78) return -0.04;
  return 0;
}
function startDemo() {
  let n = 0;
  let alt = 300;
  const t0 = Date.now();
  trip.demoTimer = setInterval(() => {
    n += 1;
    const v = demoSpeed(n);
    alt += v * demoGrade(n); // 1 s per sample
    const noise = 1.5 * Math.sin(n * 12.9898) * Math.cos(n * 78.233); // fake GPS altitude noise, ±1.5 m
    onSample({ v, accuracy: 5, t: t0 + n * 1000, alt: alt + noise, altAcc: 3 });
  }, 1000);
}

// ----- one speed sample in, one display update out -----
function onSample({ v, accuracy, t, alt = null, altAcc = null }) {
  if (!trip || trip.paused) return;

  const line = gpsLine({ accuracy, alt });
  setStatus(line.text, line.state);
  const held = accuracy > GOOD_ACCURACY; // amber or red: the display is held and greyed
  setHeld(held);

  if (accuracy > POOR_ACCURACY) {
    trip.lastT = null; // do not integrate across the bad stretch
    resetSlopeWindow();
    logAdd({ t_s: (t - trip.startMs) / 1000, v_ms: v, gps_acc_m: accuracy, alt_m: alt, alt_acc_m: altAcc }, 'poor_gps');
    return;
  }
  // amber: the speed (Doppler) is still good, so the totals go on; the altitude is not used
  const altNote = held ? 'fair_gps' : checkAltitude({ v, t, alt });
  const altOk = !held && altTrust.trusted ? alt : null; // untrusted altitude: no slope
  if (!altTrust.trusted || altNote === 'alt_jump') { resetSlopeWindow(); trip.theta = null; }

  const first = trip.lastT == null;
  const dt = first ? 0 : (t - trip.lastT) / 1000;
  trip.lastT = t;

  if (first || dt <= 0 || dt > MAX_GAP) {
    trip.vPrev = v;
    resetSlopeWindow();
    updateSlope(0, altOk, v); // start a new altitude window here
    if (alt != null) trip.altS = alt;
    if (!trip.hasData) { trip.vS = v; trip.fS = fuelAt(v, 0, trip.theta ?? 0); trip.hasData = true; }
    logAdd({ t_s: (t - trip.startMs) / 1000, dt_s: dt, v_ms: v, gps_acc_m: accuracy, alt_m: alt, alt_acc_m: altAcc },
      [first ? 'start' : 'gap', altNote].filter(Boolean).join(' '));
    if (!held) render();
    return;
  }

  // acceleration from the speed change, smoothed lightly, then clamped
  const aRaw = Math.max(-MAX_ACCEL, Math.min(MAX_ACCEL, (v - trip.vPrev) / dt));
  trip.aS = smooth({ prev: trip.aS, value: aRaw, dt, tau: 1 });
  trip.vPrev = v;

  trip.dtS = trip.dtS == null ? dt : smooth({ prev: trip.dtS, value: dt, dt, tau: DT_TAU });
  const rawTheta = updateSlope(v * dt, altOk, v);
  if (alt != null) trip.altS = trip.altS == null ? alt : smooth({ prev: trip.altS, value: alt, dt, tau: ALT_DISPLAY_TAU });
  const theta = trip.theta ?? 0; // no slope known yet: flat road
  const f = fuelAt(v, trip.aS, theta);
  trip.fS = smooth({ prev: trip.fS, value: f, dt });
  trip.vS = smooth({ prev: trip.vS, value: v, dt });

  // totals use the unsmoothed rate, so smoothing never changes the fuel used
  const dL = (f * dt) / 3600;
  trip.litres += dL;
  trip.distance += v * dt;
  trip.seconds += dt;
  if (v < 0.5) trip.idleLitres += dL;
  if (trip.ac) {
    const withoutAc = fuelAtWithoutAc(v, trip.aS, theta);
    trip.acLitres += Math.max(0, ((f - withoutAc) * dt) / 3600);
  }
  if (logActive()) {
    const p = powerTerms(v, trip.aS, theta);
    logAdd({
      t_s: (t - trip.startMs) / 1000, dt_s: dt, v_ms: v, gps_acc_m: accuracy, alt_m: alt, alt_acc_m: altAcc,
      a_ms2: trip.aS, theta_raw_rad: rawTheta, theta_rad: trip.theta,
      p_inertia_W: p.inertia, p_grade_W: p.grade, p_rolling_W: p.rolling, p_drag_W: p.drag, p_ac_W: p.ac,
      p_total_W: p.total + p.ac, f_Lh: f, f_smooth_Lh: trip.fS,
    }, altNote);
  }
  if (!held) render();
}

// Held display: the figures stay at their last good values, in grey, until the GPS is good again.
function setHeld(held) { $('screen-trip').dataset.held = held ? 'true' : ''; }

function fuelAtWithoutAc(v, a, theta) {
  const saved = trip.ac;
  trip.ac = false;
  const f = fuelAt(v, a, theta);
  trip.ac = saved;
  return f;
}

// ----- trip log: see triplog.js -----
// Facts about the trip, written as header lines at the top of the CSV (no position).
function logMeta() {
  const e = engineParams();
  return {
    app_version: $('version').textContent.replace('Version ', '') || 'unknown',
    started: new Date(trip.startMs).toISOString(),
    demo: trip.demo,
    vehicle: settings.vehicle,
    fuel: settings.fuel,
    passengers: trip.passengers,
    ac_at_start: trip.ac,
    mass_kg: e.m,
    cdA_m2: e.cdA,
    f0_Lh: e.f0,
    k_Lh_per_kW: e.k,
    tier: advanced ? 2 : 1,
    average_L100km: settings.average ?? '',
    start_stop: e.startStop,
    p_max_W: e.pMax,
    warmup_s: !trip.demo && warmup.length ? ((trip.startMs - warmup[0].t) / 1000).toFixed(0) : 0,
    user_agent: navigator.userAgent,
  };
}

// Each force of the power sum, separately, using the model itself.
function powerTerms(v, a, theta) {
  const e = engineParams();
  const P = (o) => tractivePower({ v, a: 0, theta: 0, m: e.m, cdA: e.cdA, ...o });
  const total = P({ a, theta });
  const noAccel = P({ theta });
  const flat = P({});
  const drag = P({ crr: 0 });
  return { total, inertia: total - noAccel, grade: noAccel - flat, rolling: flat - drag, drag, ac: e.pAc };
}

$('export-log').addEventListener('click', exportLatestLog);
$('export-last').addEventListener('click', exportLatestLog);

// ----- road slope from GPS altitude -----
// The altitude at the last accepted update is the anchor; the distance driven since then is
// slopeDist. Once enough distance has built up, slopeFromAltitude gives a raw angle and
// smoothSlope blends it in. While there is no answer the distance keeps adding up.
function resetSlopeWindow() {
  trip.altAnchor = null;
  trip.slopeDist = 0;
}

// Below SLOPE_MIN_SPEED (about stopped) each reading becomes the new anchor: a stopped car covers no
// distance, so its altitude says nothing about the slope, and any drift during the stop must not
// turn into a slope after moving off. The slope shown so far is kept.
function updateSlope(step, alt, v) {
  trip.slopeDist += step;
  if (alt == null || Number.isNaN(alt)) return null; // this device gives no altitude: stay on flat road
  if (trip.altAnchor == null || v < SLOPE_MIN_SPEED) {
    trip.altAnchor = alt;
    trip.slopeDist = 0;
    return null;
  }
  const raw = slopeFromAltitude({ dh: alt - trip.altAnchor, dist: trip.slopeDist });
  if (raw === null) return null; // not enough distance yet: keep adding
  trip.theta = smoothSlope({
    prev: trip.theta, theta: raw, dist: trip.slopeDist,
    length: slopeLength({ vAvg: trip.vS, dt: trip.dtS }), // about 4 GPS readings of road
  });
  trip.altAnchor = alt;
  trip.slopeDist = 0;
  return raw; // the raw angle of this update, for the log
}

// Grade indicator: ▲ uphill, ▼ downhill, ▬ flat (under 1%), "–" when no slope is known.
function renderGrade() {
  const el = $('grade-value');
  if (trip.theta == null) { el.textContent = '–'; el.dataset.dir = ''; return; }
  const percent = Math.round(Math.tan(trip.theta) * 100); // rise per 100 m of road, in %
  if (Math.abs(Math.tan(trip.theta)) < 0.01) { el.textContent = '▬ 0%'; el.dataset.dir = 'flat'; }
  else if (percent > 0) { el.textContent = `▲ +${percent}%`; el.dataset.dir = 'up'; }
  else { el.textContent = `▼ −${Math.abs(percent)}%`; el.dataset.dir = 'down'; }
}

// ----- display -----
function render() {
  const price = settings.price;
  const cost = toCost({ litres: trip.fS, price }); // €/h
  const ref = trip.ref;
  const ratio = cost / ref;

  $('value').textContent = cost.toFixed(2);
  $('value').dataset.band = ratio < 0.8 ? 'low' : ratio < 1.3 ? 'mid' : 'high';
  $('speed').textContent = Math.round(trip.vS * 3.6);
  $('trip-cost').textContent = toCost({ litres: trip.litres, price }).toFixed(2);
  renderGrade();
  $('altitude').textContent = trip.altS == null ? '–' : Math.round(trip.altS);

  // scale runs 0 to 2x the cruising cost, so the cruise tick sits at 50%
  $('now-mark').style.left = `${Math.min(1, ratio / 2) * 100}%`;
  $('cruise-label').textContent = `Typical cruise ${ref.toFixed(2)}`;

  // trip average (€/h over the trip time, pauses excluded): above the bar and as a marker (needs 30 s)
  const avg = trip.seconds > 30 ? toCost({ litres: trip.litres, price }) / (trip.seconds / 3600) : null;
  $('avg-value').textContent = avg == null ? '–' : avg.toFixed(2);
  $('avg-mark').hidden = avg == null;
  if (avg != null) $('avg-mark').style.left = `${Math.min(1, avg / ref / 2) * 100}%`;
}

// ----- controls -----
$('trip-ac').addEventListener('change', (e) => {
  if (!trip) return;
  trip.ac = e.target.checked;
  trip.ref = cruiseReference();
});

$('pause').addEventListener('click', () => {
  if (!trip) return;
  trip.paused = !trip.paused;
  trip.lastT = null;
  resetSlopeWindow();
  $('pause').textContent = trip.paused ? 'Resume' : 'Pause';
  setStatus(trip.paused ? 'Paused' : '');
  logAdd({ t_s: (Date.now() - trip.startMs) / 1000 }, trip.paused ? 'pause' : 'resume');
});

// Stop needs a long press, so a bump or a stray tap cannot end the trip.
const HOLD_MS = 900;
let holdTimer = null;
const stopBtn = $('stop');
function holdStart() {
  stopBtn.classList.add('holding');
  holdTimer = setTimeout(() => { holdCancel(); endTrip(); }, HOLD_MS);
}
function holdCancel() {
  clearTimeout(holdTimer);
  stopBtn.classList.remove('holding');
}
stopBtn.addEventListener('pointerdown', holdStart);
for (const ev of ['pointerup', 'pointerleave', 'pointercancel']) stopBtn.addEventListener(ev, holdCancel);
stopBtn.addEventListener('keydown', (e) => { if ((e.key === 'Enter' || e.key === ' ') && !e.repeat) holdStart(); });
stopBtn.addEventListener('keyup', holdCancel);
stopBtn.addEventListener('contextmenu', (e) => e.preventDefault());

// "~2 months", "~3 weeks", "~5 days": a tree's absorption time, rounded for reading.
function treeTime(days) {
  if (days < 1) return 'less than a day';
  if (days < 14) return `~${Math.round(days)} ${Math.round(days) === 1 ? 'day' : 'days'}`;
  if (days < 60) return `~${Math.round(days / 7)} weeks`;
  if (days < 700) return `~${Math.round(days / 30)} months`;
  return `~${(days / 365).toFixed(1)} years`;
}

function endTrip() {
  if (!trip) return;
  endGps();
  if (trip.demoTimer) clearInterval(trip.demoTimer);
  releaseWakeLock();
  const hadLog = stopLog();

  const price = settings.price;
  const km = trip.distance / 1000;
  const total = toCost({ litres: trip.litres, price });
  const mins = Math.round(trip.seconds / 60);
  const rows = [
    ['Distance', `${km.toFixed(1)} km`],
    ['Time', `${mins} min`],
    ['Fuel', `${trip.litres.toFixed(2)} L`],
    ['Total cost', `€${total.toFixed(2)}`],
    ['Average', trip.seconds > 30 ? `€${(total / (trip.seconds / 3600)).toFixed(2)}/h` : '—'],
    ['Idling', `€${toCost({ litres: trip.idleLitres, price }).toFixed(2)}`],
  ];
  const co2 = co2FromFuel({ litres: trip.litres, fuel: settings.fuel });
  rows.push(['CO₂', `${co2.toFixed(1)} kg`]);
  const days = treeDays({ co2 });
  rows.push(['🌳 Time to absorb', treeTime(days), 'tree']);
  if (trip.acLitres > 0) rows.push(['A/C', `€${toCost({ litres: trip.acLitres, price }).toFixed(2)}`]);
  const fuelLabel = FUELS[settings.fuel].label.toLowerCase();
  const detail = $('tree-detail');
  detail.hidden = true;
  detail.textContent =
    `This trip burned ${trip.litres.toFixed(2)} L of ${fuelLabel}. Each litre releases about ` +
    `${CO2_PER_LITRE[settings.fuel]} kg of CO₂ when burned, so the trip emitted ${co2.toFixed(1)} kg. ` +
    `A typical mature tree absorbs about ${TREE_KG_PER_YEAR} kg of CO₂ per year (estimates range from ` +
    `15 to 25 kg, depending on species and size), so one tree would need ${treeTime(days)} ` +
    `(${Math.round(days)} days) to take it back up. Only the fuel burned in the engine is counted, ` +
    `not its production or transport.`;
  $('summary').replaceChildren(...rows.map(([k, v, kind]) => {
    const d = document.createElement('div');
    const dt = document.createElement('dt'); dt.textContent = k;
    const dd = document.createElement('dd'); dd.textContent = v;
    d.append(dt, dd);
    if (kind === 'tree') {
      d.className = 'tappable';
      d.tabIndex = 0;
      d.setAttribute('role', 'button');
      d.setAttribute('aria-expanded', 'false');
      const toggle = () => {
        detail.hidden = !detail.hidden;
        d.setAttribute('aria-expanded', String(!detail.hidden));
      };
      d.addEventListener('click', toggle);
      d.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); toggle(); } });
    }
    return d;
  }));
  $('export-log').hidden = !hadLog;
  trip = null;
  show('summary');
}

// ---------- screen wake lock ----------
let wakeLock = null;
async function requestWakeLock() {
  try {
    if ('wakeLock' in navigator) wakeLock = await navigator.wakeLock.request('screen');
  } catch { /* denied or unsupported: the screen may dim */ }
}
function releaseWakeLock() {
  try { wakeLock?.release(); } catch { /* already released */ }
  wakeLock = null;
}
// the browser drops the lock when the tab is hidden; take it again on return
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible' && trip) requestWakeLock();
});

// ---------- boot ----------
if (settings) showSetup();
else { $('settings-cancel').hidden = true; $('average-field').hidden = true; show('settings'); }

// ---------- offline use and automatic updates: see update.js ----------
// Never reload mid-trip; the version label shows which files are running.
startUpdates({
  isBusy: () => Boolean(trip),
  onVersion: (id) => { $('version').textContent = `Version ${id}`; },
});
