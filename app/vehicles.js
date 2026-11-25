// vehicles.js — the saved settings, one entry per vehicle type. Pure: no DOM, no storage.
//
// Shape of the store:  { version: 2, active: 'sedan', recent: ['sedan', 'moto'], vehicles: { sedan: { fuel, price, average?, advanced? }, moto: {...} } }
// "active" is the vehicle the app opens with. "recent" lists the saved vehicles, most recently used first (a vehicle
// is used when it is saved or switched to); recent[0] is always the active one. Each vehicle keeps its own fuel, price, average consumption and
// certificate fields, so switching between a car and a motorcycle loses and mixes nothing.
// The old format (one flat object { vehicle, fuel, price, average?, advanced? }) is migrated on load.

/**
 * Read a stored value and return a clean store, or null when there is nothing usable (behave as first run).
 * Entries that are invalid are dropped; an entry for a vehicle that cannot burn the stored fuel is corrected.
 *
 * @param {*} raw  parsed JSON (old flat object or new store)
 * @param {object} rules  { vehicles: string[], fuels: string[], gasolineOnly: (vehicle) => boolean }
 * @returns {{version:number, active:string, vehicles:object}|null}
 */
export function normalizeStore(raw, rules) {
  if (!raw || typeof raw !== 'object') return null;
  // Old format: a single flat settings object.
  const entries = raw.vehicles && typeof raw.vehicles === 'object'
    ? raw.vehicles
    : raw.vehicle ? { [raw.vehicle]: raw } : {};
  const vehicles = {};
  for (const [id, e] of Object.entries(entries)) {
    if (!rules.vehicles.includes(id) || !e || typeof e !== 'object') continue;
    const fuel = rules.gasolineOnly(id) ? 'gasoline' : e.fuel;
    if (!rules.fuels.includes(fuel) || !(e.price > 0)) continue;
    vehicles[id] = { fuel, price: e.price };
    if (e.average !== undefined && e.average !== null) vehicles[id].average = e.average;
    if (e.advanced && typeof e.advanced === 'object') vehicles[id].advanced = e.advanced;
  }
  const activeId = raw.vehicles ? raw.active : raw.vehicle;
  const active = vehicles[activeId] ? activeId : Object.keys(vehicles)[0];
  if (!active) return null;
  return { version: 2, active, recent: recencyList(active, raw.recent, vehicles), vehicles };
}

/** Most-recent-first list of the saved vehicles: `first`, then the given order, then any others; no duplicates, no unknown ids. */
function recencyList(first, given, vehicles) {
  const all = [first, ...(Array.isArray(given) ? given : []), ...Object.keys(vehicles)];
  return all.filter((id, i) => vehicles[id] && all.indexOf(id) === i);
}

/** The settings of one vehicle as a flat object `{ vehicle, fuel, price, average?, advanced? }`, or null if none saved. */
export function settingsFor(store, vehicle) {
  const e = store?.vehicles?.[vehicle];
  return e ? { vehicle, ...e } : null;
}

/** The settings of the active vehicle (the one the app opens with), or null on first run. */
export function activeSettings(store) {
  return store ? settingsFor(store, store.active) : null;
}

/**
 * Save the settings of one vehicle and make it the active one. Returns a new store (the input is not changed).
 * The entry is replaced as a whole, so leaving out `average` or `advanced` removes them for that vehicle only.
 *
 * @param {object|null} store  the current store, or null on first run
 * @param {object} settings    flat `{ vehicle, fuel, price, average?, advanced? }`
 */
export function saveVehicle(store, settings) {
  const { vehicle, ...entry } = settings;
  for (const key of Object.keys(entry)) if (entry[key] === undefined) delete entry[key];
  const vehicles = { ...(store?.vehicles || {}), [vehicle]: entry };
  return { version: 2, active: vehicle, recent: recencyList(vehicle, store?.recent, vehicles), vehicles };
}

/**
 * Make a saved vehicle the active one, without changing any settings. Returns a new store; an unknown vehicle
 * (nothing saved for it) leaves the store as it is.
 */
export function setActive(store, vehicle) {
  if (!store?.vehicles?.[vehicle]) return store;
  return { ...store, active: vehicle, recent: recencyList(vehicle, store.recent, store.vehicles) };
}

/** The `n` most recently used saved vehicles (default 2), most recent first. */
export function recentVehicles(store, n = 2) {
  return (store?.recent || []).slice(0, n);
}
