// app.js — interface: screens, settings storage, the trip pipeline, wake lock. GPS is in gps.js, the
// trip log in triplog.js, updates in update.js,
// all the physics in model.js.
import {
  tractivePower, fuelRate, smooth, toCost,
  slopeFromAltitude, smoothSlope, slopeLength, altitudeStep, co2FromFuel, treeDays, CO2_PER_LITRE, TREE_KG_PER_YEAR,
} from './model.js';
import { startGps, stopGps, signalBars } from './gps.js';
import { binProfile, extremes } from './elevation.js';
import { startUpdates, reloadIfUpdateWaiting } from './update.js';
import { buildAdvanced, buildAdvancedMoto, simulatedWltp, checkAverage, kFromAverage, averageFromFuel } from './profile.js';
import { normalizeStore, settingsFor, activeSettings, saveVehicle, setActive, recentVehicles } from './vehicles.js';
import { startLog, stopLog, logAdd, logActive, hasSavedLogs, exportLatestLog, parseLog } from './triplog.js';
import { t, nf, loadLang, saveLang, getLang, applyStatic } from './i18n.js';
import { segmentPaths, fixedDigits } from './segments.js';

loadLang();
const vehicleLabel = (id) => t(`veh.${id}`);
const fuelLabel = (id) => t(`fuel.${id}`);

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
const RECENT_WINDOW = 300;     // s of trip time for the "last 5 min" average under the bar
const DT_TAU = 10;             // s: smoothing of the time between GPS readings
const SLOPE_MIN_SPEED = 3 / 3.6; // m/s: below this every altitude reading restarts the slope window
const ALT_DISPLAY_TAU = 5;     // s: smoothing of the altitude shown (display only, the slope has its own filter)

const $ = (id) => document.getElementById(id);
const screens = ['settings', 'advanced', 'setup', 'trip', 'summary'];
function show(name) {
  for (const s of screens) $(`screen-${s}`).hidden = s !== name;
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
  rememberPrice(s.fuel, s.price);
}

// Last price paid for each fuel, whatever the vehicle (a pump price): picking a fuel brings its price back.
const PRICES_KEY = 'fuelprice.fuelPrices';
function lastPrices() {
  try { const p = JSON.parse(localStorage.getItem(PRICES_KEY)); return p && typeof p === 'object' ? p : {}; }
  catch { return {}; }
}
function lastPrice(fuel) {
  const p = Number(lastPrices()[fuel]);
  return p >= 0.1 && p <= 10 ? p : null;
}
function rememberPrice(fuel, price) {
  if (!(fuel in FUELS) || !(price >= 0.1 && price <= 10)) return;
  try { localStorage.setItem(PRICES_KEY, JSON.stringify({ ...lastPrices(), [fuel]: price })); } catch { /* not remembered */ }
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
const setup = { passengers: 1, cold: true };

// ---------- settings screen ----------
const form = $('settings-form');
// Motorcycles and scooters have no diesel or LPG option: disable them and fall back to gasoline.
function syncFuelChoices() {
  const gasOnly = Boolean(PRESETS[form.vehicle.value]?.gasolineOnly);
  for (const id of ['diesel', 'lpg']) form.fuel.querySelector(`option[value="${id}"]`).disabled = gasOnly;
  form.fuel.disabled = gasOnly;
  if (gasOnly) form.fuel.value = 'gasoline';
  // The first run asks for the three basic answers only; the optional average appears from the second visit.
  $('average-field').hidden = !settings;
}
// Choosing another vehicle shows what was saved for it. A vehicle never saved keeps the fuel and price on screen
// (likely the same) and starts without an average, which belongs to one vehicle.
form.querySelectorAll('input[name="vehicle"]').forEach((r) => r.addEventListener('change', () => {
  const saved = settingsFor(store, form.vehicle.value);
  if (saved) { form.fuel.value = saved.fuel; form.price.value = saved.price; form.average.value = averageToField(saved.average); }
  else form.average.value = '';
  $('average-err').textContent = '';
  syncFuelChoices();
}));
// Picking a fuel on the Settings screen brings back the last price paid for it.
form.fuel.addEventListener('change', () => {
  const price = lastPrice(form.fuel.value);
  if (price !== null) form.price.value = price;
});
// Language: first row of the settings. It applies at once; Italian also switches the consumption to km/L.
form.lang.addEventListener('change', () => {
  const typed = averageFromField(form.average.value); // read in the old language's unit
  saveLang(form.lang.value);
  applyStatic();
  syncAverageLimits();
  if (typed.value !== null && !typed.error) form.average.value = averageToField(typed.value);
  fuelUnit = defaultFuelUnit();
  try { localStorage.setItem(FUEL_UNIT_KEY, fuelUnit); } catch { /* not remembered */ }
  $('average-err').textContent = '';
  if ($('version').dataset.id) $('version').textContent = t('version', { id: $('version').dataset.id });
});
// Average consumption is stored in L/100 km (the model's unit). In Italian the field, Calc and the recap use km/L,
// the unit people know there: km/L = 100 / (L/100 km).
const AVG_KML_MIN = 100 / 40, AVG_KML_MAX = 100; // the 1–40 L/100 km range of checkAverage, in km/L
const averageInKml = () => getLang() === 'it';
function averageToField(l100) {
  if (l100 == null || !(l100 > 0)) return '';
  return averageInKml() ? Number((100 / l100).toFixed(1)) : l100;
}
function averageFromField(text) {
  if (!averageInKml() || String(text).trim() === '') return checkAverage(text);
  const kml = Number(String(text).replace(',', '.'));
  if (!Number.isFinite(kml) || kml < AVG_KML_MIN || kml > AVG_KML_MAX) {
    return { value: null, error: t('err.range', { name: t('field.average'), min: nf(AVG_KML_MIN, 1), max: AVG_KML_MAX, unit: 'km/L' }) };
  }
  return checkAverage(Math.round((100 / kml) * 100) / 100);
}
// the field's own limits follow the unit (the browser checks them before the form is sent)
function syncAverageLimits() {
  form.average.min = averageInKml() ? AVG_KML_MIN : 1;
  form.average.max = averageInKml() ? AVG_KML_MAX : 40;
}
function averageText(l100) {
  return averageInKml() ? `${nf(100 / l100, 1)} km/L` : `${nf(l100, 2)} L/100 km`;
}

function fillForm() {
  form.lang.value = getLang();
  syncAverageLimits();
  if (!settings) return;
  form.vehicle.value = settings.vehicle;
  form.fuel.value = settings.fuel;
  form.price.value = settings.price;
  form.average.value = averageToField(settings.average);
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
  const average = averageFromField(form.average.value);
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
  const average = averageFromField(form.average.value);
  const next = { vehicle: form.vehicle.value, fuel: form.fuel.value, price: Number(form.price.value), advanced: settingsFor(store, form.vehicle.value)?.advanced };
  if (average.value !== null && !average.error) next.average = average.value;
  const previous = settings;
  settings = next;
  refreshAdvanced();
  // An average the vehicle cannot reach (below its idle fuel) is refused, so the user knows it was not applied.
  const unreachable = next.average !== undefined && (advanced ? advanced.kSource !== 'average' : quickK === null);
  $('average-err').textContent = average.error || (unreachable ? t('set.avgTooLow') : '');
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
  $('calc-result').textContent = r.error || (r.value === null ? t('calc.enterBoth') : averageText(r.value));
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
  form.average.value = averageToField(calcValue);
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
    ? t('adv.resMoto', { m: Math.round(p.m), p: Math.round(p.pMax / 1000) })
    : t('adv.resCar', { m: Math.round(p.testMass) })];
  if (p.official !== null) {
    parts.push(p.kSource === 'average'
      ? t('adv.resOwn', { v: nf(p.official, 2) })
      : t('adv.resOfficial', { v: nf(p.official, 2), w: nf(p.official * 1.15, 2) }));
    parts.push(t('adv.resK', { k: nf(p.k, 3), q: nf(FUELS[settings.fuel].k, 2), s: nf(simulatedWltp(p), 2), cycle: t(isMoto() ? 'adv.cycleRef' : 'adv.cycleWltp') }));
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
  $('f-label').textContent = t(moto ? 'adv.f2' : 'adv.f1');
  $('f-hint').textContent = t(moto ? 'adv.f2Hint' : 'adv.f1Hint');
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
    span.textContent = vehicleLabel(id);
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
  badge.textContent = t(advanced ? 'tier.adv' : 'tier.quick');
  const line = (text) => { const d = document.createElement('div'); d.textContent = text; return d; };
  $('recap').replaceChildren(
    badge,
    line(vehicleLabel(settings.vehicle)),
    ...(settings.average ? [line(t('recap.average', { v: averageText(settings.average) }))] : []),
  );
  renderVehicleSwitch();
  $('setup-fuel').value = settings.fuel;
  $('setup-fuel').disabled = Boolean(p.gasolineOnly); // two-wheelers: gasoline only
  $('setup-price').value = settings.price;
  $('setup-price').removeAttribute('aria-invalid');
  $('pax-label').textContent = t(PRESETS[settings.vehicle].gasolineOnly ? 'setup.onBike' : 'setup.people');
  $('pax').textContent = setup.passengers;
  $('setup-cold').checked = setup.cold;
  $('export-last').hidden = !hasSavedLogs();
  show('setup');
}
// Fuel and price on trip setup change the active vehicle's saved settings, like the Settings screen.
function updateFuelSettings(change) {
  settings = { ...settings, ...change };
  refreshAdvanced(); // the fuel changes k (Quick) and the LPG conversion (Tier 2)
  saveSettings(settings);
}
$('setup-fuel').addEventListener('change', (e) => {
  const fuel = e.target.value;
  // a price typed but not yet committed (the field may still have focus) belongs to the fuel being left
  const typed = Number($('setup-price').value);
  if ($('setup-price').value !== '' && typed >= 0.1 && typed <= 10 && typed !== settings.price) updateFuelSettings({ price: typed });
  updateFuelSettings({ fuel, price: lastPrice(fuel) ?? settings.price });
  showSetup(); // the tier badge may change
});
$('setup-price').addEventListener('change', (e) => {
  const price = Number(e.target.value);
  const ok = e.target.value !== '' && price >= 0.1 && price <= 10;
  e.target.setAttribute('aria-invalid', String(!ok));
  if (ok) updateFuelSettings({ price });
});
$('pax-minus').addEventListener('click', () => { setup.passengers = Math.max(1, setup.passengers - 1); $('pax').textContent = setup.passengers; });
$('pax-plus').addEventListener('click', () => { setup.passengers = Math.min(9, setup.passengers + 1); $('pax').textContent = setup.passengers; });
$('setup-cold').addEventListener('change', (e) => { setup.cold = e.target.checked; });
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
  if (s.accuracy > POOR_ACCURACY) return { state: 'poor', text: t(trip ? 'gps.weakHeld' : 'gps.weak', { acc }) };
  if (s.accuracy > GOOD_ACCURACY) return { state: 'fair', text: t(trip ? 'gps.held' : 'gps.notPrecise', { acc }) };
  if (s.alt == null) return { state: 'ok', text: t('gps.noAlt', { acc }) };
  if (!altTrust.trusted) return { state: 'settle', text: t('gps.altSettling', { acc }) };
  return { state: 'ok', text: trip ? acc : t('gps.alt', { acc, h: Math.round(s.alt) }) };
}

// The GPS line on trip setup, from the latest warm-up sample (null: nothing received yet).
// Start trip is always allowed while the GPS works: with a rough fix the trip screen holds the
// reading (grey) until the accuracy reaches GOOD_ACCURACY. Only a blocked or missing GPS disables it.
function renderGpsReady(s) {
  const el = $('gps-ready');
  const { state, text } = s ? gpsLine(s) : { state: 'wait', text: t('gps.waiting') };
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

// replay: a trip run from a log file (see replayTrip): no log, no GPS, no trip screen
function startTrip({ demo, replay = false }) {
  trip = {
    passengers: setup.passengers,
    ac: false,        // A/C starts off; the A/C button on the trip screen turns it on
    cold: setup.cold,
    demo,
    replay,
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
    recent: [{ s: 0, L: 0, d: 0 }], // running totals (seconds, litres, metres) for the last-5-minutes average
    profile: [],      // { d, h, L, s } per sample, for the altitude profile on the summary
    demoTimer: null,
  };
  trip.ref = cruiseReference();
  if (replay) { warmup = []; return; } // replayTrip feeds the samples and ends the trip itself
  // every trip is logged (on this phone only; exported by the user)
  startLog({ startMs: trip.startMs, meta: logMeta() });
  // what the GPS said while the trip was being set up: negative times, before the start
  if (!demo) for (const s of warmup) {
    logAdd({ t_s: (s.t - trip.startMs) / 1000, v_ms: s.v, gps_acc_m: s.accuracy, alt_m: s.alt, alt_acc_m: s.altAcc }, s.note);
  }
  warmup = [];
  $('trip-ac').hidden = hasNoAc();
  $('trip-ac').closest('.controls').classList.toggle('no-ac', hasNoAc());
  $('trip-ac').setAttribute('aria-pressed', String(trip.ac));
  setPauseButton(false);
  $('speed').textContent = '0';
  $('grade-value').textContent = '–';
  $('grade-value').dataset.dir = '';
  $('altitude').textContent = '–';
  $('trip-cost').textContent = '0.00';
  $('distance').textContent = '0.0';
  renderFuelAverage();
  dialUnit = 'h'; // every trip starts in €/h
  renderCostUnit();
  $('avg-mark').toggleAttribute('hidden', true);
  setDialValue(fixedDigits(null));
  $('dial-value').style.removeProperty('--cost-color');
  $('avg-value').textContent = '–';
  $('recent-mark').toggleAttribute('hidden', true);
  $('recent-value').textContent = '–';
  $('now-mark').style.transform = dialRotation(0);
  if (demo) resetAltitude(); // the demo has its own altitude; a real trip keeps what trip setup learned
  setStatus(t('gps.waiting'), 'wait');
  setGpsBars(null);
  setHeld(false);
  show('trip');
  requestWakeLock();

  if (demo) startDemo();
  else ensureGps(); // normally already running since trip setup
}

function setStatus(text, state = 'poor') {
  $('status').textContent = text;
  $('status').dataset.state = state; // text colour
  $('status-bar').dataset.state = text ? state : ''; // dot colour; no dot without text
}

function setGpsBars(accuracy) {
  const n = signalBars(accuracy);
  const el = $('gps-bars');
  el.dataset.bars = String(n);
  el.setAttribute('aria-label', n ? t('gps.bars', { n }) : t('gps.barsNone'));
}

// ----- GPS source: see gps.js -----
function gpsProblem(kind) {
  let text;
  if (kind === 'unsupported') text = t('gps.unsupported');
  else if (kind === 'denied') text = t('gps.denied');
  else text = t('gps.lost');
  if (kind !== 'lost') gpsOn = false; // the watch is dead: try again next time trip setup opens
  if (trip) { if (!trip.demo) { setStatus(text); setGpsBars(null); } return; }
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
  setGpsBars(accuracy);
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
  trip.recent.push({ s: trip.seconds, L: trip.litres, d: trip.distance });
  // keep one entry at or before the window start, so the window spans the full 5 minutes
  while (trip.recent.length > 1 && trip.recent[1].s <= trip.seconds - RECENT_WINDOW) trip.recent.shift();
  if (trip.altS != null) trip.profile.push({ d: trip.distance, h: trip.altS, L: trip.litres, s: trip.seconds });
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
    app_version: $('version').dataset.id || 'unknown',
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

// Export: a dialog asks where the trip went From and To (both optional, empty each time) for the file name.
const exportDialog = $('export-dialog');
function openExportDialog() {
  $('export-from').value = '';
  $('export-to').value = '';
  exportDialog.showModal();
}
$('export-log').addEventListener('click', openExportDialog);
$('export-last').addEventListener('click', openExportDialog);
$('export-cancel').addEventListener('click', () => exportDialog.close());
$('export-form').addEventListener('submit', (e) => {
  e.preventDefault();
  exportDialog.close();
  exportLatestLog({ from: $('export-from').value, to: $('export-to').value }); // still inside the tap, as sharing needs
});

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
  if (Math.abs(Math.tan(trip.theta)) < 0.01) { el.textContent = '▬'; el.dataset.dir = 'flat'; }
  else if (percent > 0) { el.textContent = `▲ +${percent}%`; el.dataset.dir = 'up'; }
  else { el.textContent = `▼ ${Math.abs(percent)}%`; el.dataset.dir = 'down'; }
}

// ----- display -----
// The dial reads €/h, €/100 km, kg CO₂/h or km/h. A tap on the dial goes to the next of the first three; the four
// lights in its top corners pick any unit, km/h included. Every trip starts in €/h. Each scale runs 0 to 2× the value at steady
// cruise (CRUISE_SPEED) in its own unit, so cruise sits at the same place on the dial.
const PER_KM_MIN_SPEED = 5 / 3.6;  // m/s: slower than this, a per-km figure has no meaning
const PER_KM_MIN_DIST = 300;       // m: distance the averages need per km (as the fuel average)
const PER_H_MIN_TIME = 30;         // s: time the averages need per hour
// for each unit: its label, and how much one litre of fuel is worth in it (€ or kg CO₂)
const DIAL_UNITS = {
  h: { label: '€/h', perKm: false, perLitre: () => settings.price },
  km: { label: '€/100 km', perKm: true, perLitre: () => settings.price },
  co2: { label: 'kg CO₂/h', perKm: false, perLitre: () => CO2_PER_LITRE[settings.fuel] },
  speed: { label: 'km/h', speed: true }, // a speedometer: picked with its light only, not in the tap cycle
};
const DIAL_CYCLE = ['h', 'km', 'co2'];
const SPEED_MAX = 140; // km/h at the end of the speedometer's scale (the band above it goes on to 210)
let dialUnit = 'h';

function renderCostUnit() {
  $('dial-unit').textContent = DIAL_UNITS[dialUnit].label; // the averages below the dial are in the same unit
  // the light of the unit on show is lit
  document.querySelectorAll('.light').forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.unit === dialUnit)));
}

/** `litres` burned over `seconds` and `metres`, in the dial's unit; null if too short to mean anything. */
function dialValueOf({ litres, seconds, metres, minSeconds = PER_H_MIN_TIME }) {
  const u = DIAL_UNITS[dialUnit];
  if (u.speed) return seconds > minSeconds ? (metres / seconds) * 3.6 : null; // average speed
  const amount = litres * u.perLitre();
  if (u.perKm) return metres > PER_KM_MIN_DIST ? (amount / metres) * 100000 : null;
  return seconds > minSeconds ? amount / (seconds / 3600) : null;
}

function render() {
  const price = settings.price;
  const u = DIAL_UNITS[dialUnit];
  let cost, ref;
  if (u.speed) {
    cost = trip.vS * 3.6;
    ref = SPEED_MAX / 2; // the scale ends at SPEED_MAX (2 × ref), like the others
  } else {
    const perHour = trip.fS * u.perLitre(); // € or kg CO₂ per hour (fS is L/h)
    // cruise value in the dial's unit; trip.ref is €/h at cruise (recomputed when A/C changes)
    const refPerHour = (trip.ref / price) * u.perLitre();
    ref = u.perKm ? (refPerHour / (CRUISE_SPEED * 3.6)) * 100 : refPerHour;
    // now: per 100 km = (per h) / (km/h) × 100; when (almost) stopped, no figure and the pointer at the end of the band
    const slow = u.perKm && trip.vS < PER_KM_MIN_SPEED;
    cost = !u.perKm ? perHour : slow ? null : (perHour / (trip.vS * 3.6)) * 100;
  }
  const ratio = cost == null ? Infinity : cost / ref;

  $('speed').textContent = Math.round(trip.vS * 3.6);
  $('trip-cost').textContent = nf(toCost({ litres: trip.litres, price }), 2);
  $('distance').textContent = nf(trip.distance / 1000, 1);
  renderFuelAverage();
  renderGrade();
  $('altitude').textContent = trip.altS == null ? '–' : Math.round(trip.altS);

  // scale runs 0 to 2x the cruising cost, so cruise sits at 50%, near the top
  $('now-mark').style.transform = dialRotation(ratio / 2);
  setDialValue(fixedDigits(cost)); // fixed 888.8 layout; the point is the same in both languages
  $('dial-value').style.setProperty('--cost-color', costColor(Math.min(1, ratio / 2)));
  setDialScale(ref);

  // trip average (pauses excluded): above the bar and as a marker (needs 30 s, or 300 m per km)
  const avg = dialValueOf({ litres: trip.litres, seconds: trip.seconds, metres: trip.distance });
  $('avg-value').textContent = avg == null ? '–' : nf(avg, 1);
  placeMark('avg-mark', avg, ref);

  // last 5 minutes of trip time (pauses excluded); until then the same as the trip average
  const base = trip.recent[0];
  const recent = trip.seconds > 30
    ? dialValueOf({ litres: trip.litres - base.L, seconds: trip.seconds - base.s, metres: trip.distance - base.d, minSeconds: 0 })
    : null;
  $('recent-value').textContent = recent == null ? '–' : nf(recent, 1);
  placeMark('recent-mark', recent, ref);
}

function setDialUnit(unit) {
  dialUnit = unit;
  renderCostUnit();
  if (trip?.hasData) render();
}
// €/h → €/100 km → kg CO₂/h → €/h; from km/h, back to €/h
function toggleCostUnit() {
  setDialUnit(DIAL_CYCLE[(DIAL_CYCLE.indexOf(dialUnit) + 1) % DIAL_CYCLE.length]);
}
$('gauge').addEventListener('click', toggleCostUnit);
document.querySelectorAll('.light').forEach((b) => b.addEventListener('click', () => setDialUnit(b.dataset.unit)));
$('gauge').addEventListener('keydown', (e) => {
  if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); toggleCostUnit(); }
});

// Fuel average over the trip, in L/100 km or km/L (tap to switch; needs 300 m to mean anything)
const FUEL_UNIT_KEY = 'fuelprice.fuelUnit';
// Default: km/L in Italian (the usual unit there), L/100 km otherwise; a tap overrides it until the language changes.
const defaultFuelUnit = () => (getLang() === 'it' ? 'kml' : 'l100');
let fuelUnit = defaultFuelUnit();
try { const u = localStorage.getItem(FUEL_UNIT_KEY); if (u === 'kml' || u === 'l100') fuelUnit = u; } catch { /* default unit */ }

function renderFuelAverage() {
  const km = trip.distance / 1000;
  const kml = fuelUnit === 'kml';
  $('fuel-unit').textContent = kml ? 'km/L' : 'L/100 km';
  let text = '–';
  if (trip.distance > 300) {
    if (!kml) text = nf(trip.litres / km * 100, 1);
    else if (trip.litres > 0.01) text = nf(km / trip.litres, 1); // almost no fuel yet (downhill): no figure
  }
  $('fuel-avg').textContent = text;
}

$('fuel-toggle').addEventListener('click', () => {
  fuelUnit = fuelUnit === 'kml' ? 'l100' : 'kml';
  try { localStorage.setItem(FUEL_UNIT_KEY, fuelUnit); } catch { /* not remembered */ }
  if (trip) renderFuelAverage();
});

// Colour at a position on the scale (0–1): cyan at 0, green at 0.25, yellow at 0.75, red at 1 (the max) and above,
// shading in between. Used by the dial's arc, the figure and the altitude profile.
function costColor(pos) {
  const mix = (from, to, a, b) => `color-mix(in oklab, var(${to}) ${(((pos - a) / (b - a)) * 100).toFixed(0)}%, var(${from}))`;
  if (pos <= 0) return 'var(--scale-0)';
  if (pos < 0.25) return mix('--scale-0', '--scale-25', 0, 0.25);
  if (pos < 0.75) return mix('--scale-25', '--scale-75', 0.25, 0.75);
  if (pos < 1) return mix('--scale-75', '--scale-100', 0.75, 1);
  return 'var(--scale-100)';
}

function placeMark(id, cost, ref) {
  $(id).toggleAttribute('hidden', cost == null); // SVG elements have no .hidden property
  if (cost != null) $(id).style.transform = dialRotation(cost / ref / 2);
}

// ----- dial -----
// The number stays centred under the pivot; the unit follows its right edge.
// The figure is drawn as seven-segment digits, centred under the pivot; the unit follows its right edge.
const DIGIT = { w: 20, h: 36, t: 4.4, gap: 4.5, slant: 0.12 };
let dialText = null;
function setDialValue(text) {
  if (text === dialText) return;
  dialText = text;
  const { segments, width } = segmentPaths(text, DIGIT);
  const lean = (DIGIT.h / 2) * DIGIT.slant; // the slant moves the figure right by about this much
  const g = $('dial-value');
  g.setAttribute('transform', `translate(${(-width / 2 - lean).toFixed(1)} 56)`);
  g.replaceChildren(...segments.map((s) => {
    const p = document.createElementNS('http://www.w3.org/2000/svg', 'path');
    p.setAttribute('d', s.d);
    if (!s.on) p.setAttribute('class', 'off');
    return p;
  }));
  $('dial-unit').setAttribute('x', (width / 2 - lean + 5).toFixed(1));
}

// The scale runs 0 to 2× the cruising cost over 200°, from −110°; cruise sits 10° left of straight up, so that the
// band above the maximum fits in the 220° the scale used to fill.
const DIAL_SWEEP = 200; // degrees, 0 to 2× cruise
const DIAL_START = -110; // angle of 0 € (0° = up): the scale and the band above it together fill −110° … +113°
const DIAL_R = 100;     // arc radius, in the SVG's units (see index.html)

/** Rotation for a scale position (0–1, clamped), as a CSS transform about the dial centre. */
// Above the maximum (2× cruise) the pointer goes on into a 20° band up to 3× cruise (scale position 1.5), then stops.
const DIAL_OVER = 20;      // degrees
const DIAL_OVER_POS = 0.5; // scale positions the band covers (2× → 3× cruise)
const DIAL_OVER_GAP = 3;   // degrees between the arc's round end and the band
function dialAngle(pos) {
  const p = Math.max(0, Math.min(1 + DIAL_OVER_POS, pos));
  if (p <= 1) return DIAL_START + p * DIAL_SWEEP;
  return DIAL_START + DIAL_SWEEP + DIAL_OVER_GAP + ((p - 1) / DIAL_OVER_POS) * DIAL_OVER;
}
function dialRotation(pos) {
  return `rotate(${dialAngle(pos).toFixed(1)}deg)`;
}

// The shaded arc: short segments, each in the colour of its position (an SVG stroke cannot follow a curve's gradient).
function drawDialArc() {
  const n = 55;
  const point = (deg) => {
    const a = (deg * Math.PI) / 180;
    return `${(DIAL_R * Math.sin(a)).toFixed(2)} ${(-DIAL_R * Math.cos(a)).toFixed(2)}`;
  };
  const step = DIAL_SWEEP / n;
  for (let i = 0; i < n; i++) {
    const from = DIAL_START + i * step;
    const to = from + step + (i < n - 1 ? 0.6 : 0); // small overlap hides seams between segments
    const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
    path.setAttribute('d', `M ${point(from)} A ${DIAL_R} ${DIAL_R} 0 0 1 ${point(to)}`);
    path.style.stroke = costColor((i + 0.5) / n);
    if (i === 0 || i === n - 1) path.style.strokeLinecap = 'round';
    $('gauge-arc').append(path);
  }
}
drawDialArc();

// The band above the maximum: from just past the arc's round end, 20° wide, as wide as the arc (radius ±7).
// Outline on three sides; the side next to the maximum is left open.
function drawDialOver() {
  const from = DIAL_START + DIAL_SWEEP + DIAL_OVER_GAP, to = from + DIAL_OVER, ro = DIAL_R + 7, ri = DIAL_R - 7;
  const at = (r, deg) => { const a = (deg * Math.PI) / 180; return `${(r * Math.sin(a)).toFixed(2)} ${(-r * Math.cos(a)).toFixed(2)}`; };
  $('gauge-over').setAttribute('d', `M ${at(ro, from)} A ${ro} ${ro} 0 0 1 ${at(ro, to)} L ${at(ri, to)} A ${ri} ${ri} 0 0 0 ${at(ri, from)}`); // open at the max end: no closing edge
}
drawDialOver();

// Ticks and figures: for the cost and CO₂ units at every quarter of the scale (0, ½, 1 = cruise at the top,
// 1½ and 2× the cruising value); for km/h at the speeds people drive at (SPEED_TICKS).
const DIAL_STEPS = [0, 0.25, 0.5, 0.75, 1];
const SPEED_TICKS = [0, 30, 50, 90, 110, 130]; // km/h
let dialScaleKey = null;
function setDialScale(ref) {
  const speed = DIAL_UNITS[dialUnit].speed;
  const key = speed ? 'speed' : ref;
  if (key === dialScaleKey) return;
  dialScaleKey = key;
  const steps = speed
    ? SPEED_TICKS.map((v) => ({ pos: v / SPEED_MAX, text: String(v), cruise: false }))
    : DIAL_STEPS.map((pos) => ({ pos, text: String(Math.round(pos * 2 * ref)), cruise: pos === 0.5 })); // whole units
  const svg = 'http://www.w3.org/2000/svg';
  $('gauge-scale').replaceChildren(...steps.flatMap(({ pos, text, cruise }) => {
    const a = ((DIAL_START + pos * DIAL_SWEEP) * Math.PI) / 180;
    const at = (r) => [(r * Math.sin(a)).toFixed(2), (-r * Math.cos(a)).toFixed(2)];
    const tick = document.createElementNS(svg, 'line');
    const [x1, y1] = at(DIAL_R - 8), [x2, y2] = at(DIAL_R - 16);
    Object.entries({ x1, y1, x2, y2, class: 'tick' }).forEach(([k, v]) => tick.setAttribute(k, v));
    const label = document.createElementNS(svg, 'text');
    const [x, y] = at(DIAL_R - 28);
    Object.entries({ x, y, class: cruise ? 'step cruise' : 'step' }).forEach(([k, v]) => label.setAttribute(k, v));
    label.textContent = text;
    return [tick, label];
  }));
}

// ----- controls -----
$('trip-ac').addEventListener('click', () => {
  if (!trip) return;
  trip.ac = !trip.ac;
  $('trip-ac').setAttribute('aria-pressed', String(trip.ac));
  trip.ref = cruiseReference();
});

function setPauseButton(paused) {
  $('pause').dataset.paused = String(paused);
  $('pause').setAttribute('aria-label', t(paused ? 'trip.resume' : 'trip.pause'));
}

$('pause').addEventListener('click', () => {
  if (!trip) return;
  trip.paused = !trip.paused;
  trip.lastT = null;
  resetSlopeWindow();
  setPauseButton(trip.paused);
  setStatus(trip.paused ? t('trip.paused') : '');
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
  if (days < 1) return t('tree.lessThanDay');
  if (days < 14) return t('tree.days', { n: Math.round(days) });
  if (days < 60) return t('tree.weeks', { n: Math.round(days / 7) });
  if (days < 700) return t('tree.months', { n: Math.round(days / 30) });
  return t('tree.years', { n: nf(days / 365, 1) });
}

// ---------- replay a trip from a log file ----------
// The log's GPS rows go through the same pipeline as a live drive (onSample), all at once, with the active
// vehicle's settings and price; the people and the A/C at the start come from the log. Pauses are kept.
// Nothing is logged and the GPS is off meanwhile. Ends on the summary, with a note naming the file.
function replayTrip(log, fileName) {
  const gpsRows = log.rows.filter((r) => r.v != null && r.t >= 0);
  if (gpsRows.length < 2) throw new Error(t('replay.noGps'));
  endGps();
  startTrip({ demo: false, replay: true });
  trip.passengers = Math.min(9, Math.max(1, Math.round(Number(log.meta.passengers)) || setup.passengers));
  trip.ac = log.meta.ac_at_start === 'true' && !hasNoAc();
  trip.ref = cruiseReference();
  resetAltitude();
  const t0 = trip.startMs;
  // warm-up rows teach the altitude check, as on trip setup
  for (const r of log.rows) {
    if (r.t < 0 && r.v != null && r.acc != null && r.acc <= GOOD_ACCURACY) checkAltitude({ v: r.v, t: t0 + r.t * 1000, alt: r.alt });
  }
  for (const r of log.rows) {
    if (r.t < 0) continue;
    if (r.v == null) {
      if (r.note === 'pause') trip.paused = true;
      else if (r.note === 'resume') { trip.paused = false; trip.lastT = null; resetSlopeWindow(); }
      continue;
    }
    onSample({ v: r.v, accuracy: r.acc ?? GOOD_ACCURACY, t: t0 + r.t * 1000, alt: r.alt, altAcc: r.altAcc });
  }
  trip.paused = false;
  endTrip({ replayOf: fileName });
}

$('replay').addEventListener('click', () => { $('replay-err').hidden = true; $('replay-file').click(); });
$('replay-file').addEventListener('change', async (e) => {
  const file = e.target.files[0];
  e.target.value = ''; // the same file can be picked again
  if (!file) return;
  try {
    const log = parseLog(await file.text());
    if (!log) throw new Error(t('replay.notLog'));
    replayTrip(log, file.name);
  } catch (err) {
    trip = null;
    $('replay-err').textContent = err.message;
    $('replay-err').hidden = false;
    showSetup();
  }
});

function endTrip({ replayOf = null } = {}) {
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
    [t('sum.distance'), `${nf(km, 1)} km`],
    [t('sum.time'), `${mins} min`],
    [t('sum.fuel'), `${nf(trip.litres, 2)} L`],
    [t('sum.total'), `€${nf(total, 2)}`],
    [t('sum.average'), trip.seconds > 30 ? `€${nf(total / (trip.seconds / 3600), 1)}/h` : '—'],
    [t('sum.idling'), `€${nf(toCost({ litres: trip.idleLitres, price }), 2)}`],
  ];
  const co2 = co2FromFuel({ litres: trip.litres, fuel: settings.fuel });
  rows.push([t('sum.co2'), `${nf(co2, 1)} kg`]);
  const days = treeDays({ co2 });
  rows.push([t('sum.tree'), treeTime(days), 'tree']);
  if (trip.acLitres > 0) rows.push([t('sum.ac'), `€${nf(toCost({ litres: trip.acLitres, price }), 2)}`]);
  const detail = $('tree-detail');
  detail.hidden = true;
  detail.textContent = t('tree.detail', {
    litres: nf(trip.litres, 2), fuel: fuelLabel(settings.fuel).toLowerCase(), perLitre: nf(CO2_PER_LITRE[settings.fuel], 2),
    co2: nf(co2, 1), perYear: TREE_KG_PER_YEAR, time: treeTime(days), days: Math.round(days),
  });
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
  drawProfile(trip.profile, trip.ref, price);
  $('export-log').hidden = !hadLog;
  const note = $('summary-note');
  note.hidden = !replayOf;
  note.textContent = replayOf ? t('sum.replay', { file: replayOf, vehicle: vehicleLabel(settings.vehicle), fuel: fuelLabel(settings.fuel), price: nf(settings.price, 3) }) : '';
  trip = null;
  show('summary');
}

// ---------- altitude profile (summary) ----------
// Altitude along the road, each stretch coloured by its cost per hour on the dial's scale.
// Not shown for trips under 300 m or without altitude.
function drawProfile(points, ref, price) {
  const fig = $('profile');
  const svg = $('profile-svg');
  svg.replaceChildren();
  const bins = binProfile(points);
  const total = points.length ? points[points.length - 1].d - points[0].d : 0;
  fig.hidden = bins.length < 2 || total < 300;
  if (fig.hidden) return;

  const { min, max } = extremes(bins);
  // plot box inside the 320 × 132 viewBox; altitude labels on the left, distance below
  const X0 = 44, X1 = 314, Y0 = 8, Y1 = 110;
  const span = Math.max(20, max.h - min.h); // a flat trip stays flat instead of magnifying noise
  const mid = (max.h + min.h) / 2;
  const x = (d) => X0 + (d / bins[bins.length - 1].d) * (X1 - X0);
  const y = (h) => Y1 - ((h - (mid - span / 2)) / span) * (Y1 - Y0);
  const ns = 'http://www.w3.org/2000/svg';
  const el = (tag, attrs, text) => {
    const e = document.createElementNS(ns, tag);
    for (const [k, v] of Object.entries(attrs)) e.setAttribute(k, v);
    if (text != null) e.textContent = text;
    svg.append(e);
    return e;
  };
  const pts = bins.map((b) => [x(b.d).toFixed(1), y(b.h).toFixed(1)]);
  el('polygon', { class: 'area', points: `${pts[0][0]},${Y1} ${pts.map((p) => p.join(',')).join(' ')} ${pts[pts.length - 1][0]},${Y1}` });
  for (let i = 1; i < bins.length; i++) {
    const rate = bins[i].rate;
    const color = rate == null ? 'var(--dim)' : costColor((toCost({ litres: rate, price }) / ref) / 2);
    el('line', { class: 'seg', x1: pts[i - 1][0], y1: pts[i - 1][1], x2: pts[i][0], y2: pts[i][1], style: `stroke:${color}` });
  }
  // max and min as labels on the vertical axis, each with a thin dashed line across the plot
  for (const b of [max, min]) {
    const py = y(b.h).toFixed(1);
    el('line', { class: 'guide', x1: X0, y1: py, x2: X1, y2: py });
    el('text', { class: 'ext', x: X0 - 5, y: py, 'text-anchor': 'end', 'dominant-baseline': 'central' }, `${Math.round(b.h)} m`);
  }
  svg.prepend(...svg.querySelectorAll('.guide')); // under the curve
  el('text', { class: 'axis', x: X0, y: 128, 'text-anchor': 'start' }, '0 km');
  el('text', { class: 'axis', x: X1, y: 128, 'text-anchor': 'end' }, `${nf(total / 1000, 1)} km`);
  svg.setAttribute('aria-label', t('sum.profileAria', { min: Math.round(min.h), max: Math.round(max.h), km: nf(total / 1000, 1) }));
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

// The version label stays hidden (it made the page scroll); three quick taps on the New trip background show or hide it.
{
  let taps = [];
  $('screen-setup').addEventListener('click', (e) => {
    if (e.target !== e.currentTarget) return; // a button, a field or a row: not the background
    const now = Date.now();
    taps = [...taps.filter((tm) => now - tm < 700), now];
    if (taps.length >= 3) { taps = []; if ($('version').textContent) $('version').hidden = !$('version').hidden; }
  });
}

// ---------- boot ----------
applyStatic();
form.lang.value = getLang();
syncAverageLimits();
if (settings) showSetup();
else { $('settings-cancel').hidden = true; $('average-field').hidden = true; show('settings'); }

// ---------- offline use and automatic updates: see update.js ----------
// Never reload mid-trip; the version label shows which files are running.
startUpdates({
  isBusy: () => Boolean(trip),
  onVersion: (id) => { $('version').dataset.id = id; $('version').textContent = t('version', { id }); },
});
