// presets.js — named vehicle presets ("My Panda", "Dad's van"). Pure: no DOM, no storage.
//
// Shape:  { last: 'My Panda', byType: { city: 'My Panda' }, presets: { 'My Panda': { vehicle, fuel, price, average?, advanced? }, ... } }
// A preset is a full copy of one vehicle's settings (the flat shape of vehicles.js), saved under a name the user
// types. Loading a preset writes it back as that vehicle type's settings. "last" is the name last saved or loaded;
// "byType" the name last saved or loaded for each vehicle type (what the type's settings now hold).

export const NAME_MAX = 40; // characters

/** The name as stored: trimmed, inner runs of spaces collapsed, cut to NAME_MAX; '' when nothing is left. */
export function cleanName(name) {
  return String(name ?? '').trim().replace(/\s+/g, ' ').slice(0, NAME_MAX).trim();
}

/**
 * Read a stored value and return clean presets: entries without a known vehicle, fuel or positive price are dropped.
 * @param {*} raw  parsed JSON
 * @param {object} rules  { vehicles: string[], fuels: string[], gasolineOnly: (vehicle) => boolean } (as vehicles.js)
 * @returns {{ last: string|null, presets: object }}
 */
export function normalizePresets(raw, rules) {
  const presets = {};
  const entries = raw && typeof raw === 'object' && raw.presets && typeof raw.presets === 'object' ? raw.presets : {};
  for (const [rawName, e] of Object.entries(entries)) {
    const name = cleanName(rawName);
    if (!name || !e || typeof e !== 'object' || !rules.vehicles.includes(e.vehicle)) continue;
    const fuel = rules.gasolineOnly(e.vehicle) ? 'gasoline' : e.fuel;
    if (!rules.fuels.includes(fuel) || !(e.price > 0)) continue;
    presets[name] = { vehicle: e.vehicle, fuel, price: e.price };
    if (e.average !== undefined && e.average !== null) presets[name].average = e.average;
    if (e.advanced && typeof e.advanced === 'object') presets[name].advanced = e.advanced;
  }
  const last = presets[raw?.last] ? raw.last : null;
  const byType = {};
  const given = raw?.byType && typeof raw.byType === 'object' ? raw.byType : {};
  for (const [type, n] of Object.entries(given)) if (presets[n]?.vehicle === type) byType[type] = n;
  if (last && !byType[presets[last].vehicle]) byType[presets[last].vehicle] = last; // stores from before byType
  return { last, byType, presets };
}

/** Save `settings` (flat `{ vehicle, fuel, price, average?, advanced? }`) under `name`, replacing a preset of that name. Returns a new object; an empty name changes nothing. */
export function savePreset(state, name, settings) {
  const n = cleanName(name);
  if (!n) return state;
  const entry = { ...settings };
  for (const key of Object.keys(entry)) if (entry[key] === undefined) delete entry[key];
  return { last: n, byType: { ...state.byType, [entry.vehicle]: n }, presets: { ...state.presets, [n]: entry } };
}

/** Record that the preset `name` was loaded (its type's settings now hold it). Returns a new object; an unknown name changes nothing. */
export function markLoaded(state, name) {
  const n = cleanName(name);
  const p = state.presets[n];
  return p ? { ...state, last: n, byType: { ...state.byType, [p.vehicle]: n } } : state;
}

/** The name of the preset a vehicle type's settings were last saved or loaded from, or ''. */
export function nameForType(state, type) {
  const n = state.byType?.[type];
  return n && state.presets[n]?.vehicle === type ? n : '';
}

/** Remove the preset called `name`. Returns a new object. */
export function deletePreset(state, name) {
  const n = cleanName(name);
  if (!state.presets[n]) return state;
  const { [n]: _gone, ...presets } = state.presets;
  const byType = Object.fromEntries(Object.entries(state.byType || {}).filter(([, v]) => v !== n));
  return { last: state.last === n ? null : state.last, byType, presets };
}

/** The preset called `name` (a copy), or null. */
export function getPreset(state, name) {
  const p = state.presets[cleanName(name)];
  return p ? { ...p } : null;
}

/** Preset names, sorted for the list (case and accents ignored). */
export function presetNames(state) {
  return Object.keys(state.presets).sort((a, b) => a.localeCompare(b, undefined, { sensitivity: 'base' }));
}
