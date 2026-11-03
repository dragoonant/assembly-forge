/**
 * Fixtures: boards and squads for the test suite.
 *
 * These are deliberately not the game's content. The six unit ids match the
 * project roster (`src/content/names.js`) so that ids stay consistent across
 * the project, but the stat lines here are round numbers chosen to make a
 * failing assertion readable, not balance decisions. Real unit data arrives
 * with the content milestone.
 */

import * as State from '../../src/engine/state.js';

/** Stat lines used by tests. Deliberately boring numbers. */
export const FIXTURE_UNITS = Object.freeze({
  u01: Object.freeze({ hp: 16, tl: 3, vp: 4 }),  // objective-runner
  u02: Object.freeze({ hp: 10, tl: 1, vp: 5 }),  // skirmisher
  u03: Object.freeze({ hp: 9,  tl: 3, vp: 10 }), // glass cannon
  u04: Object.freeze({ hp: 14, tl: 2, vp: 6 }),  // debuff bruiser
  u05: Object.freeze({ hp: 12, tl: 1, vp: 7 }),  // berserker
  u06: Object.freeze({ hp: 17, tl: 2, vp: 3 })   // zone controller
});

/**
 * The standard two-weapon loadout every unit in this game carries: a cheap
 * short-ranged one and an expensive heavy one. Round numbers again -- these
 * exist so a test can say "attack with the heavy one", not to be balanced.
 */
export const FIXTURE_WEAPONS = Object.freeze([
  Object.freeze({ wid: 'light', tlCost: 2, range: 2, strength: 3 }),
  Object.freeze({ wid: 'heavy', tlCost: 4, range: 4, strength: 6 })
]);

/**
 * A weapon that always hits and always kills, for tests about what happens
 * AFTER a hit rather than about the dice. Strength 40 against any fixture unit
 * is destruction with probability that rounds to one.
 */
export const SURE_KILL = Object.freeze({
  wid: 'surekill', tlCost: 2, range: 6, strength: 40, ignoreLos: true
});

/**
 * A hex-shaped arena centred on 0,0, so test coordinates read as offsets from
 * the middle of the board.
 *
 * @param {Object} [opts]
 * @param {number} [opts.radius]
 * @param {Object} [opts.hexes] per-hex `{terrain, elevation}` overrides
 * @returns {Object}
 */
export function arena(opts) {
  const o = opts || {};
  return State.createBoard({
    radius: o.radius === undefined ? 6 : o.radius,
    hexes: o.hexes || {}
  });
}

/**
 * Build a unit spec from a fixture stat line, with overrides.
 *
 * @param {string} uid
 * @param {string} defId one of u01..u06
 * @param {0|1} side
 * @param {{q: number, r: number}} hex
 * @param {Object} [overrides] `{hp, tl, vp}`
 * @returns {Object}
 */
export function unit(uid, defId, side, hex, overrides) {
  const base = FIXTURE_UNITS[defId];
  if (!base) throw new Error('No fixture stat line for ' + defId);
  const o = overrides || {};
  return {
    uid: uid,
    defId: defId,
    side: side,
    hex: hex,
    hp: o.hp === undefined ? base.hp : o.hp,
    tl: o.tl === undefined ? base.tl : o.tl,
    vp: o.vp === undefined ? base.vp : o.vp,
    weapons: o.weapons === undefined ? FIXTURE_WEAPONS.map(function (w) { return w; }) : o.weapons,
    upgrades: o.upgrades,
    traits: o.traits
  };
}

/**
 * A match, with sensible defaults for everything a test does not care about.
 *
 * @param {Object} [spec] passed through to `State.createGame`, with `board`
 *        defaulting to a radius-6 arena
 * @returns {Object}
 */
export function game(spec) {
  const s = spec || {};
  return State.createGame({
    seed: s.seed === undefined ? 'suite' : s.seed,
    rules: s.rules,
    board: s.board || arena(s.arena),
    units: s.units || [],
    garrisons: s.garrisons,
    objectives: s.objectives,
    bases: s.bases,
    pickups: s.pickups,
    tactics: s.tactics,
    setupOrder: s.setupOrder
  });
}

/**
 * One unit per side, far enough apart that neither engages the other, on a
 * board with no terrain. The default subject for movement tests.
 *
 * @param {Object} [spec]
 * @returns {Object}
 */
export function duel(spec) {
  const s = spec || {};
  return game({
    seed: s.seed,
    rules: s.rules,
    board: s.board || arena(s.arena),
    units: [
      unit('a1', 'u02', 0, s.a || { q: -3, r: 0 }, s.aStats),
      unit('b1', 'u06', 1, s.b || { q: 3, r: 0 }, s.bStats)
    ],
    garrisons: s.garrisons,
    objectives: s.objectives,
    setupOrder: s.setupOrder
  });
}
