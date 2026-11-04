/**
 * Content packs.
 *
 * A pack swaps the roster without touching the engine: its own unit definitions, the names a player reads for those
 * units, their weapons and abilities, and the preset teams squad select offers. The built-in pack, `ours`, is this
 * project's own cast and is what the public build ships.
 *
 * Other packs are registered at startup. The client loads any pack it finds in `src/content/packs/local/`, a folder
 * that git ignores, so a pack kept there exists only on the machine that holds it: it is never committed, never built by
 * CI and never deployed. See docs/packs.md.
 *
 * The lookups in units.js, teams.js, names.js and abilitytext.js consult the active pack first and fall back to the
 * built-in cast, so everything downstream (the scenario, the AI, the interface) works unchanged.
 */

/**
 * @typedef {Object} Pack
 * @property {string} id
 * @property {string} label            shown on the pack toggle
 * @property {Object<string, Object>} units   unit definitions, in the shape of src/content/units.js
 * @property {Object<string, {units: string[]}>} teams   preset squads of three, by team id
 * @property {string[]} teamOrder
 * @property {Object<string, string>} names   display names for unit, weapon and ability ids
 * @property {Object<string, string>} [roles] one-phrase roles by unit id
 * @property {Object<string, string>} [teamNames]
 * @property {Object<string, string>} [teamNotes]
 */

const registry = {};
let active = null;

export const BUILT_IN = 'ours';

/**
 * Register a pack. Checks the shape loudly, so a broken local pack fails at startup rather than mid-game.
 * @param {Pack} pack
 */
export function registerPack(pack) {
  if (!pack || !pack.id || pack.id === BUILT_IN) throw new Error('A pack needs an id other than "' + BUILT_IN + '"');
  for (const k of ['units', 'teams', 'teamOrder', 'names']) {
    if (!pack[k]) throw new Error('Pack ' + pack.id + ' is missing ' + k);
  }
  for (const tid of pack.teamOrder) {
    const t = pack.teams[tid];
    if (!t) throw new Error('Pack ' + pack.id + ' lists team ' + tid + ' but does not define it');
    for (const d of t.units) {
      if (!pack.units[d]) throw new Error('Pack ' + pack.id + ' team ' + tid + ' uses unknown unit ' + d);
      // a unit card appears once per squad unless it is Mass Produced (rulebook 2026-10-30, "Building a Squad")
      const mass = (pack.units[d].traits || []).indexOf('mass-produced') !== -1;
      if (!mass && t.units.filter(function (x) { return x === d; }).length > 1) {
        throw new Error('Pack ' + pack.id + ' team ' + tid + ' repeats ' + d + ', which is not mass-produced');
      }
    }
  }
  for (const d of Object.keys(pack.units)) {
    const u = pack.units[d];
    if (u.defId !== d) throw new Error('Pack ' + pack.id + ' unit ' + d + ' has defId ' + u.defId);
    if (!pack.names[d]) throw new Error('Pack ' + pack.id + ' unit ' + d + ' has no display name');
  }
  registry[pack.id] = pack;
}

/**
 * Switch packs. `ours` (or null) returns to the built-in cast.
 * @param {?string} id
 */
export function activate(id) {
  if (!id || id === BUILT_IN) {
    active = null;
    return;
  }
  if (!registry[id]) throw new Error('No pack registered as ' + id);
  active = registry[id];
}

/** @returns {?Pack} the active pack, or null for the built-in cast */
export function activePack() {
  return active;
}

/** @returns {Array<{id: string, label: string}>} every pack that can be chosen, the built-in one first */
export function listPacks() {
  return [{ id: BUILT_IN, label: 'Our names' }].concat(
    Object.keys(registry).map(function (id) { return { id: id, label: registry[id].label || id }; })
  );
}
